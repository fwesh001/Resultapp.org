import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";

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

export async function GET() {
  const secret = getProxySecret();
  if (!secret) return NextResponse.json({ error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  const base = getBackendBase();
  try {
    const res = await fetch(`${base}/api/v1/admin/config/credit-price`, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: (data as { detail?: string })?.detail || `Failed (${res.status})` }, { status: res.status });
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin/config/credit-price] GET failed", e);
    return NextResponse.json({ error: "Could not reach config service" }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  // Mutating the global price is superadmin-only (GET stays open for tenant billing).
  const guard = await requireSuperadmin();
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) return NextResponse.json({ error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const price = (body as { credit_price?: unknown }).credit_price;
  const base = getBackendBase();
  try {
    const res = await fetch(`${base}/api/v1/admin/config/credit-price`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ credit_price: price }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: (data as { detail?: string })?.detail || `Failed (${res.status})` }, { status: res.status });
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin/config/credit-price] PUT failed", e);
    return NextResponse.json({ error: "Could not reach config service" }, { status: 502 });
  }
}
