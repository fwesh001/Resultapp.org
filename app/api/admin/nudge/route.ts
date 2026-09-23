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

/**
 * POST /api/admin/nudge
 * Body: { tenantId, staff_id?, staff_name?, staff_email?, subject_name, class_name, term? }
 * Tenant-admin only (admin_session cookie, tenant-matched). Forwards to
 * FastAPI POST /api/v1/tenant/{id}/staff/nudge which dispatches an in-app
 * STAFF_GRADING_REMINDER with a grading-hub deep link (24h cooldown).
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

  const subject = String(body.subject_name ?? body.subjectName ?? "").trim();
  const className = String(body.class_name ?? body.className ?? "").trim();
  if (!subject || !className) {
    return NextResponse.json({ success: false, error: "Missing subject_name or class_name" }, { status: 400 });
  }

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/nudge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({
        staff_id: body.staff_id ?? null,
        staff_name: body.staff_name ?? body.staffName ?? null,
        staff_email: body.staff_email ?? body.staffEmail ?? null,
        subject_name: subject,
        class_name: className,
        term: body.term ?? null,
      }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? `Nudge failed (${r.status})`;
      const msg = Array.isArray(detail)
        ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
        : String(detail);
      return NextResponse.json({ success: false, error: msg }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin/nudge] backend fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach notification service" }, { status: 502 });
  }
}
