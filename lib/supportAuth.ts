import { readSessionCookie, SESSION_COOKIES } from "./session";

/**
 * Support Hub — OPTIONAL identity resolution.
 *
 * Deliberately the inverse of `requireAdminSession` / `requireSuperadmin`:
 * those return a `NextResponse` to bail out with, and a 401 is the correct
 * outcome. Here a missing session is a normal, expected case — an anonymous
 * visitor on the marketing /support page is a first-class submitter, so this
 * returns `null` and the caller records an unlinked ticket.
 *
 * NEVER THROWS. A rejected, unsigned, forged or tampered cookie must degrade to
 * `null` so the ticket is filed as `anonymous` and the backend's own invariant
 * check (support.py: an anonymous submitter may not carry a tenant_id) applies.
 * Throwing here would let an attacker turn a bad cookie into an exception path
 * rather than a silent downgrade.
 *
 * Why this mostly returns null in practice: session cookies are host-only (no
 * Domain attribute), so the `admin_session` minted on `vhs.resultapp.org` is
 * never sent to `resultapp.org/support`. The reader is still correct and still
 * fires for same-host submissions (e.g. a support page served under a tenant
 * subdomain) — we just do not claim attribution we cannot verify.
 *
 * Trust rule enforced by the caller: an authenticated session's email and
 * tenant always OVERWRITE whatever the visitor typed into the form, so nobody
 * can file a ticket "as" a tenant admin by typing their address. That rule only
 * holds because the session here is signature-verified — before P0-0 a forged
 * cookie could plant a ticket attributed to a victim school.
 */

export interface SubmitterIdentity {
  tenantId: string | null;
  email: string | null;
  role: string | null;
  kind: "admin" | "staff";
  userId: string | null;
}

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;

function normalizeTenant(value: unknown): string | null {
  const tenant = String(value ?? "").toLowerCase().trim();
  return SUBDOMAIN_RE.test(tenant) ? tenant : null;
}

function cleanEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || email.length > 255) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Read whichever portal session is present. Admin wins over staff so a user who
 * is both is attributed as an admin. Never throws; any missing, unsigned,
 * forged, malformed or expired cookie is treated as "no session".
 */
export async function readOptionalSession(): Promise<SubmitterIdentity | null> {
  try {
    const admin = await readSessionCookie<{
      admin?: { email?: string };
      tenant_id?: string;
    }>(SESSION_COOKIES.admin);
    if (admin) {
      const tenantId = normalizeTenant(admin.tenant_id);
      const email = cleanEmail(admin.admin?.email);
      // A usable admin session needs both halves, mirroring requireAdminSession.
      if (tenantId && email && admin.admin) {
        return {
          tenantId,
          email,
          role: "admin",
          kind: "admin",
          userId: email,
        };
      }
    }
  } catch {
    // fall through to staff
  }

  try {
    const staff = await readSessionCookie<{
      staff?: { id?: string; staff_id?: string; email?: string; role?: string };
      tenant_id?: string;
    }>(SESSION_COOKIES.staff);
    if (staff) {
      const tenantId = normalizeTenant(staff.tenant_id);
      const email = cleanEmail(staff.staff?.email);
      if (tenantId && staff.staff) {
        return {
          tenantId,
          email,
          role: String(staff.staff?.role ?? "").trim() || "teacher",
          kind: "staff",
          userId: String(staff.staff.id ?? staff.staff.staff_id ?? email ?? ""),
        };
      }
    }
  } catch {
    // fall through to anonymous
  }

  return null;
}
