import { NextRequest, NextResponse } from "next/server";
import { resolveSuperadminAccess } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/**
 * POST /api/superadmin/password — change the signed-in member's OWN password
 * (Settings → Security tab).
 *
 * The current password is verified server-side by the backend; this proxy
 * only checks that both fields exist before spending a bcrypt round trip.
 * Any validly signed superadmin session (any role, any page allocation) may
 * rotate their own password — owning your credential is not a page permission.
 *
 * The acting member's email reaches the backend as X-Admin-Email from the
 * VERIFIED session — the backend then separately verifies `current_password`
 * itself, so a spoofed header changes nothing of substance.
 */
export async function POST(req: NextRequest) {
  const access = await resolveSuperadminAccess();
  if (access === null) {
    return NextResponse.json(
      { success: false, error: "Unauthorized — superadmin sign-in required" },
      { status: 401 },
    );
  }
  if (!access.adminId) {
    // Identity-less legacy session (dev break-glass only): there is no account
    // row to rotate, so there is nothing to change.
    return NextResponse.json(
      { success: false, error: "Legacy env-password sessions have no account to update — sign in per-user." },
      { status: 400 },
    );
  }
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as { current_password?: unknown; new_password?: unknown };
  const current = typeof body.current_password === "string" ? body.current_password : "";
  const next = typeof body.new_password === "string" ? body.new_password : "";
  if (!current || !next) {
    return NextResponse.json(
      { success: false, error: "Both the current and the new password are required" },
      { status: 400 },
    );
  }
  if (current === next) {
    return NextResponse.json(
      { success: false, error: "The new password must differ from the current one" },
      { status: 400 },
    );
  }
  if (next.length < 12) {
    return NextResponse.json(
      { success: false, error: "Password must be at least 12 characters" },
      { status: 400 },
    );
  }

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/platform/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret as string,
        "X-Admin-Id": access.adminId,
        "X-Admin-Email": access.email ?? "",
      },
      body: JSON.stringify({ current_password: current, new_password: next }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Password change failed") }, { status: r.status });
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e) {
    console.error("[superadmin password] change failed", e);
    return NextResponse.json({ success: false, error: "Could not reach auth service" }, { status: 502 });
  }
}
