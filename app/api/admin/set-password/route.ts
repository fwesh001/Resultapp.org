import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/set-password
 * Body: { tenantId, email, newPassword }
 * Forwards to FastAPI POST /api/v1/tenant/{tenantId}/admin/set-password.
 *
 * One-time bootstrap for legacy schools whose admin_password_hash is NULL.
 * The backend refuses when a hash already exists (403).
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

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = String(body.tenantId ?? body.tenant_id ?? "").toLowerCase().trim();
  const email = String(body.email ?? body.identifier ?? "").trim();
  const newPassword = String(body.newPassword ?? body.new_password ?? "");

  if (!tenantId || !email || !newPassword) {
    return NextResponse.json(
      { success: false, error: "Missing tenantId, email or new password" },
      { status: 400 },
    );
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json(
      { success: false, error: "Password must be 8-128 characters" },
      { status: 400 },
    );
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const backendUrl = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/admin/set-password`;
  let backendRes: Response;
  try {
    backendRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify({ email, new_password: newPassword }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[admin set-password proxy] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach auth service" }, { status: 502 });
  }

  const data = await backendRes.json().catch(() => ({}));
  if (!backendRes.ok) {
    const detail = (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? "Could not set password";
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
    return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
  }

  return NextResponse.json({ success: true, ...data }, { status: 200 });
}
