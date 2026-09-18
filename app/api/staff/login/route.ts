import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * POST /api/staff/login
 * Body: { tenantId, identifier, password }
 * Forwards to FastAPI POST /api/v1/tenant/{tenantId}/staff/login
 * On success sets httpOnly secure cookie staff_session
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

  const tenantId = String((body.tenantId as string) || (body as Record<string, unknown>).tenant_id || "").toLowerCase().trim();
  const identifier = String((body.identifier as string) || "").trim();
  const password = String((body.password as string) || "");

  if (!tenantId || !identifier || !password) {
    return NextResponse.json({ success: false, error: "Missing tenantId, identifier or password" }, { status: 400 });
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const backendUrl = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/login`;
  let backendRes: Response;
  try {
    backendRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify({ identifier, password }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[staff login proxy] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach auth service" }, { status: 502 });
  }

  const data = await backendRes.json().catch(() => ({}));
  if (!backendRes.ok) {
    const detail = (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? "Login failed";
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
    return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
  }

  // On success, set httpOnly secure cookie
  try {
    const cookieStore = await cookies();
    cookieStore.set("staff_session", JSON.stringify(data), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12, // 12h
    });
  } catch (e) {
    console.warn("[staff login proxy] cookie set failed", e);
  }

  return NextResponse.json({ success: true, ...data }, { status: 200 });
}
