import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * POST /api/superadmin/login — Body: { password }
 * Verifies SUPERADMIN_PASSWORD (server env only) and sets httpOnly
 * `superadmin_session` cookie (12h). Uses constant-time comparison.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const password = String(body.password ?? "");
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

  try {
    const cookieStore = await cookies();
    cookieStore.set(
      "superadmin_session",
      JSON.stringify({ superadmin: true, created_at: new Date().toISOString() }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12,
      },
    );
  } catch (e) {
    console.warn("[superadmin login] cookie set failed", e);
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
