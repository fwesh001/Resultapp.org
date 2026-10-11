import { NextResponse } from "next/server";
import { readSessionCookie, clearSessionCookie, SESSION_COOKIES } from "./session";

/**
 * Student session guard.
 *
 * Mirrors lib/staffAuth.ts deliberately: same shape, same tenant-binding rule,
 * same "clear the bad cookie so the browser stops presenting it" behaviour.
 * When a second guard is added to a codebase that already has one, copying the
 * proven shape is cheaper than inventing a new one — and a student guard that
 * quietly omitted tenant binding would be the exact bug staffAuth.ts was
 * written to prevent.
 */

export interface StudentSessionPayload {
  student?: {
    id?: string;
    student_id?: string;
    full_name?: string;
    class_name?: string;
    must_change_password?: boolean;
  };
  tenant_id?: string;
}

export interface StudentIdentity {
  tenantId: string;
  /** Preferred identifier: the stored admission number. */
  studentId: string;
  /**
   * Every identifier this session carries, lowercased. The login response
   * carries both the admission number and the row UUID; callers accepting either
   * must survive verification.
   */
  studentIds: string[];
  fullName: string | null;
  className: string | null;
  /**
   * Soft prompt only. Never treat this as an authorization signal or redirect
   * on it — a shared family device would strand whoever did not get to change
   * the password.
   */
  mustChangePassword: boolean;
}

/** Tenant ids are DNS labels; same rule enforced by the backend. */
const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;

function normalizeTenant(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}

/**
 * Compare two admission numbers for equality, tolerating the legacy compact
 * form.
 *
 * This is load-bearing for preview mode. `vhs` stores BOTH `vhs/004` and the
 * legacy compact `vhs004` (see LEGAL_REMEDIATION.md on the id-drift this
 * caused), and report.py already resolves a slashed request to the compact
 * stored row. Without the same tolerance here, a student who signed in as
 * `vhs004` would open a shared link to `vhs/004` and be shown a LOCKED preview
 * of their own card — the most confusing possible failure.
 *
 * Only strips the FIRST slash, and only when what remains is still a plausible
 * id, so this cannot collapse two genuinely different students into one match.
 */
export function studentIdsMatch(a: unknown, b: unknown): boolean {
  const left = String(a ?? "").trim().toLowerCase();
  const right = String(b ?? "").trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;

  const compact = (v: string) => {
    const i = v.indexOf("/");
    if (i === -1) return v;
    // Only compact when the parts are both non-empty; "vhs/" and "/004" are
    // malformed input, not alternate spellings.
    const head = v.slice(0, i);
    const tail = v.slice(i + 1);
    if (!head || !tail || tail.includes("/")) return v;
    return head + tail;
  };

  return compact(left) === compact(right);
}

/**
 * Verify the student session and bind it to `expectedTenant`.
 *
 * `expectedTenant` is required for every caller. Without it, a legitimately
 * signed session for one school would be accepted on another school's routes —
 * and because admission numbers are sequential and per-school, that would hand
 * one child another child's report.
 */
export async function readStudentSession(
  expectedTenant?: string | null,
): Promise<StudentIdentity | null> {
  const session = await readSessionCookie<StudentSessionPayload>(SESSION_COOKIES.student);
  if (!session) return null;

  const tenantId = normalizeTenant(session.tenant_id);
  if (!tenantId || !SUBDOMAIN_RE.test(tenantId)) return null;

  const expected = normalizeTenant(expectedTenant);
  if (expected && tenantId !== expected) return null;

  const studentId = String(session.student?.student_id || "").trim();
  if (!studentId || !session.student) return null;

  const studentIds = [session.student?.student_id, session.student?.id]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);

  return {
    tenantId,
    studentId,
    studentIds,
    fullName: String(session.student?.full_name ?? "").trim() || null,
    className: String(session.student?.class_name ?? "").trim() || null,
    mustChangePassword: session.student?.must_change_password === true,
  };
}

/**
 * Does this session authorize reading `requestedStudentId`?
 *
 * The ONLY place that decides preview vs full report, and it is deliberately
 * conservative: the requested id must match one of the session's identifiers
 * under the slash/compact-tolerant comparison. Any caller that wants to show a
 * full card must go through here rather than testing the session for mere
 * existence.
 */
export async function studentMayView(
  expectedTenant: string,
  requestedStudentId: string,
): Promise<boolean> {
  const identity = await readStudentSession(expectedTenant);
  if (!identity) return false;
  return identity.studentIds.some((id) => studentIdsMatch(id, requestedStudentId));
}

/**
 * Route-handler guard: returns a 401 `NextResponse` and clears the offending
 * cookie when the session is missing, unsigned, forged or tenant-mismatched.
 * Returns `null` when the caller may proceed.
 */
export async function requireStudentSession(
  expectedTenant: string,
): Promise<NextResponse | null> {
  const guardError = async () => {
    await clearSessionCookie(SESSION_COOKIES.student);
    return NextResponse.json(
      { success: false, error: "Unauthorized — please sign in again" },
      { status: 401 },
    );
  };

  try {
    const identity = await readStudentSession(expectedTenant);
    if (!identity) return await guardError();
    return null;
  } catch {
    return await guardError();
  }
}