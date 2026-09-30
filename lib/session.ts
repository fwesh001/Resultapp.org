import { cookies } from "next/headers";
import { signSession, verifySession, SESSION_TTL_SECONDS, type SessionClaims } from "./sessionCrypto";

/**
 * Session cookie plumbing — the single chokepoint every session read goes
 * through (LEGAL_REMEDIATION.md P0-0).
 *
 * Before this module, cookie parsing was duplicated across 17 physical sites
 * with only 3 using a shared helper, and staff session parsing was inlined
 * independently in 7 places. Any one of those copies that skipped signature
 * verification was a complete authentication bypass, and the next person to
 * edit one of them would not have known. Now there is exactly one read path.
 *
 * Server-only. Every function here needs a request context.
 */

export const SESSION_COOKIES = {
  admin: "admin_session",
  staff: "staff_session",
  superadmin: "superadmin_session",
} as const;

export type SessionCookieName = (typeof SESSION_COOKIES)[keyof typeof SESSION_COOKIES];

/** All session cookies, for bulk clearing. */
export const ALL_SESSION_COOKIES: SessionCookieName[] = [
  SESSION_COOKIES.admin,
  SESSION_COOKIES.staff,
  SESSION_COOKIES.superadmin,
];

/**
 * The path every session cookie is set and deleted on. Must match exactly or a
 * delete will not clear the cookie it is trying to remove.
 */
const COOKIE_PATH = "/";

/**
 * Mint and set a signed session cookie.
 *
 * IMPORTANT — the returned token must never be included in a response body.
 * `app/api/admin/login` and `app/api/staff/login` forward the upstream payload
 * with `{ success: true, ...data }`; if the signature rode along on that object
 * it would hand a valid session token to client-side JavaScript and void the
 * protection `httpOnly` exists to provide.
 */
export async function setSessionCookie(
  name: SessionCookieName,
  payload: Record<string, unknown>,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const token = signSession(payload, ttlSeconds);
  const store = await cookies();
  store.set(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: ttlSeconds,
  });
  return token;
}

/**
 * Read and verify a session cookie.
 *
 * Returns `null` for: absent, legacy unsigned, malformed, forged, tampered, or
 * expired. Never throws, so it is safe to call from a layout or a page.
 */
export async function readSessionCookie<T extends object>(
  name: SessionCookieName,
): Promise<SessionClaims<T> | null> {
  let raw: string | undefined;
  try {
    raw = (await cookies()).get(name)?.value;
  } catch {
    return null;
  }
  return verifySession<T>(raw);
}

/**
 * Delete a session cookie.
 *
 * Requires a Route Handler or Server Action — cookies are read-only in Server
 * Components, so a layout cannot clear a bad cookie and must redirect instead.
 *
 * `path` is stated explicitly on the expiring Set-Cookie rather than relying on
 * the default, because a delete that does not match the path the cookie was set
 * on leaves the cookie live in the browser.
 *
 * Returns false if the write threw, so callers can stop reporting success
 * while a live credential remains.
 */
export async function clearSessionCookie(name: SessionCookieName): Promise<boolean> {
  try {
    const store = await cookies();
    // An expired, empty value is the portable way to express "delete" while
    // keeping the path under our control.
    store.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COOKIE_PATH,
      expires: new Date(0),
      maxAge: 0,
    });
    return true;
  } catch {
    return false;
  }
}

/** Delete every session cookie. Used on hard-failure paths. */
export async function clearAllSessionCookies(): Promise<boolean> {
  const results = await Promise.all(ALL_SESSION_COOKIES.map((n) => clearSessionCookie(n)));
  return results.every(Boolean);
}
