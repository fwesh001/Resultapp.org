import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";

/**
 * Global free-credit toggle proxy (superadmin-only).
 *
 * Controls whether NEW registrations whose initial capacity is >= the backend
 * volume threshold (500, inclusive) also receive the free credit grant.
 *
 * Authority note: the backend decides the grant at provisioning time using
 * `resolve_initial_credit_grant()`. This toggle only gates that decision — it
 * can never itself grant credits, and the client-facing registration payload's
 * `initial_credits` field is ignored entirely.
 *
 * Follows the credit-price route pattern: server-side shared-secret injection,
 * superadmin guard on the mutating method.
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

export async function GET() {
  // Guarded on read too: this exposes platform policy, not tenant data.
  const guard = await requireSuperadmin();
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }
  const base = getBackendBase();
  try {
    const res = await fetch(`${base}/api/v1/admin/config/free-credits`, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as { detail?: string })?.detail || `Failed (${res.status})` },
        { status: res.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin/config/free-credits] GET failed", e);
    return NextResponse.json({ error: "Could not reach config service" }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const enabled = (body as { enabled?: unknown }).enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const base = getBackendBase();
  try {
    const res = await fetch(`${base}/api/v1/admin/config/free-credits`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ enabled }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as { detail?: string })?.detail || `Failed (${res.status})` },
        { status: res.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin/config/free-credits] PUT failed", e);
    return NextResponse.json({ error: "Could not reach config service" }, { status: 502 });
  }
}
