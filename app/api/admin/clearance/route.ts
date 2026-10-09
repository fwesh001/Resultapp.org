import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Financial Clearance proxy (admin-only).
 *
 *   GET  /api/admin/clearance?tenantId=&term=&className=&search=
 *   PUT  /api/admin/clearance   { tenantId, term, student_ids[], is_financially_cleared, hold_reason? }
 *
 * Proxies to FastAPI /api/v1/tenant/{id}/clearance. This route is the ONLY
 * writer of clearance state, which is what guarantees a financial hold can
 * never be cleared as a side effect of republishing results (publication runs
 * through /credits/publish and does not touch the table).
 *
 * Deliberately does NOT revalidate the publication tags: clearance changes do
 * not alter whether a result is published, and the report bundle is fetched
 * with cache: "no-store", so a cleared student sees their result on the very
 * next lookup with no cache window.
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

/**
 * Admission numbers are stored with a lowercased alphabetic prefix
 * (`VHS/005` -> `vhs/005`). Normalising on the way in keeps the upsert from
 * creating a second clearance row for a student who already has one under
 * different casing — the report gate matches on LOWER() but the table key is
 * the raw string, so a mismatch would silently orphan the hold.
 */
function normalizeStudentId(raw: string): string {
  const t = String(raw).trim();
  if (!t) return t;
  const idx = t.indexOf("/");
  if (idx > -1) return t.slice(0, idx).toLowerCase() + t.slice(idx);
  const m = t.match(/^([A-Za-z]+)(.*)$/);
  if (m) return m[1].toLowerCase() + m[2];
  return t.toLowerCase();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get("tenantId") ?? sp.get("tenant_id") ?? "")
    .toLowerCase()
    .trim();
  const term = String(sp.get("term") ?? "").trim();
  const academicSession = String(sp.get("academic_session") ?? "").trim();
  const className = String(sp.get("className") ?? sp.get("class_name") ?? "").trim();
  const search = String(sp.get("search") ?? "").trim();
  const summaryOnly = sp.get("summary") === "1" || sp.get("summary") === "true";

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  }
  if (!term) {
    return NextResponse.json({ success: false, error: "Missing term" }, { status: 400 });
  }

  const guard = await requireAdminSession(tenantId);
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const base = getBackendBase();
  const qs = new URLSearchParams({ term });
  if (academicSession) qs.set("academic_session", academicSession);
  if (className) qs.set("class_name", className);
  if (search) qs.set("search", search);

  const path = summaryOnly ? "summary" : "";
  const url = `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/clearance${path ? `/${path}` : ""}?${qs.toString()}`;

  let backendRes: Response;
  try {
    backendRes = await fetch(url, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
  } catch (e) {
    console.error("[admin/clearance] backend fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach clearance service" },
      { status: 502 },
    );
  }

  const data = await backendRes.json().catch(() => ({}));
  if (!backendRes.ok) {
    const detail =
      (data as { detail?: unknown })?.detail ??
      (data as { error?: unknown })?.error ??
      `Clearance request failed (${backendRes.status})`;
    return NextResponse.json({ success: false, error: String(detail) }, { status: backendRes.status });
  }

  return NextResponse.json(data, { status: 200 });
}

export async function PUT(req: NextRequest) {
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
    student_ids: rawIds,
    studentIds: rawIdsAlt,
    is_financially_cleared: rawCleared,
    isFinanciallyCleared: rawClearedAlt,
    hold_reason: rawReason,
    holdReason: rawReasonAlt,
    held_by: rawBy,
    heldBy: rawByAlt,
  } = body as Record<string, unknown>;

  const tenantId = String(rawTenantId ?? rawTenantIdAlt ?? "").toLowerCase().trim();
  const termStr = String(term ?? "").trim();
  const sessionStr = String(rawSession ?? "").trim();
  const ids = (Array.isArray(rawIds) ? rawIds : Array.isArray(rawIdsAlt) ? rawIdsAlt : [])
    .map((s) => normalizeStudentId(String(s)))
    .filter(Boolean);
  const cleared =
    typeof rawCleared === "boolean" ? rawCleared : rawClearedAlt === true || rawClearedAlt === "true";
  const holdReason = String(rawReason ?? rawReasonAlt ?? "").trim() || undefined;
  const heldBy = String(rawBy ?? rawByAlt ?? "").trim() || undefined;

  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  if (!termStr) return NextResponse.json({ success: false, error: "Missing term" }, { status: 400 });
  if (typeof cleared !== "boolean") {
    return NextResponse.json(
      { success: false, error: "is_financially_cleared must be a boolean" },
      { status: 400 },
    );
  }
  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: "No student_ids provided" }, { status: 400 });
  }
  if (ids.length > 3000) {
    return NextResponse.json({ success: false, error: "Too many student_ids (max 3000)" }, { status: 400 });
  }

  // A hold with no stated reason is the state families get upset about, and it
  // makes the bursary dashboard unreadable later ("who is this and why?").
  // Requiring a reason at the proxy too keeps the rule uniform for every caller.
  if (!cleared && !holdReason) {
    return NextResponse.json(
      { success: false, error: "A hold reason is required when marking a student as owing" },
      { status: 400 },
    );
  }

  const guard = await requireAdminSession(tenantId);
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const base = getBackendBase();
  let backendRes: Response;
  try {
    backendRes = await fetch(
      `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/clearance`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
        body: JSON.stringify({
          student_ids: ids,
          term: termStr,
          academic_session: sessionStr || undefined,
          is_financially_cleared: cleared,
          hold_reason: holdReason,
          held_by: heldBy,
        }),
        cache: "no-store",
      },
    );
  } catch (e) {
    console.error("[admin/clearance] backend PUT failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach clearance service" },
      { status: 502 },
    );
  }

  const data = await backendRes.json().catch(() => ({}));
  if (!backendRes.ok) {
    const detail =
      (data as { detail?: unknown })?.detail ??
      (data as { error?: unknown })?.error ??
      `Clearance update failed (${backendRes.status})`;
    return NextResponse.json({ success: false, error: String(detail) }, { status: backendRes.status });
  }

  return NextResponse.json(data, { status: 200 });
}