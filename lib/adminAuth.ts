import { cookies } from "next/headers";
import { NextResponse } from "next/server";

interface AdminSession {
  admin?: { email?: string };
  tenant_id?: string;
}

/**
 * Phase 2 — shared guard for admin-only API proxies.
 *
 * Returns `null` when the request carries a valid `admin_session` cookie
 * whose tenant matches `tenantId`. Otherwise returns a JSON error response
 * (400 unknown tenant / 401 unauthenticated) for the handler to return.
 *
 * Legacy schools with NULL `admin_password_hash` can never mint a session,
 * so they always get 401 here — the login UI handles that case with the
 * friendly "set up your admin password" banner + setup link.
 */
export async function requireAdminSession(tenantId: string): Promise<NextResponse | null> {
  const normalized = (tenantId || "").toLowerCase().trim();
  if (!normalized) {
    return NextResponse.json(
      { success: false, error: "Missing tenant_id" },
      { status: 400 },
    );
  }

  let raw: string | undefined;
  try {
    raw = (await cookies()).get("admin_session")?.value;
  } catch {
    raw = undefined;
  }
  if (!raw) {
    return NextResponse.json(
      { success: false, error: "Unauthorized — please sign in as admin" },
      { status: 401 },
    );
  }

  try {
    const session = JSON.parse(raw) as AdminSession;
    const tenant = String(session?.tenant_id || "").toLowerCase().trim();
    const email = String(session?.admin?.email || "").trim();
    if (!tenant || tenant !== normalized || !email || !session?.admin) {
      return NextResponse.json(
        { success: false, error: "Unauthorized — please sign in as admin" },
        { status: 401 },
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Unauthorized — please sign in as admin" },
      { status: 401 },
    );
  }

  return null;
}
