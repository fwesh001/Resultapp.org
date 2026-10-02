import { NextResponse } from "next/server";


/**
 * Platform Vitals proxy — GET /api/admin/vitals
 *
 * Server telemetry for the superadmin Command Center: OS, kernel, disk,
 * memory, PostgreSQL connections, and uptime.
 *
 * SECURITY (this is the important part):
 *   - `requireSuperadmin()` runs BEFORE anything else. It verifies the signed
 *     `superadmin_session` cookie via HMAC — an unsigned or forged cookie is
 *     rejected outright. No session means no telemetry, full stop.
 *   - The shared secret is injected here, server-side, and never reaches the
 *     browser. The client only ever sees the sanitised metrics payload.
 *   - Deliberately NOT reusing app/api/health/route.ts: that route is a
 *     frontend-only stub that can report healthy while FastAPI is down, and it
 *     carries no authentication. Server metrics must never be public.
 *
 * No query parameters and no cache: telemetry is per-request live data.
 */

export const dynamic = "force-dynamic";

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
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const base = getBackendBase();
  try {
    const res = await fetch(`${base}/api/v1/admin/vitals`, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      // The shared secret was rejected — surface it as a server fault rather
      // than an auth failure, since the *user* is already authenticated.
      return NextResponse.json({ error: "Telemetry service rejected the request" }, { status: 502 });
    }
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({})) as { detail?: string })?.detail;
      return NextResponse.json({ error: detail || `Failed (${res.status})` }, { status: res.status });
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return NextResponse.json({ error: "Malformed telemetry response" }, { status: 502 });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin/vitals] fetch failed", e);
    return NextResponse.json({ error: "Could not reach telemetry service" }, { status: 502 });
  }
}
