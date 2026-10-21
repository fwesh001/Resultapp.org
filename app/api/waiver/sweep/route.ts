import { NextRequest, NextResponse } from "next/server";
import { provisionHeldRegistration } from "@/lib/pendingRegistrations";
import { requireSuperadminPage } from "@/lib/superadminAuth";
import { getBackendBase, upstreamError, requireSecret } from "../../superadmin/_lib";

/**
 * POST /api/waiver/sweep — recover 100%-waiver registrations the browser lost.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `pending_registrations` exists because a payment can settle without the
 * browser callback arriving — the Flutterwave webhook is the net underneath.
 * A 100% waiver produces no charge at all (Flutterwave rejects a zero-value
 * transaction), so `charge.completed` NEVER FIRES and there is no net.
 *
 * Without this route, a school whose tab closed during a fully-waived
 * registration loses everything: no portal, a subdomain held forever, and a
 * waiver token burnt against nothing. That is the single worst failure mode the
 * waiver feature has, and it is the one a customer is most likely to hit,
 * because the people using waiver codes are the least technical buyers on the
 * platform.
 *
 * WHY IT RUNS HERE AND NOT IN THE BACKEND
 * ---------------------------------------
 * The admin password inside a hold is sealed with AES-256-GCM under
 * PENDING_REGISTRATION_SECRET, and that key deliberately lives only in the
 * Next.js tier. The backend has never been able to read a hold and this is not
 * the place to change that — it would put a credential at rest decryptable by
 * the service that already holds every other secret. So the backend only LISTS
 * orphans; the completion work happens here, where the key is.
 *
 * WHY IT CANNOT DOUBLE-PROVISION
 * ------------------------------
 * Every path — browser, webhook, sweeper — goes through `provisionHeldRegistration`,
 * which claims the hold with the same conditional UPDATE. The sweeper is simply
 * a third racer, and it loses to a live browser just like the webhook does. The
 * `buffer_minutes` window exists so it rarely races at all.
 *
 * Auth: Vercel cron sends `Authorization: Bearer $CRON_SECRET`. A superadmin may
 * also trigger it manually. Both are accepted; nothing else is.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * How long a bypass hold must sit untouched before the sweeper will touch it.
 *
 * Not arbitrary: the browser provisions within a second or two of creating the
 * hold, so anything still pending after this is genuinely abandoned. Short
 * enough that recovery feels immediate, long enough that the sweeper never
 * wins a race it was never in.
 */
const DEFAULT_BUFFER_MINUTES = 3;

/** Hard cap per run. Each orphan provisions a school — Vercel domains, mail. */
const MAX_PER_RUN = 10;

export async function GET(req: NextRequest) {
  return sweep(req, "cron");
}

export async function POST(req: NextRequest) {
  return sweep(req, "manual");
}

