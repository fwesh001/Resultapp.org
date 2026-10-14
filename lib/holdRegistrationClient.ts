/**
 * Client-side wrapper for the pending-registration hold.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * lib/pendingRegistrations.ts is marked `server-only` because it holds the
 * backend secret and decrypts stored credentials. A client component cannot
 * import it. This module is the browser-facing half: it POSTs the wizard's
 * details to /api/register-school/hold and returns the tx_ref to charge
 * against.
 *
 * The password crosses the network to our own API — it must, since the school
 * is being created — and is encrypted server-side before storage. It is never
 * placed in the checkout `meta`, which Flutterwave retains.
 */

export interface HoldRequest {
  school_name: string;
  subdomain: string;
  admin_name?: string;
  admin_email: string;
  admin_password: string;
  student_count: number;
  accepted_terms?: boolean;
  /**
   * Optional superadmin waiver code.
   *
   * NEVER sent to Flutterwave. `meta` is transmitted to the provider and
   * retained in their transaction record, so a code placed there would be
   * disclosed to a third party the school never authorised — the same reason
   * the admin password is excluded. It rides in the sealed hold instead.
   */
  waiver_token?: string;
}

export interface HoldResult {
  tx_ref: string;
  /**
   * The server's own split for this code. Null when no code was applied.
   *
   * DISPLAY ONLY. The backend recomputes the split from the token's own row
   * when the purchase is redeemed, so nothing the browser does with these
   * numbers changes what anyone is charged. It is returned so the wizard can
   * render the discounted total without a second round trip.
   *
   * `bypass_gateway` is the field that matters: when true there is nothing to
   * pay, so the wizard must not open Flutterwave at all.
   */
  waiver: (Partial<WaiverSplitShape> & { token_id?: number }) | null;
}

export interface WaiverSplitShape {
  requested_slots: number;
  slot_allowance: number;
  discount_percentage: number;
  waived_slots: number;
  charged_slots: number;
  forfeited_slots: number;
  unit_price_ngn: number;
  list_ngn: number;
  waived_ngn: number;
  charged_ngn: number;
  bypass_gateway: boolean;
}

export async function holdRegistration(p: HoldRequest): Promise<HoldResult> {
  const res = await fetch("/api/register-school/hold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });

  let data: { tx_ref?: string; waiver?: HoldResult["waiver"]; error?: string } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error("Checkout is unavailable right now. Please try again.");
  }

  if (!res.ok || !data.tx_ref) {
    throw new Error(data.error || "Could not start checkout. Please try again.");
  }
  return { tx_ref: data.tx_ref, waiver: data.waiver ?? null };
}
