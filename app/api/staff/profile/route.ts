import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Staff self-service profile — PATCH /api/staff/profile
 * Body: { tenant_id, staff_id?, signature_url }
 *
 * Identity rule: the caller may only edit their OWN row. The target defaults
 * to the session identity and any explicit staff_id must match a session
 * identifier (staff_id or UUID, case-insensitive); otherwise 403.
 * Forwards to FastAPI PATCH /api/v1/tenant/{id}/staff/{identifier}/profile.
 */

function getSecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

interface StaffSession {
  staff?: { id?: string; staff_id?: string };
  tenant_id?: string;
}

export async function PATCH(req: NextRequest) {
  let session: StaffSession | null = null;
  try {
    const raw = (await cookies()).get("staff_session")?.value;
    if (!raw) {
      return NextResponse.json({ success: false, error: "Unauthorized — please sign in again" }, { status: 401 });
    }
    session = JSON.parse(raw) as StaffSession;
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized — please sign in again" }, { status: 401 });
  }

  const tenant = String(session?.tenant_id || "").toLowerCase().trim();
  const sessionIds = [session?.staff?.staff_id, session?.staff?.id]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
  if (!tenant || sessionIds.length === 0 || !session?.staff) {
    return NextResponse.json({ success: false, error: "Unauthorized — please sign in again" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const bodyTenant = String(body.tenant_id ?? body.tenantId ?? tenant).toLowerCase().trim();
  if (bodyTenant !== tenant) {
    return NextResponse.json({ success: false, error: "Session does not belong to this school" }, { status: 403 });
  }
  // Default target = self; explicit targets must match a session identifier.
  const target = String(body.staff_id ?? body.staffId ?? sessionIds[0]).trim();
  if (!sessionIds.includes(target.toLowerCase())) {
    return NextResponse.json({ success: false, error: "You can only edit your own profile" }, { status: 403 });
  }
  const signatureUrl = String(body.signature_url ?? "");
  if (signatureUrl.length > 512) {
    return NextResponse.json({ success: false, error: "signature_url too long (max 512 chars)" }, { status: 422 });
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenant)}/staff/${encodeURIComponent(target)}/profile`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
        body: JSON.stringify({ signature_url: signatureUrl }),
        cache: "no-store",
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = (data as { detail?: unknown })?.detail ?? "Profile update failed";
      return NextResponse.json({ success: false, error: String(detail) }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[api/staff/profile] backend fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach profile service" }, { status: 502 });
  }
}
