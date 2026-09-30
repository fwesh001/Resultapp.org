import { NextResponse } from "next/server";
import { readSessionCookie, clearSessionCookie, SESSION_COOKIES } from "./session";
import type { SessionClaims } from "./sessionCrypto";

interface AdminSession {
  admin?: { email?: string };
  tenant_id?: string;
}

/**
 * Shared guard for admin-only API proxies.
 *
 * Returns `null` when the request carries a valid SIGNED `admin_session` whose
 * tenant matches `tenantId`. Otherwise returns a JSON error response
 * (400 unknown tenant / 401 unauthenticated) for the handler to return, and
 * deletes the offending cookie so the browser stops presenting it.
 *
 * Signature verification happens in `readSessionCookie` (lib/session.ts).
 * Nothing here trusts the cookie contents before that point — before P0-0 the
 * cookie was unsigned JSON, so a hand-written value was enough to pass this
 * guard for any tenant. See LEGAL_REMEDIATION.md P0-0.
 *
 * Legacy schools with NULL `admin_password_hash` can never mint a session, so
 * they always get 401 here — the login UI handles that case with the friendly
 * "set up your admin password" banner + setup link.
 */
export async function requireAdminSession(tenantId: string): Promise<NextResponse | null> {
  const normalized = (tenantId || "").toLowerCase().trim();
  if (!normalized) {
    return NextResponse.json(
      { success: false, error: "Missing tenant_id" },
      { status: 400 },
    );
  }

  const unauthorized = async () => {
    // Rejected, unsigned, forged, tenant-mismatched or expired: drop it.
    await clearSessionCookie(SESSION_COOKIES.admin);
    return NextResponse.json(
      { success: false, error: "Unauthorized — please sign in as admin" },
      { status: 401 },
    );
  };

  try {
    const session = await readSessionCookie<AdminSession>(SESSION_COOKIES.admin);
    if (!session) return await unauthorized();

    const tenant = String(session.tenant_id || "").toLowerCase().trim();
    const email = String(session.admin?.email || "").trim();
    if (!tenant || tenant !== normalized || !email || !session.admin) {
      return await unauthorized();
    }
  } catch {
    return await unauthorized();
  }

  return null;
}

/**
 * Tenant lifecycle — billing escape hatch check for server components.
 * Returns true when the viewer holds a valid SIGNED `admin_session` for
 * `subdomain` (used to show the billing bypass link on the Suspended portal,
 * and to select the admin scope of the report bundle).
 *
 * Returns a boolean and never throws, because Server Components cannot delete a
 * cookie — a false result there means "render the signed-out experience".
 */
export async function hasAdminSession(subdomain: string): Promise<boolean> {
  const normalized = (subdomain || "").toLowerCase().trim();
  if (!normalized) return false;
  try {
    const session = await readSessionCookie<AdminSession>(SESSION_COOKIES.admin);
    if (!session) return false;
    const tenant = String(session.tenant_id || "").toLowerCase().trim();
    return tenant === normalized && !!session.admin?.email;
  } catch {
    return false;
  }
}

export type { SessionClaims };
