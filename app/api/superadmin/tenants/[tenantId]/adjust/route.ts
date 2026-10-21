import { NextRequest, NextResponse } from "next/server";
import { requireSuperadminPage, readSuperadminIdentity } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/**
 * POST /api/superadmin/tenants/[tenantId]/adjust — allocate OR deduct
 * credits/slots with a REQUIRED reason, announced to the school's admin
 * through the notification engine (TOKEN_ADJUSTED).
 *
 * Reachable from BOTH the tenant detail panel ("tenants") and the dedicated
 * Adjustments page ("adjustments"), so the guard accepts either page.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const guard = await requireSuperadminPage("tenants", "adjustments");
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  // Actor identity flows to the backend for audit attribution (audit_logs
  // never sees the browser cookie — only the proxy does).
  const identity = await readSuperadminIdentity();
  const { tenantId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/admin/tenants/${encodeURIComponent(tenantId.toLowerCase().trim())}/adjust`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret as string },
        body: JSON.stringify({
          ...body,
          actor_email: identity?.email ?? null,
          actor_id: identity?.adminId ?? null,
        }),
        cache: "no-store",
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Adjustment failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin tenant adjust] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
