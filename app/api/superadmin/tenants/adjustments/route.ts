import { NextRequest, NextResponse } from "next/server";
import { requireSuperadminPage } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/**
 * GET /api/superadmin/tenants/adjustments — history of credit/slot grants and
 * deductions, from the billing ledger (amounts) with the audit trail carrying
 * the acting member. Reachable from the Adjustments page (and Tenants, since
 * the ledger filter is a read).
 */
export async function GET(req: NextRequest) {
  const guard = await requireSuperadminPage("adjustments", "tenants");
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const incoming = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  for (const k of ["subdomain", "limit", "offset"]) {
    const v = incoming.get(k);
    if (v !== null && v !== "") qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/tenants/adjustments${suffix}`, {
      headers: { "X-API-SECRET-KEY": secret as string },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Adjustment history failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin adjustments list] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
