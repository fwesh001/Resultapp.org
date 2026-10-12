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
 * Park a registration. Returns the generated tx_ref.
 *
 * Called BEFORE Flutterwave opens, so the details exist no matter what the
 * browser does next.
 */
export async function holdRegistration(p: PendingPayload): Promise<string> {
  const base = backendBase();
  const secret = backendSecret();
  if (!base || !secret) {
    throw new Error("Backend is not configured; cannot hold this registration.");
  }

  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const txRef = `resultapp_${p.subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "")}_${ts}_${rand}`;

  const res = await fetch(`${base}/api/v1/admin/pending-registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
    body: JSON.stringify({
      tx_ref: txRef,
      subdomain: p.subdomain,
      payload: seal(p),
      ttl_minutes: HOLD_TTL_MINUTES,
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
  };

  if (hold.status === "completed") {
    return { status: "already_done", subdomain: hold.subdomain || "" };
  }
  if (
    hold.status === "expired" ||
    (hold.expires_at && new Date(hold.expires_at).getTime() < Date.now())
  ) {
    return { status: "expired" };
  }

  const payload = unseal(hold.payload || {});
  if (!payload) return { status: "undecryptable" };
  if (!payload.admin_password) return { status: "undecryptable" };

  // 2. Verify the payment with Flutterwave directly.
  //
  // The webhook payload is already signature-verified, but re-checking against
  // the provider gives one authoritative amount and status for BOTH paths, and
  // means neither caller can be talked into provisioning an unpaid school.
  let charged = 0;
  let currency = "";
  try {
    const v = await verifyTransaction(txRef);
    const st = String(v.data?.status || v.status || "").toLowerCase();
    if (st !== "successful" && st !== "completed") {
      return { status: "not_paid" };
    }
    charged = Number(v.data?.charged_amount ?? v.data?.amount ?? 0);
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
  // legitimately exceed the headline price.
  if (charged < expected) {
    return { status: "not_paid" };
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
      transaction_id: txRef,
      amount_ngn: charged,
      source: opts.source,
    }),
    cache: "no-store",
  });

  const provBody = await provRes.text().catch(() => "");
  if (!provRes.ok) {
    // Release the claim so a retry (or the other path) can try again.
    await fetch(`${base}/api/v1/admin/pending-registrations/release`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tx_ref: txRef }),
      cache: "no-store",
    }).catch(() => null);

    // A taken subdomain means the OTHER path already finished the job. That is
    // success, not a conflict, and must be logged as such — otherwise every
    // successful webhook looks like an incident.
    if (provRes.status === 409) {
      return { status: "already_done", subdomain: payload.subdomain };
    }
    return { status: "failed", detail: `Provision failed (${provRes.status}): ${provBody.slice(0, 200)}` };
  }

  return { status: "provisioned", subdomain: payload.subdomain };
}
