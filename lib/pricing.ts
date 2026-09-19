/**
 * Tiered pricing for resultapp.org
 * Single source of truth for PricingCalculator and SchoolRegistrationForm
 * and server-side verification.
 */

export interface PricingTier {
  min: number;
  max: number; // inclusive
  pricePerStudent: number;
  badge: string | null;
  badgeStyle: string;
}

export const PRICING_TIERS: PricingTier[] = [
  { min: 50, max: 499, pricePerStudent: 100, badge: null, badgeStyle: "" },
  { min: 500, max: 999, pricePerStudent: 90, badge: "10% Volume Discount Applied", badgeStyle: "bg-violet-500/15 text-violet-300 border-violet-500/20" },
  { min: 1000, max: 10000, pricePerStudent: 80, badge: "20% Volume Discount Applied", badgeStyle: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" },
];

// For 1-49: also 100 but no badge, treat as tier 0
export function getPricingTier(studentCount: number) {
  const n = Math.max(0, Math.floor(Number(studentCount) || 0));
  if (n >= 1000) return { pricePerStudent: 80, badge: "20% Volume Discount Applied" as const, badgeStyle: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" };
  if (n >= 500) return { pricePerStudent: 90, badge: "10% Volume Discount Applied" as const, badgeStyle: "bg-violet-500/15 text-violet-300 border-violet-500/20" };
  return { pricePerStudent: 100, badge: null as string | null, badgeStyle: "" };
}

export function calculateTieredTotal(studentCount: number): number {
  const { pricePerStudent } = getPricingTier(studentCount);
  const n = Math.max(0, Math.floor(Number(studentCount) || 0));
  return n * pricePerStudent;
}

export function getSliderPct(studentCount: number): number {
  const n = Math.max(50, Math.min(2000, Math.floor(Number(studentCount) || 50)));
  return ((n - 50) / (2000 - 50)) * 100;
}

/** Flat price per publishing credit (NGN) — superadmin tunable via backend app_settings. */
export const CREDIT_PRICE = 200;

export function calculateCreditTotal(creditCount: number, unitPrice: number = CREDIT_PRICE): number {
  const n = Math.max(0, Math.floor(Number(creditCount) || 0));
  const price = Math.max(1, Math.floor(Number(unitPrice) || CREDIT_PRICE));
  return n * price;
}

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount);
}
