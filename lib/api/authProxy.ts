import { NextResponse } from "next/server";

/**
 * Shared proxy plumbing for the auth-flow routes (app/api/auth/*).
 *
 * These routes back PUBLIC pages (/verify-email, /forgot-password,
 * /reset-password), so they are deliberately NOT session-guarded — a signed-out
 * user clicking an emailed link must be able to reach them. The shared secret
 * is injected here, server-side, and never reaches the browser.
 *
 * Extracted so the four routes cannot drift on env-var precedence or error
 * handling, which is exactly how the older proxies ended up inconsistent.
 */

function getProxySecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

export function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Backend URL validation
//
// Added after a production incident: BACKEND_URL had been set in Vercel to a
// pasted Markdown link, "[https://api.resultapp.org](https://api.resultapp.org)".
// fetch() then threw ERR_INVALID_URL, every proxy 502'd, and because the origin
// returned an HTML error page the browser's res.json() failed too — so the UI
// showed a generic "we could not send a code" for what was a one-character
// config typo.
//
// A bad BACKEND_URL is a deployment error, not a runtime failure. It is
// detected here, named in the response, and logged with the offending value so
// the next occurrence is diagnosed in seconds instead of by log archaeology.
// ---------------------------------------------------------------------------

export type BackendBaseResult =
  | { ok: true; base: string }
  | { ok: false; reason: string };

/** Characters that mean the value was pasted from rendered Markdown/rich text. */
const MARKDOWN_LINK_RE = /[[\]]|\([^)]*\)|\s/;

export function resolveBackendBase(): BackendBaseResult {
  const raw = (process.env.BACKEND_URL || "").trim();
  if (!raw) {
    return { ok: false, reason: "BACKEND_URL is not set on this deployment" };
  }
  if (MARKDOWN_LINK_RE.test(raw)) {
    return {
      ok: false,
      reason:
        "BACKEND_URL contains whitespace or brackets, so it was pasted as rich text rather than a bare URL. " +
        'Set it to exactly: https://api.resultapp.org',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      ok: false,
      reason: `BACKEND_URL is not a valid absolute URL. Set it to exactly: https://api.resultapp.org`,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `BACKEND_URL must start with http:// or https:// (got "${parsed.protocol}").`,
    };
  }
  return { ok: true, base: raw.replace(/\/$/, "") };
}

/** Log a rejected BACKEND_URL. Safe to log: it is a hostname, never a secret. */
export function logBadBackendUrl(scope: string, result: BackendBaseResult): void {
  if (result.ok) return;
  const raw = (process.env.BACKEND_URL || "").trim();
  console.error(
    `[${scope}] ${result.reason} — received: ${JSON.stringify(raw.slice(0, 120))}`
  );
}

export function misconfigured(): NextResponse {
  return NextResponse.json(
    { error: "Server misconfigured: missing BACKEND_API_SECRET" },
    { status: 500 },
  );
}

/** POST a JSON body to a /api/v1/auth/* endpoint and normalise the result. */
export async function postAuth(
  path: string,
  body: unknown,
  opts: { allowDevLog?: boolean } = {},
): Promise<NextResponse> {
  const secret = getProxySecret();
  if (!secret) return misconfigured();

  // A malformed BACKEND_URL must not reach fetch(): it throws ERR_INVALID_URL
  // and turns a config typo into an opaque 502.
  const backend = resolveBackendBase();
  if (!backend.ok) {
    logBadBackendUrl(`api/auth/${path}`, backend);
    return NextResponse.json({ error: `Server misconfigured: ${backend.reason}` }, { status: 500 });
  }

  try {
    const res = await fetch(`${backend.base}/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    // 502 from the backend means the transactional email could not be sent.
    // That is honest and specific (unlike the neutral 200 used to avoid
    // enumeration), so pass the message through rather than flattening it.
    if (!res.ok) {
      const detail =
        (data.detail as string | undefined) ||
        (data.error as string | undefined) ||
        `Failed (${res.status})`;
      return NextResponse.json({ error: detail }, { status: res.status });
    }

    if (opts.allowDevLog) {
      console.log("[auth-flow] backend response", path, data);
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error(`[api/auth/${path}] proxy failed`, e);
    return NextResponse.json(
      { error: "Could not reach the auth service. Please try again." },
      { status: 502 },
    );
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
