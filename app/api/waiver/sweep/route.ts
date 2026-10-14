import { NextRequest, NextResponse } from "next/server";
import { provisionHeldRegistration } from "@/lib/pendingRegistrations";
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
  if (!isAuthorized(req, mode)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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
 * Cron auth, or an authenticated superadmin.
 *
 * Vercel attaches `Authorization: Bearer $CRON_SECRET` to scheduled
 * invocations. In development `CRON_SECRET` is unset, so the route is
 * unreachable by cron there — deliberately. A dev machine must not be
 * provisioning schools on a timer.
 */
function isAuthorized(req: NextRequest, mode: "cron" | "manual"): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (mode === "cron") {
    if (!cronSecret) return false;
    const header = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${cronSecret}`;
    // Constant-time-ish comparison; these are fixed-length ASCII in practice.
    if (header.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }
  // Manual triggers come from the superadmin console, which carries its own
  // session cookie. Checked without throwing so a missing cookie is a 401 from
  // the route rather than an exception.
  return req.cookies.get("superadmin_session")?.value !== undefined;
}
