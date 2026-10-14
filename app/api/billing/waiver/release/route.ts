import { NextRequest, NextResponse } from "next/server";
import { getBackendBase, upstreamError, requireSecret } from "../../../superadmin/_lib";

/**
 * POST /api/billing/waiver/release
 *
 * Returns an abandoned reservation to the pool: `reserved -> open`.
 *
 * Called when the customer closes the Flutterwave modal, or when checkout
 * fails before payment. Without it the code would be unusable until
 * `RESERVATION_TTL_SECONDS` expired — long enough that a school who simply
 * closed the tab would come back to "this code is already in use".
 *
 * Idempotent by design: releasing twice, or releasing something already
 * returned to the pool, is a success. This runs on failure paths, and a
 * teardown path that can itself fail is a leak.
 *
 * NOT throttled. It cannot grant anything — the backend scopes the release to
 * the reservation's own `tx_ref` and refuses anything else — so the worst a
 * caller can do is burn their own request budget.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tokenId = Number(body.token_id);
  const txRef = String(body.tx_ref ?? "").trim();

  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ success: false, error: "Missing token id" }, { status: 400 });
  }
  if (!txRef) {
    return NextResponse.json({ success: false, error: "Missing checkout reference" }, { status: 400 });
  }

  const { secret, error } = requireSecret();
  if (error) return error;

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/waiver/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ token_id: tokenId, tx_ref: txRef }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "Could not release that reservation") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    // Deliberately non-fatal to the caller. A failed release is self-healing:
    // the backend sweeper returns the reservation once it lapses.
    console.error("[billing/waiver/release] fetch failed", e);
    return NextResponse.json({ success: true, released: false }, { status: 200 });
  }
}
