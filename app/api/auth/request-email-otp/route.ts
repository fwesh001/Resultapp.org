import { NextRequest, NextResponse } from "next/server";
import { readJson, resolveBackendBase, logBadBackendUrl } from "@/lib/api/authProxy";

/**
 * POST /api/auth/request-email-otp
 *
 * Backs Step 1 of the registration wizard. Not session-guarded — a prospective
 * school admin has no account yet, which is the entire point.
 *
 * Why this does NOT use the shared postAuth() helper
 * ---------------------------------------------------
 * postAuth resolves its target through a fallback chain ending at a hardcoded
 * http://159.223.178.34:8000. On Vercel, where BACKEND_URL and
 * PROVISION_API_URL may both be unset, that fallback silently points the proxy
 * at a bare IP whose :8000 we deliberately closed — surfacing as an opaque 502
 * that looks identical to a Brevo delivery failure. Failing loudly on missing
 * configuration is the whole point of the rewrite; the four existing auth
 * proxies keep using postAuth and are unaffected.
 *
 * Response contract is unchanged, so sendOtp() in RegisterSchoolForm needs no
 * edits: a neutral 200 on success, and the backend's honest 502/503 detail
 * passed through on failure.
 */

const PROXY_SECRET = (process.env.BACKEND_API_SECRET || "").trim();

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { email } = body as { email?: string };
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  // Misconfiguration is reported as 500 with a named variable, never masked as
  // a delivery failure. resolveBackendBase() also rejects a BACKEND_URL that was
  // pasted as Markdown ("[https://…](https://…)") — that shape parses as
  // invalid and used to surface as an opaque 502 from fetch().
  const backend = resolveBackendBase();
  if (!backend.ok) {
    logBadBackendUrl("api/auth/request-email-otp", backend);
    return NextResponse.json({ error: `Server misconfigured: ${backend.reason}` }, { status: 500 });
  }
  if (!PROXY_SECRET) {
    console.error("[api/auth/request-email-otp] BACKEND_API_SECRET is not set on this deployment");
    return NextResponse.json({ error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const target = `${backend.base}/api/v1/auth/request-email-otp`;

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": PROXY_SECRET,
      },
      body: JSON.stringify({ email, purpose: "registration" }),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const detail =
        (data.detail as string | undefined) ||
        (data.error as string | undefined) ||
        `Backend rejected the request (${res.status})`;
      // Status is logged so Vercel shows whether this was a 502 (Brevo) or a
      // 503 (OTP storage) — the two have different root causes.
      console.error(`[api/auth/request-email-otp] backend responded ${res.status}: ${detail}`);
      return NextResponse.json({ error: detail }, { status: res.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    // Log which HOST was actually called — that single fact identifies a wrong
    // BACKEND_URL, DNS failure, or a blocked port. No secret, no email body.
    let host = backend.base;
    try {
      host = new URL(target).host;
    } catch {
      /* Should be unreachable — resolveBackendBase validated it. */
    }
    console.error(
      `[api/auth/request-email-otp] fetch to ${host} failed:`,
      e instanceof Error ? `${e.name}: ${e.message}` : e
    );
    return NextResponse.json(
      { error: "Could not reach the auth service. Please try again." },
      { status: 502 }
    );
  }
}