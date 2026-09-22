import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/** GET /api/superadmin/ledger?token_type&limit&offset&subdomain — global ledger. */
export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const incoming = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  for (const k of ["token_type", "limit", "offset", "subdomain"]) {
    const v = incoming.get(k);
    if (v !== null && v !== "") qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/ledger${suffix}`, {
      headers: { "X-API-SECRET-KEY": secret as string },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Ledger query failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin ledger] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
