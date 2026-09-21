import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/login
 * Body: { tenantId, identifier, password }
 *
 * Placeholder proxy — backend admin auth is not available yet
 * (only `POST /api/v1/tenant/{tenantId}/staff/login` exists in
 * `backend/routers/staff_auth.py`). Returns 501 so the shared
 * SignInForm shows a clear message instead of failing silently.
 *
 * Follow-up: add FastAPI admin-login endpoint + `admin_session`
 * cookie + guard in `app/[subdomain]/admin/layout.tsx`, mirroring
 * `app/api/staff/login/route.ts`.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = String(body.tenantId ?? "").toLowerCase().trim();
  const identifier = String(body.identifier ?? "").trim();
  const password = String(body.password ?? "");

  if (!tenantId || !identifier || !password) {
    return NextResponse.json(
      { success: false, error: "Missing tenantId, identifier or password" },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: "Admin sign-in is not enabled yet — backend admin auth is pending. Staff sign-in still works.",
    },
    { status: 501 },
  );
}
