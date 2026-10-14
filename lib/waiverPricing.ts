/**
 * Waiver token split math — DISPLAY MIRROR ONLY.
 *
 * ══ READ THIS BEFORE CHANGING ANYTHING HERE ══
 *
 * The authoritative implementation is `compute_waiver_split()` in
 * `backend/services/waivers.py`. The backend owns billing math for waiver
 * tokens on purpose: unlike every other amount in this system — which the
 * FastAPI tier records verbatim from the amount_ngn this tier computes — a
 * discount is an incentive to lie. A proxy that claimed a 100% waiver on a
 * 10,000-slot order would be believed if this file were the source of truth.
 *
 * So this file exists to render a receipt and a preview, and
 * `scripts/verify-waiver-math.mjs` diffs it against the Python. If the two
 * ever disagree, the script fails. Do not "fix" a divergence by editing one
 * side — work out which one is wrong first; it is usually not this one.
 *
 * The price tier is NOT reimplemented here: `getPricingTier` is imported from
 * `./pricing`, so there is exactly one TypeScript copy of the volume tiers and
 * the parity test transitively pins that file too.
 */

import { getPricingTier } from "./pricing";

/** Mirrors MIN_REGISTRATION_SLOTS / MAX_SLOTS in backend/services/waivers.py. */
export const MIN_TOPUP_SLOTS = 1;
export const MAX_SLOTS = 10000;

export type WaiverAppliesTo = "REGISTRATION" | "TOPUP" | "BOTH";

export interface WaiverSplit {
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
  /**
   * True when the whole order is covered. Flutterwave rejects a zero-value
   * transaction, so the caller must skip the gateway entirely rather than
   * handing it ₦0 — see the checkout branch in RegisterSchoolForm and
   * BillingCheckout.
   */
  bypass_gateway: boolean;
}

export class WaiverValidationError extends Error {}

/**
 * Split a slot purchase into its waived and charged portions.
 *
 * Mirrors `compute_waiver_split()` exactly, including the floor on
 * `waived_ngn` — round instead of floor and an odd percentage on a small
 * order pushes `charged_ngn` below zero, which is a far worse outcome than
 * losing a naira.
 */
export function computeWaiverSplit(
  requestedSlots: number,
  slotAllowance: number,
  discountPercentage: number,
): WaiverSplit {
  const requested = Math.trunc(requestedSlots);
  const allowance = Math.trunc(slotAllowance);
  const pct = Math.trunc(discountPercentage);

  if (!Number.isInteger(requested)) throw new WaiverValidationError("requested_slots must be an integer");
  if (!Number.isInteger(allowance)) throw new WaiverValidationError("slot_allowance must be an integer");
  if (!Number.isInteger(pct)) throw new WaiverValidationError("discount_percentage must be an integer");

  if (requested < MIN_TOPUP_SLOTS || requested > MAX_SLOTS) {
    throw new WaiverValidationError(`requested_slots must be ${MIN_TOPUP_SLOTS}-${MAX_SLOTS}, got ${requested}`);
  }
  if (allowance < 1 || allowance > MAX_SLOTS) {
    throw new WaiverValidationError(`slot_allowance must be 1-${MAX_SLOTS}, got ${allowance}`);
  }
  if (pct < 1 || pct > 100) {
    throw new WaiverValidationError(`discount_percentage must be 1-100, got ${pct}`);
  }

  const unitPrice = getPricingTier(requested).pricePerStudent;
  const listNgn = requested * unitPrice;

  const waivedSlots = Math.min(allowance, requested);
  const chargedSlots = requested - waivedSlots;
  const forfeitedSlots = allowance - waivedSlots;

  const waivedNgn = Math.floor((waivedSlots * unitPrice * pct) / 100);
  const chargedNgn = listNgn - waivedNgn;

  if (chargedNgn < 0) {
    throw new WaiverValidationError(`negative charge computed: list ${listNgn} - waived ${waivedNgn}`);
  }

  return {
    requested_slots: requested,
    slot_allowance: allowance,
    discount_percentage: pct,
    waived_slots: waivedSlots,
    charged_slots: chargedSlots,
    forfeited_slots: forfeitedSlots,
    unit_price_ngn: unitPrice,
    list_ngn: listNgn,
    waived_ngn: waivedNgn,
    charged_ngn: chargedNgn,
    bypass_gateway: chargedNgn === 0,
  };
}

/**
 * Legal (min, max) slot_allowance for a token's scope.
 *
 * THE FLOOR COLLISION. A 5-slot token is valid for a top-up and unusable for
 * a registration, because registration carries a 10-slot floor the buyer
 * cannot opt out of. The superadmin generator narrows this field so it never
 * mints a code that fails validation at checkout — after the customer has
 * entered their card details.
 */
export function allowanceBounds(appliesTo: WaiverAppliesTo): { min: number; max: number } {
  const scope = String(appliesTo || "").toUpperCase();
  if (scope !== "REGISTRATION" && scope !== "TOPUP" && scope !== "BOTH") {
    throw new WaiverValidationError(`applies_to must be REGISTRATION, TOPUP or BOTH`);
  }
  // Mirrors MIN_REGISTRATION_STUDENTS in lib/pricing.ts.
  const floor = scope === "TOPUP" ? MIN_TOPUP_SLOTS : 10;
  return { min: floor, max: MAX_SLOTS };
}