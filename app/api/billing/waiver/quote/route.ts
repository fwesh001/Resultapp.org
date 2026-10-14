import { NextRequest, NextResponse } from "next/server";
import { getBackendBase, upstreamError, requireSecret } from "../../../superadmin/_lib";

/**
 * POST /api/billing/waiver/quote
 *
 * The split for a token THIS checkout already holds. Read-only, no mutation.
 *
 * This is what lets the top-up path verify a Flutterwave charge against the
 * DISCOUNTED total instead of the list price. `preview` cannot serve that
 * purpose — it refuses a reserved token, correctly, because an unverified
 * caller must not read a held code's terms. The reservation_tx_ref is the
 * proof of ownership: token ids are sequential and guessable, refs are minted
 * by the caller's own checkout.
 *
 * Verified against the backend's terms rather than the browser's, so a tampered
 * client cannot talk its way into a smaller expected charge.
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
  const txRef = String(body.reservation_tx_ref ?? "").trim();
  const requestedSlots = Number(body.requested_slots);

  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ success: false, error: "Missing token id" }, { status: 400 });
  }
  if (!txRef) {
    return NextResponse.json({ success: false, error: "Missing checkout reference" }, { status: 400 });
  }
  if (!Number.isInteger(requestedSlots) || requestedSlots < 1 || requestedSlots > 10000) {
    return NextResponse.json({ success: false, error: "Enter a valid number of slots" }, { status: 400 });
  }

  const { secret, error } = requireSecret();
  if (error) return error;

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/waiver/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ token_id: tokenId, reservation_tx_ref: txRef, requested_slots: requestedSlots }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "That waiver code is not available") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[billing/waiver/quote] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not price that code." }, { status: 502 });
  }
}
