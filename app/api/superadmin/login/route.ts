import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * POST /api/superadmin/login
 *
 * Dual path (multi-user superadmin, opaque cookies — no JWT):
 * 1. Per-user: Body { email, password } → FastAPI POST /api/v1/platform/login.
 *    Cookie: { superadmin: true, admin_id, email, role }.
 * 2. Legacy fallback: Body { password } → SUPERADMIN_PASSWORD env check.
 *    Cookie: { superadmin: true } (no identity — accepted by guards).
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

async function setSessionCookie(value: Record<string, unknown>) {
  try {
    const cookieStore = await cookies();
    cookieStore.set("superadmin_session", JSON.stringify(value), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  } catch (e) {
    console.warn("[superadmin login] cookie set failed", e);
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  // --- Path 1: per-user platform login (preferred when email is supplied) ---
  if (email) {
    if (!password) {
      return NextResponse.json({ success: false, error: "Password is required" }, { status: 400 });
    }
    const secret = getSecret();
    if (!secret) {
      return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
    }
    let backendRes: Response;
    try {
      backendRes = await fetch(`${getBackendBase()}/api/v1/platform/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
      });
    } catch (e) {
      console.error("[superadmin login] platform proxy fetch failed", e);
      return NextResponse.json({ success: false, error: "Could not reach auth service" }, { status: 502 });
    }
    const data = await backendRes.json().catch(() => ({}));
    if (!backendRes.ok) {
      const detail = (data as { detail?: unknown })?.detail ?? "Login failed";
      return NextResponse.json(
        { success: false, error: typeof detail === "string" ? detail : JSON.stringify(detail) },
        { status: backendRes.status },
      );
    }
    const admin = (data as { admin?: { id?: string; email?: string; role?: string } }).admin ?? {};
    await setSessionCookie({
      superadmin: true,
      admin_id: admin.id ?? null,
      email: admin.email ?? email,
      role: admin.role ?? "admin",
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ success: true }, { status: 200 });
  }

  // --- Path 2: legacy env-password fallback (no identity) ---
  const expected = (process.env.SUPERADMIN_PASSWORD || "").trim();

  if (!expected) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: SUPERADMIN_PASSWORD is not set" },
      { status: 500 },
    );
  }
  if (!password) {
    return NextResponse.json({ success: false, error: "Password is required" }, { status: 400 });
  }

  // Constant-time comparison to avoid timing leaks.
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  const match = a.length === b.length && timingSafeEqual(a, b);
  if (!match) {
    return NextResponse.json({ success: false, error: "Invalid password" }, { status: 401 });
  }

  await setSessionCookie({ superadmin: true, created_at: new Date().toISOString() });
  return NextResponse.json({ success: true }, { status: 200 });
}
