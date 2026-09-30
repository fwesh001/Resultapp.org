import { NextResponse } from "next/server";
import {
  readSessionCookie,
  clearSessionCookie,
  SESSION_COOKIES,
  type SessionCookieName,
} from "./session";
import type { SessionClaims } from "./sessionCrypto";

/**
 * Staff session guard (LEGAL_REMEDIATION.md P0-0).
 *
 * This module did not exist. Staff session parsing was reimplemented inline in
 * seven independent places — `api/staff/grading`, `api/staff/profile`,
 * `api/staff/uploads`, the staff dashboard layout, the staff dashboard page,
 * plus cross-portal readers in `lib/supportAuth` and
 * `app/api/notifications/_lib`. None of them verified a signature, and the two
 * dashboard guards did not check `tenant_id` at all, so a valid staff session
 * for one school would render another's dashboard.
 *
 * Every staff read now goes through here.
 */

export interface StaffSessionPayload {
  staff?: {
    id?: string;
    staff_id?: string;
    full_name?: string;
    email?: string;
    role?: string;
  };
  tenant_id?: string;
}

export interface StaffIdentity {
  tenantId: string;
  staffId: string;
  email: string | null;
  fullName: string | null;
  role: string;
}

/** Tenant ids are DNS labels; same rule enforced by the backend. */
const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;

function normalizeTenant(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}

/**
 * Verify the staff session and bind it to `expectedTenant`.
 *
 * `expectedTenant` is required for every caller: without it a legitimately
 * signed session for one tenant would be accepted on any other tenant's
 * routes, which is exactly the gap the old dashboard guards had. Pass `null`
 * only where the tenant genuinely is not known yet, and prefer resolving the
 * tenant first.
 */
export async function readStaffSession(
  expectedTenant?: string | null,
): Promise<StaffIdentity | null> {
  const session = await readSessionCookie<StaffSessionPayload>(SESSION_COOKIES.staff);
  if (!session) return null;

  const tenantId = normalizeTenant(session.tenant_id);
  if (!tenantId || !SUBDOMAIN_RE.test(tenantId)) return null;

  // Tenant binding is mandatory when the caller knows which tenant it serves.
  const expected = normalizeTenant(expectedTenant);
  if (expected && tenantId !== expected) return null;

  const staffId = String(session.staff?.staff_id || session.staff?.id || "").trim();
  if (!staffId || !session.staff) return null;

  return {
    tenantId,
    staffId,
    email: String(session.staff?.email ?? "").trim().toLowerCase() || null,
    fullName: String(session.staff?.full_name ?? "").trim() || null,
    role: String(session.staff?.role ?? "").trim() || "Teacher",
  };
}

/**
 * Route-handler guard: returns a 401 `NextResponse` and clears the offending
 * cookie when the session is missing, unsigned, forged or tenant-mismatched.
 * Returns `null` when the caller may proceed.
 */
export async function requireStaffSession(
  expectedTenant: string,
): Promise<NextResponse | null> {
  const guardError = async () => {
    // A bad cookie is actively removed so the browser stops presenting it.
    await clearSessionCookie(SESSION_COOKIES.staff);
    return NextResponse.json(
      { success: false, error: "Unauthorized — please sign in again" },
      { status: 401 },
    );
  };

  try {
    const identity = await readStaffSession(expectedTenant);
    if (!identity) return await guardError();
    return null;
  } catch {
    return await guardError();
  }
}

export type { SessionClaims, SessionCookieName };
