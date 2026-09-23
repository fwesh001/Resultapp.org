import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/** Shared helpers for tenant notification proxies (server-only). */

export function getSecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

export function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

export function upstreamError(data: unknown, fallback: string) {
  const detail =
    (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? fallback;
  return Array.isArray(detail)
    ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
    : String(detail);
}

interface Identity {
  user_id: string;
  user_type: "admin" | "staff";
}

/**
 * Crucial identity handling: accept EITHER session cookie.
 * - admin_session { admin: { email }, tenant_id } → user_type='admin', user_id=email
 * - staff_session { staff: { id, staff_id, email }, tenant_id } → user_type='staff', user_id=id||staff_id
 * Returns the identity or a 401 JSON response when neither matches the tenant.
 */
export async function requireTenantIdentity(
  tenantId: string,
): Promise<{ identity: Identity } | { error: NextResponse }> {
  const normalized = (tenantId || "").toLowerCase().trim();
  if (!normalized) {
    return {
      error: NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 }),
    };
  }

  let adminRaw: string | undefined;
  let staffRaw: string | undefined;
  try {
    const store = await cookies();
    adminRaw = store.get("admin_session")?.value;
    staffRaw = store.get("staff_session")?.value;
  } catch {
    adminRaw = undefined;
    staffRaw = undefined;
  }

  // Admin first (admin and staff cookies are mutually exclusive per portal).
  if (adminRaw) {
    try {
      const session = JSON.parse(adminRaw) as { admin?: { email?: string }; tenant_id?: string };
      const tenant = String(session?.tenant_id || "").toLowerCase().trim();
      const email = String(session?.admin?.email || "").trim();
      if (tenant === normalized && email && session?.admin) {
        return { identity: { user_id: email, user_type: "admin" } };
      }
    } catch {
      // fall through to staff check
    }
  }

  if (staffRaw) {
    try {
      const session = JSON.parse(staffRaw) as {
        staff?: { id?: string; staff_id?: string; email?: string };
        tenant_id?: string;
      };
      const tenant = String(session?.tenant_id || "").toLowerCase().trim();
      const staff = session?.staff;
      const userId = String(staff?.id || staff?.staff_id || "").trim();
      if (tenant === normalized && staff && userId) {
        return { identity: { user_id: userId, user_type: "staff" } };
      }
    } catch {
      // fall through to 401
    }
  }

  return {
    error: NextResponse.json(
      { success: false, error: "Unauthorized — please sign in" },
      { status: 401 },
    ),
  };
}
