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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = (searchParams.get("tenant_id") || "").toLowerCase().trim();
  const tokenType = (searchParams.get("token_type") || "").toUpperCase().trim();
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit")) || 50, 200));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });
  const guard = await requireAdminSession(tenantId);
  if (guard) return guard;
  if (tokenType && !["SLOT", "CREDIT"].includes(tokenType)) {
    return NextResponse.json({ success: false, error: "token_type must be SLOT or CREDIT" }, { status: 400 });
  }

  const secret = getProxySecret();
  if (!secret) return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });

  const base = getBackendBase();
  // Try unified billing_ledger first, fallback to credit_ledger for legacy
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (tokenType) qs.set("token_type", tokenType);
  const urls = [
    `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/billing/ledger?${qs.toString()}`,
    `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/billing-ledger?${qs.toString()}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return NextResponse.json({ success: true, entries: (data as { entries?: unknown[] }).entries ?? data, ...data }, { status: 200 });
      }
      if (res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        return NextResponse.json({ success: false, error: (data as { detail?: string })?.detail || `Upstream failed (${res.status})` }, { status: res.status });
      }
    } catch {}
  }
  // Fallback to legacy credit ledger for CREDIT token or all
  try {
    const res = await fetch(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/ledger?limit=${limit}&offset=${offset}`, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return NextResponse.json({ success: true, entries: (data as { entries?: unknown[] }).entries ?? [], ...data }, { status: 200 });
  } catch {}
  return NextResponse.json({ success: false, error: "Billing ledger unavailable" }, { status: 502 });
}
