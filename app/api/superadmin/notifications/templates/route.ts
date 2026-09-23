import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/** GET /api/superadmin/notifications/templates — list system templates. */
export async function GET() {
  const guard = await requireSuperadmin();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/notification-templates`, {
      headers: { "X-API-SECRET-KEY": secret as string },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Templates failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin notification templates] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
