import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret } from "@/app/api/superadmin/_lib";

/** GET /api/superadmin/ledger/export — streams backend CSV straight through. */
export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const incoming = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  for (const k of ["token_type", "subdomain"]) {
    const v = incoming.get(k);
    if (v !== null && v !== "") qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/ledger/export${suffix}`, {
      headers: { "X-API-SECRET-KEY": secret as string },
      cache: "no-store",
    });
    if (!r.ok || !r.body) {
      const data = await r.json().catch(() => ({}));
      const detail = (data as { detail?: string })?.detail ?? "Export failed";
      return NextResponse.json({ success: false, error: String(detail) }, { status: r.status || 502 });
    }
    return new NextResponse(r.body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=resultapp-ledger.csv",
      },
    });
  } catch (e) {
    console.error("[superadmin ledger export] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
