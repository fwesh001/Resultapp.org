import { NextResponse } from "next/server";
import { readSessionCookie, clearSessionCookie, SESSION_COOKIES } from "./session";
import { getBackendBase, getSecret } from "@/app/api/superadmin/_lib";
import { isPlatformPageId, resolvePlatformPages, type PlatformPageId } from "./platformPages";

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

// ═══════════════════════════════════════════════════════════════════════════
// Platform RBAC — page allocation (Team screen, P1 item 21)
//
// requireSuperadmin above answers "is this a validly signed superadmin
// session?" — and NOTHING else. Before the Team screen existed the role claim
// was minted and then ignored, so every active platform_admins row (owner,
// admin, support) had the full Command Center, and the legacy env-password
// path had no identity at all. resolveSuperadminAccess closes that: it
// resolves WHO is signed in (from the signed session) and WHICH Command
// Center sections they may open (from the DB, per request — not from the
// 12-hour cookie, so a page allocated or removed takes effect on the next
// navigation, not after re-login).
//
// Fail-closed throughout: an unreachable backend yields pages=[] (a member
// keeps nothing rather than everything), and an identity-less session yields
// [] in production outright because login refuses to mint one there.
// ═══════════════════════════════════════════════════════════════════════════

export interface SuperadminAccess {
  /** null for the legacy identity-less path (dev only after phase-out). */
  identity: SuperadminIdentity | null;
  /** Role	text from the DB when resolvable; the signed cookie's claim otherwise. */
  role: string | null;
  email: string | null;
  /** Effective Command Center pages. Empty (not null) = deny everything. */
  pages: PlatformPageId[];
  /** Signed-in member's adminId - Team self-protection checks key off this. */
  adminId: string | null;
  /** Short-lived backend failure flag — UI may show a degraded banner. */
  degraded: boolean;
}

const PROD =
  (process.env.NODE_ENV ?? "development") === "production" ||
  (process.env.ENV ?? "").trim().toLowerCase() === "production";

/** Fetch one member's effective pages. null = unreachable/unresolvable. */
async function fetchMemberPages(adminId: string): Promise<{
  role: string | null;
  email: string | null;
  isActive: boolean | null;
  pages: PlatformPageId[] | null;
} | null> {
  const secret = getSecret();
  if (!secret) return null;
  try {
    const res = await fetch(
      `${getBackendBase()}/api/v1/platform/admins/${encodeURIComponent(adminId)}`,
      { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
      admin?: { role?: string; pages?: string[]; email?: string; is_active?: boolean };
    };
    const admin = data.admin;
    if (!admin || typeof admin.pages === "undefined") return null;
    return {
      role: typeof admin.role === "string" ? admin.role : null,
      email: typeof admin.email === "string" ? admin.email : null,
      isActive: typeof admin.is_active === "boolean" ? admin.is_active : null,
      pages: admin.pages.filter(isPlatformPageId) as PlatformPageId[],
    };
  } catch {
    return null;
  }
}

export async function resolveSuperadminAccess(): Promise<SuperadminAccess | null> {
  // Unauthenticated / forged: same contract as requireSuperadmin — the caller
  // sends the viewer to login.
  try {
    const session = await readSessionCookie<{ superadmin?: boolean }>(SESSION_COOKIES.superadmin);
    if (!session || session.superadmin !== true) return null;
  } catch {
    return null;
  }

  const identity = await readSuperadminIdentity();

  // Legacy identity-less session. Production login no longer mints these
  // (phase-out); an old one lingering in a browser is denied everywhere.
  if (!identity?.adminId) {
    if (PROD) {
      return {
        identity: null,
        role: null,
        email: null,
        pages: [],
        adminId: null,
        degraded: false,
      };
    }
    // Dev: keep the legacy path usable as a full-view break-glass.
    return {
      identity: null,
      role: "owner",
      email: null,
      pages: resolvePlatformPages("owner", null),
      adminId: null,
      degraded: false,
    };
  }

  const member = await fetchMemberPages(identity.adminId);
  if (member === null) {
    // Backend unreachable or lookup failed — deny everything (fail closed),
    // marked degraded so the UI can say WHY nothing is reachable.
    return {
      identity,
      role: identity.role,
      email: identity.email,
      pages: [],
      adminId: identity.adminId,
      degraded: true,
    };
  }
  if (member.isActive === false) {
    // Freshly disabled while a session was still live: nothing.
    return {
      identity,
      role: member.role ?? identity.role,
      email: identity.email,
      pages: [],
      adminId: identity.adminId,
      degraded: false,
    };
  }
  return {
    identity,
    // DB role wins over the cookie claim — the enforcement target.
    role: member.role ?? identity.role,
    email: identity.email ?? member.email,
    pages: member.pages ?? [],
    adminId: identity.adminId,
    degraded: false,
  };
}

/**
 * Route-handler guard with a page requirement. Layered on requireSuperadmin:
 * 401 when there is no valid superadmin session at all, 403 when the signed
 * member holds a session but not this Command Center page.
 *
 * `pages` accepts several ids when one endpoint serves two sections (e.g. the
 * grant/adjust proxy is reachable from BOTH the Tenants detail page and the
 * dedicated Adjustments page).
 */
export async function requireSuperadminPage(
  ...pageArgs: Array<PlatformPageId | PlatformPageId[]>
): Promise<NextResponse | null> {
  const wanted = pageArgs.flatMap((arg) => (Array.isArray(arg) ? arg : [arg]));
  const access = await resolveSuperadminAccess();
  if (access === null) {
    await clearSessionCookie(SESSION_COOKIES.superadmin);
    return NextResponse.json(
      { success: false, error: "Unauthorized — superadmin sign-in required" },
      { status: 401 },
    );
  }
  if (wanted.some((p) => access.pages.includes(p))) return null;
  return NextResponse.json(
    {
      success: false,
      error: `Forbidden — your Command Center scope does not include ${wanted.join("/")}`,
    },
    { status: 403 },
  );
}

/**
 * Owner-only variant. Team management is the one surface where role must be
 * checked outright — a support member holding an allocated "tenants" page has
 * no message for owning member administration.
 */
export async function requireSuperadminOwner(): Promise<NextResponse | null> {
  const access = await resolveSuperadminAccess();
  if (access === null) {
    await clearSessionCookie(SESSION_COOKIES.superadmin);
    return NextResponse.json(
      { success: false, error: "Unauthorized — superadmin sign-in required" },
      { status: 401 },
    );
  }
  if (access.role !== "owner" || !access.adminId) {
    return NextResponse.json(
      { success: false, error: "Forbidden — only the platform owner manages Team members" },
      { status: 403 },
    );
  }
  return null;
}
