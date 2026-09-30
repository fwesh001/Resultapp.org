import { NextResponse } from "next/server";
import { readSessionCookie, clearSessionCookie, SESSION_COOKIES } from "./session";

/**
 * Superadmin Command Center — shared gate.
 *
 * `superadmin_session` is set by POST /api/superadmin/login after verifying
 * credentials, and is now an HMAC-signed token of the form
 * `v1.<payload>.<mac>` (LEGAL_REMEDIATION.md P0-0).
 *
 * Before signing, the cookie was raw JSON and this guard accepted
 * `{"superadmin":true}` from anyone — full platform control, no credential.
 * Verification now happens in `readSessionCookie` and this function adds only
 * the claim checks on top of an already-authenticated token.
 */
export async function requireSuperadmin(): Promise<NextResponse | null> {
  const unauthorized = async () => {
    await clearSessionCookie(SESSION_COOKIES.superadmin);
    return NextResponse.json(
      { success: false, error: "Unauthorized — superadmin sign-in required" },
      { status: 401 },
    );
  };

  let raw: unknown;
  try {
    const session = await readSessionCookie<{
      superadmin?: boolean;
      created_at?: string;
    }>(SESSION_COOKIES.superadmin);
    if (!session) return await unauthorized();
    raw = session;
  } catch {
    return await unauthorized();
  }

  // Strict boolean, not truthiness — "false" must not read as superadmin.
  if ((raw as { superadmin?: boolean }).superadmin !== true) {
    return await unauthorized();
  }
  return null;
}

export interface SuperadminIdentity {
  email: string | null;
  adminId: string | null;
  role: string | null;
}

/**
 * Identity of the signed-in superadmin, for attribution on writes that end up
 * in `audit_logs` (which stores actor/actor_id but never sees the browser
 * cookie — only the Next.js proxy does).
 *
 * Returns null when there is no validly signed session, and also for the legacy
 * `SUPERADMIN_PASSWORD` fallback path, which mints an identity-less
 * `{ superadmin: true }` token. Callers must tolerate that; it is not an auth
 * failure, since `requireSuperadmin` already passed.
 */
export async function readSuperadminIdentity(): Promise<SuperadminIdentity | null> {
  try {
    const session = await readSessionCookie<{
      superadmin?: boolean;
      email?: string;
      admin_id?: string;
      role?: string;
    }>(SESSION_COOKIES.superadmin);
    if (!session) return null;
    if (session.superadmin !== true) return null;
    const email = String(session.email ?? "").trim().toLowerCase();
    return {
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      adminId: session.admin_id ? String(session.admin_id) : null,
      role: session.role ? String(session.role) : null,
    };
  } catch {
    return null;
  }
}
