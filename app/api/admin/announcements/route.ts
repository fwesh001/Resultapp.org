import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

function getProxySecret(): string {
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

const MESSAGE_TYPES = ["Meeting", "Urgent", "Reminder", "General"] as const;

/**
 * POST /api/admin/announcements
 * Body: { tenantId, message_type, title, message }
 * Tenant-admin only (admin_session cookie, tenant-matched). Forwards to
 * FastAPI POST /api/v1/tenant/{id}/staff/broadcast which fans out an
 * ANNOUNCEMENT to all active staff (admin gets a pre-read copy, no bell).
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = String(body.tenantId ?? body.tenant_id ?? "").toLowerCase().trim();
  if (!tenantId) {
    return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  }
  const guard = await requireAdminSession(tenantId);
  if (guard) return guard;

  const messageType = String(body.message_type ?? body.messageType ?? "").trim();
  const title = String(body.title ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!(MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    return NextResponse.json(
      { success: false, error: `message_type must be one of ${MESSAGE_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!title || !message) {
    return NextResponse.json({ success: false, error: "Missing title or message" }, { status: 400 });
  }
  if (title.length > 200 || message.length > 2000) {
    return NextResponse.json({ success: false, error: "Title (200) or message (2000) too long" }, { status: 400 });
  }

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ message_type: messageType, title, message }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? `Announcement failed (${r.status})`;
      const msg = Array.isArray(detail)
        ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
        : String(detail);
      return NextResponse.json({ success: false, error: msg }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin/announcements] backend fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach notification service" }, { status: 502 });
  }
}
