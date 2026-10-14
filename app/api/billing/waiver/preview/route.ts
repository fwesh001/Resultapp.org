import { NextRequest, NextResponse } from "next/server";
import { callerIp, throttle } from "@/lib/waiverThrottle";
import { getBackendBase, upstreamError, requireSecret } from "../../../superadmin/_lib";

/**
 * POST /api/billing/waiver/preview
 *
 * Public and unauthenticated — a school typing a code at checkout has no
 * session and cannot have one. That makes this the untrusted surface of the
 * whole feature, so it is rate limited on both sides: cheaply here, and
 * authoritatively in `routers/waivers.py`.
 *
 * STRICTLY READ-THROUGH. The backend's `peek_token()` cannot mutate a row, so
 * rendering a preview never consumes the school's entitlement. That property
 * is the difference between a price display and a trap, where the customer
 * reads a total, goes to make tea, and comes back to a spent code.
 *
 * The returned split is FOR DISPLAY ONLY. The backend recomputes it from the
 * token's own row when the purchase is redeemed, so a client that tampers with
 * these numbers changes nothing but its own receipt.
 *
 * NOTE ON THE IMPORT PATH
 * -----------------------
 * The shared proxy helpers live under `app/api/superadmin/_lib.ts`. Nothing in
 * them is superadmin-specific — they are the de-duplicated answer to ~25
 * copy-pasted `getSecret()`/`getBackendBase()` pairs — so reaching them from a
 * billing route is correct even though the directory reads oddly. Importing
 * them is still the right call over a 26th copy. If this keeps growing, the
 * fix is to move the file to `lib/backendProxy.ts`, not to clone it again.
 */

export const dynamic = "force-dynamic";

/** A school retyping a code or pasting the wrong one twice is normal. */
const MAX_PREVIEW_PER_MINUTE = 12;

export async function POST(req: NextRequest) {
  const retryAfter = throttle("preview", callerIp(req), MAX_PREVIEW_PER_MINUTE);
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
  const requestedSlots = Number(body.requested_slots);

  if (!tokenString) {
    return NextResponse.json({ success: false, error: "Enter a waiver code" }, { status: 400 });
  }
  if (!Number.isInteger(requestedSlots) || requestedSlots < 1 || requestedSlots > 10000) {
    return NextResponse.json({ success: false, error: "Enter a valid number of slots" }, { status: 400 });
  }

  const { secret, error } = requireSecret();
  if (error) return error;

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/waiver/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({
        token_string: tokenString,
        requested_slots: requestedSlots,
        applies_to: String(body.applies_to ?? "BOTH").trim().toUpperCase(),
        tenant_id: body.tenant_id ? String(body.tenant_id).trim().toLowerCase() : null,
      }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "That waiver code could not be applied") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[billing/waiver/preview] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not check that code. Try again." },
      { status: 502 },
    );
  }
}
