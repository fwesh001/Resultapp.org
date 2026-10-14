import { NextResponse } from "next/server";
import { requireSuperadmin, readSuperadminIdentity } from "@/lib/superadminAuth";
import { getBackendBase, upstreamError, requireSecret } from "../../../_lib";

/**
 * Cancel an unspent waiver token.
 *
 * POST /api/superadmin/waivers/{id}/void
 *
 * Only `open` tokens are voidable. A reserved token is mid-checkout and returns
 * to the pool on its own; a consumed token is history, and "un-consuming" one
 * would be editing the audit trail rather than correcting it. The backend
 * enforces that with a 409 — this route surfaces the reason rather than
 * quietly doing nothing.
 */

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin();
  if (guard) return guard;

  const { secret, error } = requireSecret();
  if (error) return error;

  const { id } = await ctx.params;
  const tokenId = Number(id);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ success: false, error: "Invalid token id" }, { status: 400 });
  }

  const identity = await readSuperadminIdentity();
  const createdBy = identity?.email ?? identity?.adminId ?? "superadmin(legacy)";

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/waivers/${tokenId}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ created_by: createdBy }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, `Could not void token ${tokenId}`) },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin/waivers/:id/void] POST failed", e);
    return NextResponse.json({ success: false, error: "Could not reach waiver service" }, { status: 502 });
  }
}
