import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Phase: Superadmin Command Center — shared gate.
 * Session cookie `superadmin_session` is set by POST /api/superadmin/login
 * after verifying SUPERADMIN_PASSWORD. Value is an opaque JSON blob;
 * validity = presence + well-formed + not expired (maxAge enforced by cookie).
 */
export async function requireSuperadmin(): Promise<NextResponse | null> {
  let raw: string | undefined;
  try {
    raw = (await cookies()).get("superadmin_session")?.value;
  } catch {
    raw = undefined;
  }
  if (!raw) {
    return NextResponse.json(
      { success: false, error: "Unauthorized — superadmin sign-in required" },
      { status: 401 },
    );
  }
  try {
    const session = JSON.parse(raw) as { superadmin?: boolean; created_at?: string };
    if (!session?.superadmin) throw new Error("bad session");
  } catch {
    return NextResponse.json(
      { success: false, error: "Unauthorized — superadmin sign-in required" },
      { status: 401 },
    );
  }
  return null;
}

export interface SuperadminIdentity {
  email: string | null;
  adminId: string | null;
  role: string | null;
}

/**
 * Best-effort identity of the signed-in superadmin, for attribution on writes
 * that end up in `audit_logs` (which stores actor/actor_id but never sees the
 * browser cookie — only the Next.js proxy does).
 *
 * Returns null for the legacy `SUPERADMIN_PASSWORD` fallback path, which mints
 * an identity-less `{ superadmin: true }` session. Callers must tolerate that;
 * it is not an auth failure, since `requireSuperadmin` already passed.
 */
export async function readSuperadminIdentity(): Promise<SuperadminIdentity | null> {
  let raw: string | undefined;
  try {
    raw = (await cookies()).get("superadmin_session")?.value;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as {
      superadmin?: boolean;
      email?: string;
      admin_id?: string;
      role?: string;
    };
    if (!session?.superadmin) return null;
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
