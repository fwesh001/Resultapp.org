import "server-only";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/lib/pendingRegistrationCrypto";
import { calculateTieredTotal } from "@/lib/pricing";
import { verifyTransaction } from "@/lib/flutterwave";

/**
 * Pending registrations: park the details before checkout, finish them after.
 *
 * Two callers, one implementation:
 *   - the browser callback (/api/register-school), which is the happy path
 *   - the Flutterwave webhook, which is the safety net when the callback never
 *     arrives (tab closed, crash, dead signal after settlement)
 *
 * Both must be safe to run. Whichever gets there first provisions; the other
 * finds the hold already completed and exits without acting. That is what makes
 * the webhook a net rather than a second way to double-provision.
 *
 * The admin password is encrypted by this module before it reaches the database.
 * See lib/pendingRegistrationCrypto.ts for why it cannot simply ride in the
 * checkout `meta`.
 */

const HOLD_TTL_MINUTES = 45;
/** Longer than a checkout session, short enough that abandoned holds expire. */
const HOLD_TTL_MS = HOLD_TTL_MINUTES * 60 * 1000;

function backendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "";
  return raw.replace(/\/$/, "");
}

function backendSecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

export interface PendingPayload {
  school_name: string;
  subdomain: string;
  admin_name?: string;
  admin_email: string;
  /** Stored encrypted. Never logged, never returned to a client. */
  admin_password?: string;
  student_count: number;
  accepted_terms?: boolean;
  terms_version?: string | null;
  privacy_version?: string | null;
}

/**
 * How the waiver reaches the hold.
 *
 * `reservation_tx_ref` is the hold's OWN tx_ref. That is deliberate: the
 * token's reservation and the registration's hold are the same lifecycle, so
 * `claimHold()` below doubles as the burn. Reusing the existing CAS rather than
 * inventing a second one is the whole reason a bypass cannot double-spend.
 */
export interface WaiverBinding {
  token_id: number;
  reservation_tx_ref: string;
  charge_required: boolean;
  charge_ngn: number;
  charged_slots: number;
}

/** Encrypt the password field in place; everything else stays queryable. */
function seal(p: PendingPayload): Record<string, unknown> {
  const { admin_password, ...rest } = p;
  return {
    ...rest,
    // isEncryptedSecret guards against double-sealing if a caller re-submits a
    // payload it already got back, which would otherwise produce a value that
    // decrypts to the *ciphertext* rather than the password.
    ...(admin_password && !isEncryptedSecret(admin_password)
      ? { admin_password: encryptSecret(admin_password) }
      : {}),
  };
}

function unseal(row: Record<string, unknown>): PendingPayload | null {
  const pw = row.admin_password;
  const password = typeof pw === "string" ? decryptSecret(pw) : null;
  if (typeof pw === "string" && password === null) {
    // Present but unreadable — wrong key, or a tampered row. Do NOT provision
    // with an empty password; that would create a school nobody can sign in to.
    return null;
  }
  return {
    school_name: String(row.school_name || ""),
    subdomain: String(row.subdomain || ""),
    admin_name: row.admin_name ? String(row.admin_name) : undefined,
    admin_email: String(row.admin_email || ""),
    admin_password: password ?? undefined,
    student_count: Number(row.student_count || 0),
    accepted_terms: row.accepted_terms === true,
    terms_version: (row.terms_version as string | null) ?? null,
    privacy_version: (row.privacy_version as string | null) ?? null,
  };
}

/**
 * Mint the tx_ref a checkout will be keyed by.
 *
 * EXTRACTED so the waiver reservation can claim the token BEFORE the hold
 * exists. Both need the same reference, and whichever is generated last cannot
 * be used by whichever ran first — the original in-function generation made
 * "reserve the token, then park the registration" impossible to express without
 * a second round trip.
 *
 * The format is load-bearing: app/api/flutterwave/webhook/route.ts ignores any
 * tx_ref that does not match `^resultapp_[a-z0-9-]+_\d+_[a-z0-9]+$`, so a
 * waiver-backed hold MUST keep it or the webhook stops being able to rescue a
 * split-bill registration whose callback never arrived.
 */
export function newTxRef(subdomain: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `resultapp_${subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "")}_${ts}_${rand}`;
}

