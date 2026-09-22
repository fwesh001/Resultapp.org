import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/** POST /api/superadmin/tenants/[tenantId]/grant — free credits/slots. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const guard = await requireSuperadmin();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const { tenantId } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/admin/tenants/${encodeURIComponent(tenantId.toLowerCase().trim())}/grant`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret as string },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Grant failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin tenant grant] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
