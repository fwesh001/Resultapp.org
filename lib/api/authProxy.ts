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

  try {
    const res = await fetch(`${getBackendBase()}/api/v1/auth/${path}`, {
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
      // eslint-disable-next-line no-console
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
