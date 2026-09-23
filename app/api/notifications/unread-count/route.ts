import { NextRequest, NextResponse } from "next/server";
import { getBackendBase, getSecret, requireTenantIdentity, upstreamError } from "@/app/api/notifications/_lib";

/**
 * GET /api/notifications/unread-count?tenant_id=vhs
 * Lightweight bell poll. Identity: admin_session OR staff_session.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = (searchParams.get("tenant_id") || "").toLowerCase().trim();
  if (!tenantId) {
    return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });
  }

  const auth = await requireTenantIdentity(tenantId);
  if ("error" in auth) return auth.error;
  const { user_id, user_type } = auth.identity;

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const qs = new URLSearchParams({ user_id, user_type });

  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/notifications/unread-count?${qs.toString()}`,
      { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "Unread count failed") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[notifications unread-count] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach notification service" }, { status: 502 });
  }
}
