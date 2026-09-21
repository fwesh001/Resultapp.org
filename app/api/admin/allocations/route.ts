import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Allocations & Roster proxy — single unified proxy per decision 5
 * Proxies to FastAPI:
 *   GET    http://159.223.178.34:8000/api/v1/tenant/{tenant_id}/roster
 *   POST   http://159.223.178.34:8000/api/v1/tenant/{tenant_id}/roster  body {type,...}
 *   DELETE http://159.223.178.34:8000/api/v1/tenant/{tenant_id}/roster/{type}/{id}
 * Tenant via ?tenant_id query or body.tenant_id or host subdomain.
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

function resolveTenantId(req: NextRequest, body?: Record<string, unknown>): string {
  const urlTenant = req.nextUrl.searchParams.get("tenant_id") || req.nextUrl.searchParams.get("tenantId") || "";
  const bodyTenant = (body?.tenant_id as string) || (body as Record<string, unknown> | undefined)?.tenantId as string || "";
  if (urlTenant) return urlTenant.toLowerCase().trim();
  if (bodyTenant) return String(bodyTenant).toLowerCase().trim();
  const host = req.headers.get("host") || "";
  const sub = host.split(":")[0].split(".")[0];
  if (sub && sub !== "www" && sub !== "localhost" && host.split(".").length > 2) return sub.toLowerCase().trim();
  return "";
}

export async function GET(req: NextRequest) {
  const secret = getSecret();
  if (!secret) return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });

  const tenantId = resolveTenantId(req);
  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });

  const url = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/roster`;
  try {
    const r = await fetch(url, { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ success: false, error: (data as { detail?: string })?.detail || "Failed to fetch roster", raw: data }, { status: r.status });
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[allocations proxy GET] failed", e);
    return NextResponse.json({ success: false, error: "Could not reach roster service" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const secret = getSecret();
  if (!secret) return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = resolveTenantId(req, body);
  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenant_id (subdomain)" }, { status: 400 });

  // ensure body has subdomain-compatible field? FastAPI expects tenant_id in path, not body
  const url = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/roster`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await r.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) {
      const detail = (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? text;
      const msg = Array.isArray(detail) ? (detail as Array<{msg?:string}>).map(d=>d.msg||JSON.stringify(d)).join("; ") : String(detail);
      return NextResponse.json({ success: false, error: msg, raw: data }, { status: r.status });
    }
    return NextResponse.json(data, { status: r.status });
  } catch (e) {
    console.error("[allocations proxy POST] failed", e);
    return NextResponse.json({ success: false, error: "Could not reach roster service" }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const secret = getSecret();
  if (!secret) return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  let tenantId = (searchParams.get("tenant_id") || searchParams.get("tenantId") || "").toLowerCase().trim();
  const type = (searchParams.get("type") || "").trim();
  const id = (searchParams.get("id") || "").trim();

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // body may be empty if query-only PATCH (still allow)
    body = {};
  }

  if (!tenantId) tenantId = resolveTenantId(req, body);
  // Prefer body tenant if still missing
  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenant_id, type or id" }, { status: 400 });
  const rType = type || String((body.type as string) || "").trim();
  const rId = id || String((body.id as string) || "").trim();
  if (!rType || !rId) return NextResponse.json({ success: false, error: "Missing tenant_id, type or id" }, { status: 400 });

  // Forward only updatable fields (strip tenant_id/type/id)
  const { tenant_id, tenantId: _tid, type: _t, id: _id, ...payload } = body as Record<string, unknown>;
  const url = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/roster/${encodeURIComponent(rType)}/${encodeURIComponent(rId)}`;
  try {
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? "Update failed";
      const msg = Array.isArray(detail) ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ") : String(detail);
      return NextResponse.json({ success: false, error: msg, raw: data }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[allocations proxy PATCH] failed", e);
    return NextResponse.json({ success: false, error: "Could not reach roster service" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const secret = getSecret();
  if (!secret) return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const tenantId = (searchParams.get("tenant_id") || searchParams.get("tenantId") || "").toLowerCase().trim() || resolveTenantId(req);
  const type = (searchParams.get("type") || "").trim();
  const id = (searchParams.get("id") || "").trim();

  if (!tenantId || !type || !id) return NextResponse.json({ success: false, error: "Missing tenant_id, type or id" }, { status: 400 });

  const url = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/roster/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
  try {
    const r = await fetch(url, { method: "DELETE", headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ success: false, error: (data as { detail?: string })?.detail || "Delete failed", raw: data }, { status: r.status });
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[allocations proxy DELETE] failed", e);
    return NextResponse.json({ success: false, error: "Could not reach roster service" }, { status: 502 });
  }
}
