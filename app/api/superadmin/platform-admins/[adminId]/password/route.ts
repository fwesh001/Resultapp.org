import { NextRequest, NextResponse } from "next/server";
import { requireSuperadminOwner, readSuperadminIdentity } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/**
 * POST /api/superadmin/platform-admins/[adminId]/password — set a member's password.
 *
 *_owner-only. The password is TYPED by the owner (the decision taken in the
 * plan workflow), so the plaintext travels only over this server-to-server
 * call and is stored as a pgcrypto bcrypt hash. It is never logged and never
 * returned.
 */
export async function POST(
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
      `${getBackendBase()}/api/v1/platform/admins/${encodeURIComponent(adminId)}/password`,
      {
        method: "POST",
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
      return NextResponse.json({ success: false, error: upstreamError(data, "Password set failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin platform-admins] password fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
