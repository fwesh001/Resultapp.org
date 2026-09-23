import { NextRequest, NextResponse } from "next/server";
import { getBackendBase, getSecret, requireTenantIdentity, upstreamError } from "@/app/api/notifications/_lib";

/**
 * POST /api/notifications/read
 * Body: { tenant_id, notification_id } → mark one as read
 *       { tenant_id, read_all: true }  → mark all as read
 * Identity: admin_session OR staff_session (resolved server-side, never trusted from client).
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = String(body.tenant_id ?? body.tenantId ?? "").toLowerCase().trim();
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

  const readAll = body.read_all === true || body.readAll === true;
  const base = getBackendBase();

  try {
    let url: string;
    let payload: Record<string, unknown>;
    if (readAll) {
      url = `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/notifications/read-all`;
      payload = { user_id, user_type };
    } else {
      const nid = Number(body.notification_id ?? body.notificationId);
      if (!Number.isInteger(nid) || nid <= 0) {
        return NextResponse.json({ success: false, error: "Missing notification_id" }, { status: 400 });
      }
      url = `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/notifications/${nid}/read`;
      payload = { user_id, user_type };
    }
    const r = await fetch(url, {
      method: "POST",
      headers: { "X-API-SECRET-KEY": secret, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "Mark-read failed") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[notifications read] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach notification service" }, { status: 502 });
  }
}
