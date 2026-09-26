import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Bulk principal-remarks proxy (Smart Remarks, admin-only).
 * POST /api/admin/results/apply-principal-remarks
 * Body: { tenantId, term, academic_session?, class_names: string[] }
 *
 * Restricted to explicitly selected classes (no whole-tenant sweep) and
 * never overwrites existing remarks (backend default overwrite=false).
 * Proxies to FastAPI POST /api/v1/tenant/{id}/command-center/apply-principal-remarks.
 */

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

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const {
    tenantId: rawTenantId,
    tenant_id: rawTenantIdAlt,
    term,
    academic_session: rawSession,
    academicSession: rawSessionAlt,
    class_names: rawClasses,
    classNames: rawClassesAlt,
  } = body as Record<string, unknown>;

  const tenantId = String(rawTenantId ?? rawTenantIdAlt ?? "").toLowerCase().trim();
  const termStr = String(term ?? "").trim();
  const sessionStr = String(rawSession ?? rawSessionAlt ?? "").trim();
  const classNames = (Array.isArray(rawClasses) ? rawClasses : Array.isArray(rawClassesAlt) ? rawClassesAlt : [])
    .map((c) => String(c).trim())
    .filter(Boolean);

  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  if (!termStr) return NextResponse.json({ success: false, error: "Missing term" }, { status: 400 });
  if (classNames.length === 0) return NextResponse.json({ success: false, error: "Select at least one class" }, { status: 400 });
  if (classNames.length > 20) return NextResponse.json({ success: false, error: "At most 20 classes per batch" }, { status: 400 });

  const guard = await requireAdminSession(tenantId);
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const base = getBackendBase();
  let backendRes: Response;
  try {
    backendRes = await fetch(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/command-center/apply-principal-remarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({
        term: termStr,
        academic_session: sessionStr || undefined,
        class_names: classNames,
        overwrite: false,
      }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[admin/results/apply-principal-remarks] backend fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach remark service" }, { status: 502 });
  }

  const data = await backendRes.json().catch(() => ({}));
  if (!backendRes.ok) {
    const detail =
      (data as { detail?: unknown })?.detail ??
      (data as { error?: unknown })?.error ??
      `Apply failed (${backendRes.status})`;
    const msg = Array.isArray(detail)
      ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
      : String(detail);
    return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
  }

  return NextResponse.json(data, { status: 200 });
}
