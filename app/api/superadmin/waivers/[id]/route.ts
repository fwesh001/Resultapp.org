import { NextResponse } from "next/server";
import { requireSuperadminPage } from "@/lib/superadminAuth";
import { getBackendBase, upstreamError, requireSecret } from "../../_lib";

/**
 * Full audit row for one waiver token.
 *
 * GET /api/superadmin/waivers/{id}
 *
 * Distinct from the list route because the list deliberately omits the
 * reservation bookkeeping, and because a token's redemption detail is the thing
 * you pull up when someone asks why a school did not get what they paid for.
 */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadminPage("waivers");
  if (guard) return guard;

  const { secret, error } = requireSecret();
  if (error) return error;

  const { id } = await ctx.params;
  const tokenId = Number(id);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ success: false, error: "Invalid token id" }, { status: 400 });
  }

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/waivers/${tokenId}`, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, `Token ${tokenId} not found`) },
        { status: r.status === 404 ? 404 : r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin/waivers/:id] GET failed", e);
    return NextResponse.json({ success: false, error: "Could not reach waiver service" }, { status: 502 });
  }
}
