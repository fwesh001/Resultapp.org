import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Result Command Center data proxy (read-only).
 * GET /api/admin/results?tenant_id=vhs&term=Term%201&academic_session=2025/2026
 *
 * Merges FastAPI command-center /summary + /classes into one payload so the
 * results page renders with a single round-trip. No state is mutated here.
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

async function proxyGet(url: string, secret: string) {
  const res = await fetch(url, {
    headers: { "X-API-SECRET-KEY": secret },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { detail?: string })?.detail || `Upstream failed (${res.status})`,
    );
  }
  return data;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = (searchParams.get("tenant_id") || "").toLowerCase().trim();
  const term = searchParams.get("term") || "";
  const academicSession = searchParams.get("academic_session") || "";
  const view = searchParams.get("view") || "";
  const className = searchParams.get("class_name") || "";

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });
  }
  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const base = getBackendBase();
  const qs = new URLSearchParams();
  if (term) qs.set("term", term);
  if (academicSession) qs.set("academic_session", academicSession);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  try {
    // Drill-down passthrough: ?view=missing&class_name=JSS1&term=Term%201
    if (view === "missing") {
      if (!className || !term) {
        return NextResponse.json(
          { success: false, error: "view=missing requires class_name and term" },
          { status: 400 },
        );
      }
      const qs = new URLSearchParams({ class_name: className, term });
      const data = await proxyGet(
        `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/command-center/missing?${qs.toString()}`,
        secret,
      );
      return NextResponse.json({ success: true, ...(data as Record<string, unknown>) });
    }
    const [summary, classes] = await Promise.all([
      proxyGet(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/command-center/summary${suffix}`, secret),
      proxyGet(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/command-center/classes${suffix}`, secret),
    ]);
    return NextResponse.json({ success: true, ...summary, ...classes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Command center unavailable";
    console.error("[admin/results] upstream failed", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