/**
 * Park a registration. Returns the generated tx_ref.
 *
 * Called BEFORE Flutterwave opens, so the details exist no matter what the
 * browser does next. Pass `txRef` when the caller already minted one (the
 * waiver path does, so the token reservation and this hold share a reference);
 * omit it and one is generated here.
 */
export async function holdRegistration(
  p: PendingPayload,
  opts: { txRef?: string; waiver?: WaiverBinding } = {},
): Promise<string> {
  const base = backendBase();
  const secret = backendSecret();
  if (!base || !secret) {
    throw new Error("Backend is not configured; cannot hold this registration.");
  }

  const txRef = opts.txRef || newTxRef(p.subdomain);

  const res = await fetch(`${base}/api/v1/admin/pending-registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
    body: JSON.stringify({
      tx_ref: txRef,
      subdomain: p.subdomain,
      payload: seal(p),
      ttl_minutes: HOLD_TTL_MINUTES,
      ...(opts.waiver
        ? {
            waiver_token_id: opts.waiver.token_id,
            charge_required: opts.waiver.charge_required,
            charge_ngn: opts.waiver.charge_ngn,
            charged_slots: opts.waiver.charged_slots,
          }
        : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Could not hold the registration (${res.status}): ${t.slice(0, 160)}`);
  }
  return txRef;
}

export type ProvisionOutcome =
  | { status: "provisioned"; subdomain: string }
  | { status: "already_done"; subdomain: string }
  | { status: "no_hold" }
  | { status: "expired" }
  | { status: "undecryptable" }
  | { status: "not_paid" }
  | { status: "conflict"; detail: string }
  | { status: "failed"; detail: string };

/**
 * Try to take exclusive ownership of a hold before provisioning.
 *
 * This is the mutual-exclusion primitive the browser callback uses, and it must
 * be the SAME one the webhook uses. Without it both paths could provision
 * concurrently: whichever lost the race would get a 409 from the backend and
 * show the school "that subdomain is taken" moments after they paid. The school
 * would still get their portal — the webhook's provision succeeds — but the
 * error is the wrong thing to show someone who has just handed over money.
 *
 * Returns:
 *   "claimed" — we own it; provision, and call releaseHold() if that fails
 *   "taken"   — the webhook already owns it; do NOT provision, just wait
 *   "none"    — no hold exists (an older client, or a path that skips the hold)
 */
export async function claimHold(
  txRef: string,
): Promise<"claimed" | "taken" | "none"> {
  const base = backendBase();
  const secret = backendSecret();
  if (!base || !secret || !txRef) return "none";

  try {
    const res = await fetch(`${base}/api/v1/admin/pending-registrations/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ tx_ref: txRef }),
      cache: "no-store",
    });
    if (res.status === 409) return "taken";
    if (!res.ok) return "none";
    return "claimed";
  } catch {
    // A hold store hiccup must not block registration: the browser path can
    // still provision on its own, which is exactly what it did before this
    // existed. The cost is a possible double-provision attempt, which the
    // backend's subdomain uniqueness turns into a harmless 409.
    return "none";
  }
}

/** Hand a claim back so the other path (or a retry) can proceed. */
export async function releaseHold(txRef: string): Promise<void> {
  const base = backendBase();
  const secret = backendSecret();
  if (!base || !secret || !txRef) return;
  try {
    await fetch(`${base}/api/v1/admin/pending-registrations/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ tx_ref: txRef }),
      cache: "no-store",
    });
  } catch {
    /* best-effort; the TTL reaps it anyway */
  }
}

/**
 * Wait for a school row to appear.
 *
 * Used when the webhook won the claim: rather than provisioning a second time
 * or showing "subdomain taken", we wait for the webhook's work to land and then
 * report success. Provisioning takes tens of seconds, so this is bounded and
 * deliberately noisy in the log — a school left waiting here is a school a
 * human may need to check on.
 */
