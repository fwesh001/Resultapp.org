import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/** GET /api/superadmin/tenants/[tenantId] — single tenant detail. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const guard = await requireSuperadmin();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const { tenantId } = await params;
  const tid = tenantId.toLowerCase().trim();
  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/tenants/${encodeURIComponent(tid)}`, {
      headers: { "X-API-SECRET-KEY": secret as string },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Failed to fetch tenant") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin tenant detail] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
