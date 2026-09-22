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
