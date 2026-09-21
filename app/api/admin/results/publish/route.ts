import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Result publication proxy (state-changing).
 * POST /api/admin/results/publish
 * Body: { tenantId, term, academic_session?, student_ids: string[], published_by? }
 *
 * Proxies to FastAPI POST /api/v1/tenant/{id}/credits/publish which deducts
 * 1 credit per newly published student (re-prints cost 0). Revalidates the
 * tenant + publication caches so report gates clear instantly.
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
    student_ids: rawIds,
    studentIds: rawIdsAlt,
    published_by: rawBy,
    publishedBy: rawByAlt,
  } = body as Record<string, unknown>;

  const tenantId = String(rawTenantId ?? rawTenantIdAlt ?? "").toLowerCase().trim();
  const termStr = String(term ?? "").trim();
  const sessionStr = String(rawSession ?? rawSessionAlt ?? "").trim();
  const ids = (Array.isArray(rawIds) ? rawIds : Array.isArray(rawIdsAlt) ? rawIdsAlt : [])
    .map((s) => {
      const t = String(s).trim();
      if (!t) return t;
      const idx = t.indexOf("/");
      if (idx > -1) return t.slice(0, idx).toLowerCase() + t.slice(idx);
      const m = t.match(/^([A-Za-z]+)(.*)$/);
      if (m) return m[1].toLowerCase() + m[2];
      return t.toLowerCase();
    })
    .filter(Boolean);
  const publishedBy = String(rawBy ?? rawByAlt ?? "").trim() || undefined;

  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  if (!termStr) return NextResponse.json({ success: false, error: "Missing term" }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ success: false, error: "No student_ids provided" }, { status: 400 });
  if (ids.length > 3000) return NextResponse.json({ success: false, error: "Too many student_ids (max 3000)" }, { status: 400 });

  const guard = await requireAdminSession(tenantId);
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const base = getBackendBase();
  let backendRes: Response;
  try {
    backendRes = await fetch(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({
        term: termStr,
        academic_session: sessionStr || undefined,
        student_ids: ids,
        published_by: publishedBy,
      }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[admin/results/publish] backend fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach publication service" }, { status: 502 });
  }

  const data = await backendRes.json().catch(() => ({}));
  if (!backendRes.ok) {
    const detail =
      (data as { detail?: unknown })?.detail ??
      (data as { error?: unknown })?.error ??
      `Publication failed (${backendRes.status})`;
    const msg = Array.isArray(detail)
      ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
      : String(detail);
    // 402 = insufficient credits — surface as-is so the UI can prompt top-up.
    return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
  }

  try {
    (revalidateTag as unknown as (tag: string, profile?: string) => void)(`school-${tenantId}`, "max");
    (revalidateTag as unknown as (tag: string, profile?: string) => void)(`pub-${tenantId}`, "max");
  } catch (e) {
    console.warn("[admin/results/publish] revalidateTag failed", e);
  }

  return NextResponse.json(data, { status: 200 });
}
