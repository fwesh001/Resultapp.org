import { NextResponse } from "next/server";
import { readSessionCookie, clearSessionCookie, SESSION_COOKIES } from "./session";
import { ADMIN_CAPABILITIES } from "./capabilities";
import type { SessionClaims } from "./sessionCrypto";

interface AdminSession {
  admin?: {
    email?: string;
    staff_id?: string;
    full_name?: string;
    school_name?: string | null;
    email_verified?: boolean;
  };
  tenant_id?: string;
  /**
   * "admin" (the school's own admin) or "moderator" (a deputy promoted from a
   * staff row). Absent on sessions minted before the RBAC work, which are
   * treated as plain admin — see the note on normalizeRole().
   */
  role?: string;
  /**
   * What this role may reach. An allow-list, not a deny-list: a page added
   * tomorrow is missing until someone grants it, rather than silently granted.
   */
  capabilities?: string[];
}

/**
 * The viewer's authorization state for one tenant.
 *
 * Returned by readAdminSession. `isModerator` is kept alongside `role` because
 * `role === "admin"` is the only condition that grants a cap the claim does not
 * list, and that exception deserves to be visible at every call site rather
 * than hidden in a string comparison.
 */
export interface AdminIdentity {
  tenant: string;
  email: string | null;
  staffId: string | null;
  fullName: string | null;
  role: "admin" | "moderator";
  capabilities: string[];
  isModerator: boolean;
}

/**
 * Read a role claim, or `null` when it is absent/unrecognised.
 *
 * ══ WHY THIS NO LONGER FAILS OPEN ══
 * This used to return `"admin"` for anything that wasn't literally
 * `"moderator"` — including `undefined` — on the theory that sessions minted
 * before RBAC existed carried no role and should keep working. That is the
 * single most dangerous default in this file: one derivation path that forgets
 * to set `role` produces a session with `ADMIN_CAPABILITIES`, which is
 * settings, billing, audit AND `moderators` — i.e. a school admin who can
 * appoint more admins. Total tenant takeover from a missing string.
 *
 * The original rationale is now OBSOLETE and cannot come back. Binding the
 * cookie name into the MAC (lib/sessionCrypto macInput) invalidates every
 * outstanding session on deploy, so there are no pre-RBAC cookies left in the
 * wild to be compatible with. A session without a valid role is therefore
 * either corrupt or forged, and both deserve `null`.
 *
 * Callers must handle `null` by rejecting the session. There is deliberately
 * no "assume admin" fallback anywhere.
 */
function normalizeRole(value: unknown): "admin" | "moderator" | null {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "admin") return "admin";
  if (role === "moderator") return "moderator";
  return null;
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

/**
 * Read the admin session as an {@link AdminIdentity}, or null.
 *
 * Stricter than hasAdminSession on purpose: a moderator's session claims their
 * staff_id but may have no email, so requiring `admin?.email` would reject
 * every moderator. A session with neither is unusable and returns null.
 */
export async function readAdminIdentity(subdomain: string): Promise<AdminIdentity | null> {
  const normalized = (subdomain || "").toLowerCase().trim();
  if (!normalized) return null;

  const unauthorized = async () => {
    // Same clearing behaviour as requireAdminSession: a rejected session is
    // dropped so the browser stops presenting it.
    await clearSessionCookie(SESSION_COOKIES.admin);
    return null;
  };

  let session;
  try {
    session = await readSessionCookie<AdminSession>(SESSION_COOKIES.admin);
  } catch {
    return await unauthorized();
  }
  if (!session) return null;

  const tenant = String(session.tenant_id || "").toLowerCase().trim();
  if (!tenant || tenant !== normalized) return await unauthorized();

  const email = String(session.admin?.email ?? "").trim().toLowerCase() || null;
  const staffId = String(session.admin?.staff_id ?? "").trim() || null;
  if (!email && !staffId) return await unauthorized();

  const role = normalizeRole(session.role);
  // No role claim, or one we do not recognise: treat the session as absent
  // rather than assuming the more privileged branch. See normalizeRole.
  if (!role) return await unauthorized();
  const capabilities = Array.isArray(session.capabilities)
    ? session.capabilities.filter((c): c is string => typeof c === "string")
    : [];

  return {
    tenant,
    email,
    staffId,
    fullName: String(session.admin?.full_name ?? "").trim() || null,
    role,
    // An admin holds EVERY cap, including ones added after the session was
    // minted — otherwise adding a capability would not take effect until every
    // admin re-logged-in, which reads as a bug to the person who clicked.
    capabilities: role === "admin" ? [...ADMIN_CAPABILITIES] : capabilities,
    isModerator: role === "moderator",
  };
}

/**
 * Does this viewer hold `capability`? False for a missing/forged session, so
 * it is safe to call from a layout or nav that must decide what to render.
 */
export async function adminHasCapability(
  subdomain: string,
  capability: string,
): Promise<boolean> {
  const identity = await readAdminIdentity(subdomain);
  if (!identity) return false;
  if (identity.role === "admin") return true;
  return identity.capabilities.includes(capability);
}

/**
 * Route-handler guard with a capability requirement.
 *
 * Returns null when the caller may proceed, otherwise the 401/403 response to
 * return. The distinction matters: a SIGNED-OUT caller gets 401 so the login
 * page can act, a MODERATOR missing the cap gets 403 because they are
 * authenticated and there is nothing to log in to.
 */
export async function requireAdminCapability(
  subdomain: string,
  capability: string,
): Promise<NextResponse | null> {
  const normalized = (subdomain || "").toLowerCase().trim();
  const identity = await readAdminIdentity(normalized);

  if (!identity) {
    return NextResponse.json(
      { success: false, error: "Unauthorized — please sign in as admin" },
      { status: 401 },
    );
  }

  if (identity.role !== "admin" && !identity.capabilities.includes(capability)) {
    return NextResponse.json(
      {
        success: false,
        error: `A moderator account cannot access ${capability}. Sign in as the school admin.`,
      },
      { status: 403 },
    );
  }

  return null;
}

export type { SessionClaims };
