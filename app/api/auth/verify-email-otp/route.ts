import { NextRequest, NextResponse } from "next/server";
import { readJson, resolveBackendBase, logBadBackendUrl } from "@/lib/api/authProxy";

/**
 * POST /api/auth/verify-email-otp
 *
 * Consumes the 6-digit code from Step 1.
 *
 * Shares the request-email-otp failure modes verbatim — same backend, same
 * secret, same fallback-chain trap — so it carries an identical explicit
 * configuration check rather than routing through postAuth(). See that file for
 * why the hardcoded-IP fallback is unsafe here.
 *
 * A wrong / expired / replayed / attempt-capped code comes back 200 with
 * {verified:false} and one uniform message; the backend merges those failure
 * modes so this cannot be used as an oracle. Only a non-200 is surfaced as an
 * error, which is a 429 from the throttle or one of the misconfig/transport
 * cases below.
 */

const PROXY_SECRET = (process.env.BACKEND_API_SECRET || "").trim();

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { email, code } = body as { email?: string; code?: string };
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  // Caught here rather than at the backend so a paste with spaces or letters
  // never spends one of the 5 brute-force attempts.
  if (!code || !/^[0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "A 6-digit code is required" }, { status: 400 });
  }

  const backend = resolveBackendBase();
  if (!backend.ok) {
    logBadBackendUrl("api/auth/verify-email-otp", backend);
    return NextResponse.json({ error: `Server misconfigured: ${backend.reason}` }, { status: 500 });
  }
  if (!PROXY_SECRET) {
    console.error("[api/auth/verify-email-otp] BACKEND_API_SECRET is not set on this deployment");
    return NextResponse.json({ error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const target = `${backend.base}/api/v1/auth/verify-email-otp`;

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": PROXY_SECRET,
      },
      body: JSON.stringify({ email, code, purpose: "registration" }),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const detail =
        (data.detail as string | undefined) ||
        (data.error as string | undefined) ||
        `Backend rejected the request (${res.status})`;
      console.error(`[api/auth/verify-email-otp] backend responded ${res.status}: ${detail}`);
      return NextResponse.json({ error: detail }, { status: res.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    let host = BACKEND_URL;
    try {
      host = new URL(target).host;
    } catch {
      /* BACKEND_URL is not a valid URL — log it verbatim below. */
    }
    // The code itself is never logged; only the host and transport error.
    console.error(
      `[api/auth/verify-email-otp] fetch to ${host} failed:`,
      e instanceof Error ? `${e.name}: ${e.message}` : e
    );
    return NextResponse.json(
      { error: "Could not reach the auth service. Please try again." },
      { status: 502 }
    );
  }
}