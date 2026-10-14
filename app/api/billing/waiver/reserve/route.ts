import { NextRequest, NextResponse } from "next/server";
import { callerIp, throttle } from "@/lib/waiverThrottle";
import { getBackendBase, upstreamError, requireSecret } from "../../../superadmin/_lib";

/**
 * POST /api/billing/waiver/reserve
 *
 * Claims a token for exactly one checkout: `open -> reserved`, atomically.
 *
 * WHY THIS RUNS BEFORE CHECKOUT OPENS, NOT AFTER PAYMENT
 * ------------------------------------------------------
 * A single burn at payment time has a hole. Two tabs, one code:
 *
 *     tab A  validate -> ok        tab B  validate -> ok
 *     tab A  pays NGN 20,000        tab B  pays NGN 20,000
 *     tab A  burn -> wins           tab B  burn -> 409, has no entitlement
 *
 * Tab B is already charged. That is a refund queue and an apology email.
 * Reserving first means the loser never reaches a payment page at all.
 *
 * The `tx_ref` supplied here becomes the ONLY thing that can later redeem the
 * reservation, so a cancelled tab cannot release somebody else's hold and a
 * late callback cannot redeem one the sweeper has since handed to another tab.
 *
 * If checkout is abandoned the caller must POST /release (or simply wait out
 * `RESERVATION_TTL_SECONDS`, after which the backend's sweeper returns it).
 */

export const dynamic = "force-dynamic";

/** Tighter than preview: reserving is rarer and more consequential. */
const MAX_RESERVE_PER_MINUTE = 6;

export async function POST(req: NextRequest) {
  const retryAfter = throttle("reserve", callerIp(req), MAX_RESERVE_PER_MINUTE);
  if (retryAfter > 0) {
    return NextResponse.json(
      { success: false, error: `Too many attempts. Try again in ${retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tokenString = String(body.token_string ?? "").trim();
  const txRef = String(body.tx_ref ?? "").trim();

  if (!tokenString) {
    return NextResponse.json({ success: false, error: "Missing waiver code" }, { status: 400 });
  }
  if (!txRef || txRef.length > 128) {
    return NextResponse.json({ success: false, error: "Missing checkout reference" }, { status: 400 });
  }

  const { secret, error } = requireSecret();
  if (error) return error;

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/waiver/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({
        token_string: tokenString,
        tx_ref: txRef,
        applies_to: String(body.applies_to ?? "BOTH").trim().toUpperCase(),
        tenant_id: body.tenant_id ? String(body.tenant_id).trim().toLowerCase() : null,
      }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 409 means the code exists but is not available — already reserved,
      // already used, wrong scope, wrong school. Distinct from preview's 404
      // ("no such code"), which is why this is not a blanket message.
      return NextResponse.json(
        { success: false, error: upstreamError(data, "That waiver code is not available") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[billing/waiver/reserve] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reserve that code. Try again." }, { status: 502 });
  }
}
