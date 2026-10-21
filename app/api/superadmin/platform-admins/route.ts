import { NextRequest, NextResponse } from "next/server";
import { requireSuperadminOwner, readSuperadminIdentity } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/**
 * GET  /api/superadmin/platform-admins — list platform team members
 * POST /api/superadmin/platform-admins — create a member (email + password + role + pages)
 *
 * OWNER-ONLY, and the role check happens HERE, in the proxy, because the
 * backend cannot see the signed cookie (see routers/platform_admins.py).
 * The acting member's UUID/email ride to the backend in X-Admin-Id /
 * X-Admin-Email purely for audit attribution.
 */

export async function GET() {
  const guard = await requireSuperadminOwner();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/platform/admins`, {
      headers: { "X-API-SECRET-KEY": secret as string },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Member list failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin platform-admins] list fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperadminOwner();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const identity = await readSuperadminIdentity();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await fetch(`${getBackendBase()}/api/v1/platform/admins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret as string,
        ...(identity?.adminId ? { "X-Admin-Id": identity.adminId } : {}),
        ...(identity?.email ? { "X-Admin-Email": identity.email } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Member creation failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin platform-admins] create fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