async function sweep(req: NextRequest, mode: "cron" | "manual") {
  if (mode === "manual") {
    // Manual triggers come from the superadmin Waivers page. This verifies the
    // SIGNED session (not just a same-named cookie) and that the member's page
    // scope includes Waivers — under page allocation, firing provisioning runs
    // is a Waivers-page capability, not something every platform session does.
    const guard = await requireSuperadminPage("waivers");
    if (guard) return guard;
  } else {
    const auth = checkAuth(req, mode);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
  }

  const { secret, error } = requireSecret();
  if (error) return error;

  const url = new URL(req.url);
  const bufferMinutes = Number(url.searchParams.get("buffer_minutes")) || DEFAULT_BUFFER_MINUTES;
  const limit = Math.min(Number(url.searchParams.get("limit")) || MAX_PER_RUN, MAX_PER_RUN);

  // Without this key the hold payload cannot be decrypted and every orphan
  // would come back `undecryptable`. Say so loudly instead of reporting a
  // cheerful zero, which would read as "nothing to do" when in fact this
  // instance cannot do the job at all.
  if (!process.env.PENDING_REGISTRATION_SECRET?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "PENDING_REGISTRATION_SECRET is not set on this instance — orphaned holds " +
          "cannot be decrypted, so recovery is impossible here.",
        recoverable: false,
      },
      { status: 503 },
    );
  }

  let orphans: { tx_ref: string; subdomain: string }[] = [];
  try {
    const qs = new URLSearchParams({
      buffer_minutes: String(bufferMinutes),
      limit: String(limit),
    });
    const r = await fetch(
      `${getBackendBase()}/api/v1/admin/pending-registrations/orphaned-bypasses?${qs}`,
      { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "Could not list orphaned holds") },
        { status: r.status },
      );
    }
    orphans = Array.isArray((data as { orphans?: unknown }).orphans)
      ? ((data as { orphans: { tx_ref: string; subdomain: string }[] }).orphans)
      : [];
  } catch (e) {
    console.error("[waiver/sweep] orphan listing failed", e);
    return NextResponse.json({ success: false, error: "Could not reach the waiver service" }, { status: 502 });
  }

  if (orphans.length === 0) {
    return NextResponse.json({
      success: true,
      mode,
      buffer_minutes: bufferMinutes,
      scanned: 0,
      recovered: 0,
      orphans: [],
    });
  }

  console.warn(
    `[waiver/sweep] ${mode}: ${orphans.length} orphaned bypass hold(s) older than ${bufferMinutes}m — recovering`,
  );

  const results: {
    tx_ref: string;
    subdomain: string;
    outcome: string;
    detail?: string;
  }[] = [];

  for (const o of orphans) {
    try {
      const outcome = await provisionHeldRegistration(o.tx_ref, { source: "sweeper" });
      results.push({
        tx_ref: o.tx_ref,
        subdomain: o.subdomain,
        outcome: outcome.status,
        ...("detail" in outcome ? { detail: outcome.detail } : {}),
      });
      if (outcome.status === "provisioned") {
        console.warn(
          `[waiver/sweep] recovered '${o.subdomain}' — the browser dropped a fully-waived registration`,
        );
      } else if (outcome.status === "failed") {
        // Leave it logged loudly. A failed orphan stays 'pending' and will be
        // retried on the next run, which is correct: the browser is gone, so
        // there is nobody else who can complete it.
        console.error(`[waiver/sweep] FAILED to recover '${o.subdomain}'`, outcome);
      }
    } catch (e) {
      console.error(`[waiver/sweep] threw on '${o.subdomain}'`, e);
      results.push({
        tx_ref: o.tx_ref,
        subdomain: o.subdomain,
        outcome: "threw",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const recovered = results.filter((r) => r.outcome === "provisioned").length;
  const already = results.filter((r) => r.outcome === "already_done").length;

  return NextResponse.json({
    success: true,
    mode,
    buffer_minutes: bufferMinutes,
    scanned: orphans.length,
    recovered,
    // Worth reporting separately: these are the sweeper losing a race it
    // should not have been in. A steady trickle means the buffer is too short.
    already_done: already,
    orphans: results,
  });
}

/**
 * Cron auth (manual mode is handled by the page guard in sweep() — see there).
 *
 * WAYS A CALLER CAN AUTHENTICATE, in the order they are checked:
 *
 *   1. `Authorization: Bearer <CRON_SECRET>`  — Vercel Cron's native form.
 *   2. `x-cron-secret: <CRON_SECRET>` header  — cron services that CAN set
 *      custom headers but not Authorization.
 *   3. `?key=<CRON_SECRET>` query parameter    — cron-job.org and most other
 *      external schedulers. Their free tiers CANNOT set custom headers at all,
 *      so this is the only mechanism available to them.
 *
 * The query parameter puts a secret in a URL, which means it lands in access
 * logs. That is an accepted trade for a low-value, single-purpose, revocable
 * token that only unlocks a recovery sweep — and the alternative is a scheduler
 * that simply cannot authenticate at all. Revoke it by rotating CRON_SECRET.
 *
 * `CRON_SECRET` unset is a 503, NOT a 401. A 401 says "you are not allowed";
 * a 503 says "I am not configured". Conflating them sends an operator hunting
 * for an auth problem that does not exist.
 */
function checkAuth(
  req: NextRequest,
  mode: "cron" | "manual",
): { ok: true } | { ok: false; status: number; error: string } {
  if (mode === "cron") {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret) {
      console.error(
        "[waiver/sweep] CRON_SECRET is not set — abandoned 100% waiver registrations " +
          "CANNOT be recovered on this deployment. Set it in the Vercel environment variables.",
      );
      return {
        ok: false,
        status: 503,
        error:
          "CRON_SECRET is not configured on this deployment, so the sweep cannot run. " +
          "Add it to the Vercel environment variables (any random string), then retry with " +
          "?key=<that value>.",
      };
    }

    const supplied =
      (() => {
        const auth = req.headers.get("authorization") ?? "";
        return auth.startsWith("Bearer ") ? auth.slice(7) : "";
      })() ||
      req.headers.get("x-cron-secret")?.trim() ||
      req.nextUrl.searchParams.get("key")?.trim() ||
      "";

    if (!supplied) {
      return {
        ok: false,
        status: 401,
        error: "Missing credential. Call this URL with ?key=<CRON_SECRET>.",
      };
    }

    // Length check first, then a full-length XOR accumulate. Same shape as
    // lib/flutterwave's timingSafeEqual wrapper: comparing only equal-length
    // strings keeps the loop from leaking the secret's length through timing.
    if (supplied.length !== cronSecret.length) {
      return { ok: false, status: 401, error: "Invalid credential." };
    }
    let diff = 0;
    for (let i = 0; i < supplied.length; i++) {
      diff |= supplied.charCodeAt(i) ^ cronSecret.charCodeAt(i);
    }
    if (diff !== 0) {
      return { ok: false, status: 401, error: "Invalid credential." };
    }
    return { ok: true };
  }

  // Manual mode never reaches here: sweep() verifies the signed superadmin
  // session AND the Waivers page scope with requireSuperadminPage first (see
  // below), which also upgrades the old presence-only cookie check to a real
  // signature verification.
  return { ok: true };
}