export async function waitForSchool(
  subdomain: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const base = backendBase();
  if (!base || !subdomain) return false;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${base}/api/v1/tenant/${encodeURIComponent(subdomain)}`,
        { cache: "no-store" },
      );
      if (res.ok) return true;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.warn(
    `[pending] gave up waiting ${timeoutMs}ms for ${subdomain} to appear`,
  );
  return false;
}

/**
 * Verify payment, then provision from the hold.
 *
 * `opts.source` is only for logging — both callers run identical logic on
 * purpose, so there is no way for the webhook and the callback to disagree
 * about whether something counts as paid.
 */
export async function provisionHeldRegistration(
  txRef: string,
  opts: { source: "browser" | "webhook" },
): Promise<ProvisionOutcome> {
  const base = backendBase();
  const secret = backendSecret();
  if (!base || !secret) {
    return { status: "failed", detail: "Backend not configured" };
  }

  const headers = { "Content-Type": "application/json", "X-API-SECRET-KEY": secret };

  // 1. Load the hold.
  const lookup = await fetch(
    `${base}/api/v1/admin/pending-registrations?tx_ref=${encodeURIComponent(txRef)}`,
    { headers, cache: "no-store" },
  ).catch(() => null);

  if (!lookup || lookup.status === 404) return { status: "no_hold" };
  if (!lookup.ok) {
    return { status: "failed", detail: `Hold lookup failed (${lookup.status})` };
  }
  const hold = (await lookup.json()) as {
    status?: string;
    expires_at?: string;
    subdomain?: string;
    payload?: Record<string, unknown>;
    waiver_token_id?: number | null;
    charge_required?: boolean;
    charge_ngn?: number;
    charged_slots?: number;
  };

  if (hold.status === "completed") {
    return { status: "already_done", subdomain: hold.subdomain || "" };
  }
  if (
    hold.status === "expired" ||
    (hold.expires_at && new Date(hold.expires_at).getTime() < Date.now())
  ) {
    // The school is never coming back for this one. Release the token so a
    // fresh attempt — or another school — can use it, rather than leaving it
    // reserved until the sweeper happens to run.
    await releaseWaiver(hold.waiver_token_id, txRef);
    return { status: "expired" };
  }

  const payload = unseal(hold.payload || {});
  if (!payload) return { status: "undecryptable" };
  if (!payload.admin_password) return { status: "undecryptable" };

  // 2. Verify the payment with Flutterwave directly — UNLESS this is a 100%
  //    bypass, in which case there is no payment and none will ever exist.
  //
  //    The webhook payload is already signature-verified, but re-checking against
  //    the provider gives one authoritative amount and status for BOTH paths, and
  //    means neither caller can be talked into provisioning an unpaid school.
  //
  //    THE BRANCH IS NOT OPTIONAL. Without it a fully-waived hold calls
  //    verifyTransaction, finds nothing, and returns "not_paid" forever — the
  //    school has a legitimate entitlement to a free portal and can never
  //    obtain it. Flutterwave rejects zero-value charges, so no transaction will
  //    ever exist for this hold to verify against.
  //
  //    `charge_required` is the discriminator, and it is set at hold creation
  //    from the backend's own split — never from the client.
  const isBypass = hold.charge_required === false;
  let charged = 0;
  let transactionId: string | null = null;

  if (isBypass) {
    console.warn(
      `[pending] ${opts.source}: hold ${txRef} is a 100% waiver bypass — ` +
        `skipping payment verification (waiver #${hold.waiver_token_id ?? "?"})`,
    );
    charged = 0;
  } else {
    let currency = "";
    try {
      const v = await verifyTransaction(txRef);
      const st = String(v.data?.status || v.status || "").toLowerCase();
      if (st !== "successful" && st !== "completed") {
        return { status: "not_paid" };
      }
      charged = Number(v.data?.charged_amount ?? v.data?.amount ?? 0);
      transactionId = String(v.data?.id ?? txRef);
      currency = String(v.data?.currency || "");
      if (currency && currency.toUpperCase() !== "NGN") {
        return { status: "failed", detail: `Unexpected currency ${currency}` };
      }
    } catch (e) {
      return {
        status: "failed",
        detail: e instanceof Error ? e.message : "Payment verification failed",
      };
    }

    const expected = calculateTieredTotal(payload.student_count);
    // A floor, not equality: Flutterwave reports the settled amount, which can
    // legitimately exceed the headline price. With a waiver the floor is the
    // DISCOUNTED charge, not the list price — otherwise every split-bill
    // registration would be rejected as underpaid against its own full price.
    const floor = hold.charge_ngn && hold.charge_ngn > 0
      ? Math.min(hold.charge_ngn, expected)
      : expected;
    if (charged < floor) {
      return { status: "not_paid" };
    }
  }

  // 3. Claim the hold. Doing this BEFORE the provision call means a second
  // runner (webhook arriving while the browser is mid-call) sees 'completed'
  // and stops, rather than racing into a duplicate provision.
  const claim = await fetch(`${base}/api/v1/admin/pending-registrations/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tx_ref: txRef }),
    cache: "no-store",
  });
  if (!claim.ok) {
    const t = await claim.text().catch(() => "");
    if (claim.status === 409) {
      // Someone else claimed it first. Not an error — just not our turn.
      return { status: "already_done", subdomain: payload.subdomain };
    }
    return { status: "failed", detail: `Could not claim hold (${claim.status}): ${t.slice(0, 160)}` };
  }

  // 4. Provision.
  const provRes = await fetch(`${base}/api/v1/provision`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      school_name: payload.school_name,
      subdomain: payload.subdomain,
      admin_name: payload.admin_name,
      admin_email: payload.admin_email,
      admin_password: payload.admin_password,
      student_count: payload.student_count,
      accepted_terms: payload.accepted_terms ?? true,
      terms_version: payload.terms_version,
      privacy_version: payload.privacy_version,
      // Null on a bypass — there is no Flutterwave transaction, and the
      // backend's anti-replay check keys on this, so inventing a placeholder
      // would put a fake id into the ledger's reference column.
      transaction_id: transactionId,
      amount_ngn: charged,
      // The burn is scoped to THIS tx_ref, which is the same reference the
      // token was reserved under. A late callback whose reservation the
      // sweeper has since reassigned cannot redeem it.
      ...(hold.waiver_token_id
        ? {
            waiver_token_id: hold.waiver_token_id,
            waiver_reservation_tx_ref: txRef,
          }
        : {}),
      source: opts.source,
    }),
    cache: "no-store",
  });

  const provBody = await provRes.text().catch(() => "");
  if (!provRes.ok) {
    // Release the claim so a retry (or the other path) can try again. This
    // also returns any waiver reservation, which is scoped to the same ref.
    await releaseHold(txRef);
    await releaseWaiver(hold.waiver_token_id, txRef);

    // A taken subdomain means the OTHER path already finished the job. That is
    // success, not a conflict, and must be logged as such — otherwise every
    // successful webhook looks like an incident.
    if (provRes.status === 409) {
      return { status: "already_done", subdomain: payload.subdomain };
    }
    return { status: "failed", detail: `Provision failed (${provRes.status}): ${provBody.slice(0, 200)}` };
  }

  // A provision that reports a slot-grant failure has created the school but
  // NOT granted its seats, and — because the burn shares the transaction — has
  // NOT consumed the waiver. Surfacing it as a plain success would tell a
  // customer their portal is ready when it has zero capacity.
  try {
    const parsed = JSON.parse(provBody) as {
      slot_grant_error?: string | null;
      waiver?: unknown;
    };
    if (parsed.slot_grant_error) {
      console.error(
        `[pending] ${opts.source}: ${payload.subdomain} provisioned but the slot ` +
          `grant failed: ${parsed.slot_grant_error}`,
      );
      return {
        status: "failed",
        detail: `Portal created but slots could not be granted: ${parsed.slot_grant_error}`,
      };
    }
  } catch {
    /* non-JSON body: the ok-check above is authoritative */
  }

  return { status: "provisioned", subdomain: payload.subdomain };
}

/** Hand a waiver reservation back when provisioning fails. Best-effort. */
async function releaseWaiver(tokenId: number | null | undefined, txRef: string): Promise<void> {
  const base = backendBase();
  const secret = backendSecret();
  if (!base || !secret || !tokenId || !txRef) return;
  try {
    await fetch(`${base}/api/v1/waiver/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ token_id: tokenId, tx_ref: txRef }),
      cache: "no-store",
    });
  } catch {
    /* self-healing: the backend sweeper returns a lapsed reservation anyway */
  }
}
