import { NextResponse } from "next/server";

/**
 * Super Admin proxy — real-time tenants list.
 * GET /api/superadmin/tenants
 * Proxies to FastAPI GET /api/v1/admin/tenants with X-API-SECRET-KEY.
 * Secret never leaks to client (server-only).
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

export async function GET() {
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const url = `${getBackendBase()}/api/v1/admin/tenants`;
  try {
    const r = await fetch(url, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? r.statusText;
      const msg = Array.isArray(detail)
        ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
        : String(detail);
      return NextResponse.json({ success: false, error: msg, raw: data }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin tenants proxy] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
