import { NextRequest, NextResponse } from "next/server";
import { requireSuperadminOwner, readSuperadminIdentity } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/**
 * PATCH /api/superadmin/platform-admins/[adminId] — role / active / page allocation.
 *
 * Owner-only. The last-owner and self-demotion invariants are enforced in the
 * backend data layer (db_manager.update_platform_admin); a refusal surfaces
 * here as the backend's 400 with a plain-text detail.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ adminId: string }> },
) {
  const guard = await requireSuperadminOwner();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const identity = await readSuperadminIdentity();
  const { adminId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/platform/admins/${encodeURIComponent(adminId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-API-SECRET-KEY": secret as string,
          ...(identity?.adminId ? { "X-Admin-Id": identity.adminId } : {}),
          ...(identity?.email ? { "X-Admin-Email": identity.email } : {}),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Member update failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin platform-admins] patch fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
