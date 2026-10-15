import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession, readStaffSession } from "@/lib/staffAuth";

/**
 * POST /api/staff/password
 * Body: { currentPassword, newPassword }
 *
 * The staff_id is NEVER read from the request body. It comes from the signed
 * staff_session cookie, so a staff member cannot change someone else's password
 * by editing the payload — the proxy ignores whatever identifier was sent.
 *
 * Mirrors app/api/student/password/route.ts deliberately: same tenant-from-query
 * shape, same four-layer validation, same 502 on an unreachable backend.
 */

/** Mirrors backend/routers/staff_auth.py MIN_STAFF_PASSWORD. */
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;

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
  // Tenant comes from the query string. It is only used to CHECK the session's
  // tenant binding — the staff_id sent upstream comes from the verified cookie
  // below, never from the caller.
  const { searchParams } = new URL(req.url);
  const tenant = (
    searchParams.get("tenant_id") ||
    searchParams.get("tenantId") ||
    searchParams.get("tenant") ||
    ""
  )
    .toLowerCase()
    .trim();

  if (!tenant) {
    return NextResponse.json({ success: false, error: "Missing tenant" }, { status: 400 });
  }

  const guard = await requireStaffSession(tenant);
  if (guard) return guard;

  const identity = await readStaffSession(tenant);
  if (!identity) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const currentPassword = String((body.currentPassword as string) || "");
  const newPassword = String((body.newPassword as string) || "");

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { success: false, error: "Enter your current and new password" },
      { status: 400 },
    );
  }
  if (newPassword.length < MIN_PASSWORD) {
    return NextResponse.json(
      {
        success: false,
        error: `New password must be at least ${MIN_PASSWORD} characters`,
      },
      { status: 400 },
    );
  }
  if (newPassword.length > MAX_PASSWORD) {
    return NextResponse.json(
      { success: false, error: "New password is too long" },
      { status: 400 },
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { success: false, error: "New password must differ from the current one" },
      { status: 400 },
    );
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const backendUrl = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(
    tenant,
  )}/staff/password`;

  try {
    const backendRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      // staff_id comes from the verified cookie, never from the body.
      body: JSON.stringify({
        staff_id: identity.staffId,
        current_password: currentPassword,
        new_password: newPassword,
      }),
      cache: "no-store",
    });

    const data = await backendRes.json().catch(() => ({}));

    if (!backendRes.ok) {
      const detail =
        (data as { detail?: unknown })?.detail ??
        (data as { error?: unknown })?.error ??
        "Could not change password";
      const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
      return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
    }

    // Deliberately NOT re-issuing the staff_session cookie. The cookie carries
    // must_change_password as of sign-in, so the banner in the dashboard layout
    // reads a stale true until the member signs in again — but re-minting it
    // here would mean the ONLY thing that clears the prompt is the proxy
    // agreeing with itself, which is exactly the hole that lets someone keep a
    // known-default password forever. The database flag is the sole authority.
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[staff password proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach auth service" },
      { status: 502 },
    );
  }
}
