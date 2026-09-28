import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/**
 * GET /api/superadmin/tickets — cross-tenant support ticket inbox.
 *
 * Filters are allowlisted rather than forwarded blindly so a caller cannot
 * smuggle unexpected query keys into the backend URL.
 */

const FORWARDED = ["status", "type", "tenant_id", "search", "page", "limit"] as const;

export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const incoming = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  for (const key of FORWARDED) {
    const v = incoming.get(key);
    if (v !== null && v !== "") qs.set(key, v);
  }
  if (!qs.has("limit")) qs.set("limit", "50");

  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/admin/support-tickets?${qs.toString()}`,
      {
        headers: { "X-API-SECRET-KEY": secret as string },
        cache: "no-store",
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "Could not load tickets") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin tickets] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach admin service" },
      { status: 502 },
    );
  }
}
