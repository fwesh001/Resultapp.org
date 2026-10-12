/**
 * Flutterwave payment helper for resultapp.org
 * Supports BOTH server-side (secret-key) and client-side (inline checkout) flows.
 *
 * Pricing (tiered):
 * - 50 to 499 students: ₦100 per student
 * - 500 to 999 students: ₦90 per student (10% off)
 * - 1000+ students: ₦80 per student (20% off)
 *
 * Env (EXACTLY these three, plus one demo-only):
 * - NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY (client)  — LIVE public key
 * - FLUTTERWAVE_SECRET_KEY            (server)  — LIVE secret key
 * - FLUTTERWAVE_WEBHOOK_SECRET_HASH   (server)  — LIVE webhook hash
 * - NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY (client) — TEST key, demo tenant ONLY
 *
 * ONE NAME PER SETTING. This file previously read each value through a chain of
 * aliases (FLW_SECRET_KEY, FLW_SECRET_HASH, NEXT_PUBLIC_FLW_PUBLIC_KEY,
 * NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY_TEST, FLUTTERWAVE_WEBHOOK_HASH). That is
 * what let a live secret sit in .env under an unrecognised name for months while
 * the test key carried on being used in production, and it made it impossible
 * to tell which variable was authoritative. An alias chain is a way of losing
 * configuration without noticing.
 *
 * Nothing here substitutes a placeholder for a missing key. A missing key is a
 * deployment error and throws; it must never silently become a TEST key, because
 * a test-key checkout looks identical to a real one until the school discovers
 * no money moved.
 */

export const PRICE_PER_STUDENT = 100;
export const CURRENCY = "NGN";
export const FLUTTERWAVE_INLINE_SCRIPT_URL =
  "https://checkout.flutterwave.com/v3.js";

const FLW_BASE_URL = "https://api.flutterwave.com/v3";

// ---------------------------------------------------------------------------
// Pricing helpers
// ---------------------------------------------------------------------------

/**
 * Calculate total payable amount for a given student count (tiered).
 * - 50 to 499: 100 NGN
 * - 500 to 999: 90 NGN
 * - 1000+: 80 NGN
 * Example: 150 students * 100 NGN = 15,000 NGN; 600 * 90 = 54,000; 1200 * 80 = 96,000
 */
export function calculateTotalAmount(studentCount: number): number {
  const count = Math.max(0, Math.floor(Number(studentCount) || 0));
  let pricePerStudent = 100;
  if (count >= 1000) pricePerStudent = 80;
  else if (count >= 500) pricePerStudent = 90;
  return count * pricePerStudent;
}

import crypto from "node:crypto";
import { formatNaira as _formatNaira } from "@/lib/pricing";
/**
 * Format NGN amount with thousand separators.
 * 15000 -> "₦15,000"
 * @deprecated Import from @/lib/pricing instead (moved per Phase 4 decision 4). Kept for backwards compat.
 */
export const formatNaira = _formatNaira;

// ---------------------------------------------------------------------------
// Shared: tx_ref generator (usable on both client & server)
// ---------------------------------------------------------------------------

export function generateTxRef(schoolSlugOrId?: string): string {
  const prefix = "resultapp";
  const id = schoolSlugOrId
    ? `_${schoolSlugOrId.toLowerCase().replace(/[^a-z0-9-]/g, "")}`
    : "";
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}${id}_${ts}_${rand}`;
}

// ---------------------------------------------------------------------------
// Server-side helpers (secret key)
// ---------------------------------------------------------------------------

/**
 * The live server secret key. Throws if absent.
 *
 * Throwing rather than returning "" is deliberate: every caller treats a
 * falsy key as "cannot verify", which for a paying customer surfaces as a
 * generic 402 and a support ticket. A loud, named error at the boundary is
 * diagnosable in seconds from the logs.
 */
function getSecretKey(): string {
  const key = (process.env.FLUTTERWAVE_SECRET_KEY || "").trim();
  if (!key) {
    throw new Error(
      "Flutterwave is not configured: FLUTTERWAVE_SECRET_KEY is missing. " +
        "Set it on the deployment. Refusing to process payments without it, " +
        "rather than falling back to a test key.",
    );
  }
  return key;
}

/**
 * True when the configured secret is a Flutterwave TEST key.
 *
 * Used only to refuse production traffic, never to enable it: a test secret in
 * production means no real money can ever be taken, which is a far worse
 * failure than an outage because it looks like a working system.
 */
export function isTestModeSecretKey(key?: string): boolean {
  const k = (key ?? process.env.FLUTTERWAVE_SECRET_KEY ?? "").trim();
  return k.includes("_TEST") || k.includes("_TEST-");
}

export interface FlutterwavePaymentPayload {
  tx_ref: string;
  amount: number;
  currency?: string;
  redirect_url: string;
  customer: {
    email: string;
    name?: string;
    phonenumber?: string;
  };
  customizations?: {
    title?: string;
    description?: string;
    logo?: string;
  };
  meta?: Record<string, unknown>;
  payment_options?: string;
}

export interface FlutterwaveInitResponse {
  status: string;
  message: string;
  data: {
    link: string;
  };
}

export interface FlutterwaveVerifyResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    charged_amount: number;
    status: "successful" | "failed" | string;
    customer: {
      email: string;
      name: string;
    };
    meta?: Record<string, unknown>;
  };
}

export async function initializePayment(
  payload: FlutterwavePaymentPayload
): Promise<FlutterwaveInitResponse> {
  const secretKey = getSecretKey();
  const res = await fetch(`${FLW_BASE_URL}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ currency: CURRENCY, ...payload }),
    cache: "no-store",
  });
  const data = (await res.json()) as FlutterwaveInitResponse;
  if (!res.ok) throw new Error(`Flutterwave init failed: ${data.message || res.statusText}`);
  return data;
}

export async function verifyTransaction(
  transactionId: string | number
): Promise<FlutterwaveVerifyResponse> {
  const secretKey = getSecretKey();
  const res = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const data = (await res.json()) as FlutterwaveVerifyResponse;
  if (!res.ok) throw new Error(`Flutterwave verify failed: ${data.message || res.statusText}`);
  return data;
}

/**
 * Statuses that mean the money is confirmed and a portal may be provisioned.
 */
export const PAID_STATUSES = new Set(["successful", "success", "completed"]);

/**
 * Statuses that mean a charge exists but the provider has not confirmed it
 * yet. A bank transfer sits in `success-pending-validation` until the paying
 * bank's settlement clears, which can take minutes or hours.
 *
 * These are NOT failures. Treating them as failures is what produced the worst
 * possible customer experience: someone who just transferred ₦10,000 was told
 * "payment verification failed, contact support" for a transaction that was
 * sitting in a perfectly normal pending state.
 */
export const PENDING_STATUSES = new Set([
  "success-pending-validation",
  "pending",
  "processing",
  "ongoing",
]);

/**
 * Classify a Flutterwave transaction status into the only three answers the
 * registration flow cares about.
 *
 * CRITICAL: pass `data.status` (the TRANSACTION status), never the envelope's
 * top-level `status`. The envelope is `"success"` whenever the API merely
 * FOUND the transaction — including failed, abandoned and refunded ones — so
 * treating the envelope as proof of payment provisions portals for free.
 */
export function classifyPaymentStatus(status: unknown): "paid" | "pending" | "failed" {
  const s = String(status ?? "").trim().toLowerCase();
  if (PAID_STATUSES.has(s)) return "paid";
  if (PENDING_STATUSES.has(s)) return "pending";
  return "failed";
}

/**
 * Verify a charge by the reference WE generated before opening checkout.
 *
 * Preferred over `verifyTransaction(id)` because the inline modal's
 * `transaction_id` is not always resolvable by the public API (3-D Secure and
 * test-mode mock checkouts both hand back ids the verify endpoint rejects),
 * while the tx_ref is echoed by the provider and always resolves.
 */
export async function verifyTransactionByReference(
  txRef: string
): Promise<FlutterwaveVerifyResponse> {
  const secretKey = getSecretKey();
  const res = await fetch(
    `${FLW_BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }
  );
  const data = (await res.json()) as FlutterwaveVerifyResponse;
  if (!res.ok) {
    throw new Error(
      `Flutterwave verify-by-reference failed: ${data.message || res.statusText}`
    );
  }
  return data;
}

/**
 * Verify a Flutterwave `verif-hash` header against the configured secret hash.
 *
 * Flutterwave sends a PRECOMPUTED SHA-512 hash of the webhook secret, so the
 * correct check is a straight comparison against the dashboard's "Secret Hash"
 * — not a hash we recompute. The subtlety is that a plain `===` leaks the
 * secret hash's bytes through timing, so this uses `timingSafeEqual` (the same
 * posture the FastAPI tier already takes with `hmac.compare_digest`).
 *
 * Refuses rather than degrades. The previous version returned
 * `NODE_ENV !== "production"` when the hash was unset, which meant a missing
 * variable silently ACCEPTED every webhook in development — exactly the
 * environment where you would rehearse an attack and believe it was rejected.
 * A missing hash is now always a failure.
 */
export function verifyWebhookSignature(verifHashHeader: string | null): boolean {
  const secretHash = (process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH || "").trim();

  if (!secretHash) {
    console.error(
      "[flutterwave] FLUTTERWAVE_WEBHOOK_SECRET_HASH is not set — rejecting every webhook. " +
        "Payments will not be auto-provisioned until this is configured.",
    );
    return false;
  }
  if (!verifHashHeader) return false;

  // timingSafeEqual throws on a length mismatch, and the incoming header's
  // length is attacker-controlled, so compare lengths first.
  const a = Buffer.from(verifHashHeader, "utf8");
  const b = Buffer.from(secretHash, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Client-side helpers (inline checkout)
// ---------------------------------------------------------------------------

/**
 * The live public key. Throws if absent.
 *
 * The previous version walked a fallback chain and returned "" when nothing
 * matched, and both call sites then substituted a hardcoded
 * `FLWPUBK_TEST-dummy-...`. Net effect: a deployment with a missing or
 * misnamed live key opened a perfectly normal-looking TEST checkout. The
 * operator saw a working pay button, the school saw a payment form, and no
 * money moved. Throwing turns that silent failure into an obvious one.
 */
export function getFlutterwavePublicKey(): string {
  const key = (process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY || "").trim();
  if (!key) {
    throw new Error(
      "Flutterwave is not configured: NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY is missing. " +
        "Refusing to open checkout — a missing key must never fall back to a test key.",
    );
  }
  return key;
}

/**
 * The public key to actually open checkout with.
 *
 * The demo tenant is a teaching environment: it advertises a test card and a
 * mock bank transfer, neither of which a live key accepts. So the demo gets its
 * own dedicated TEST key and every real tenant is held to the live one.
 *
 * The demo key is a separate variable rather than a fallback, because a
 * fallback is exactly the failure mode being removed. A real tenant can never
 * reach the demo key: the choice is made by the registry's own demo flag
 * (`isDemoTenant`, data-driven from subscription_status — never the hostname),
 * not by anything the client can influence.
 */
export function getPublicKeyForTenant(opts?: { isDemo?: boolean }): string {
  if (opts?.isDemo) {
    const demoKey = (process.env.NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY || "").trim();
    if (!demoKey) {
      throw new Error(
        "The demo tenant needs NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY to be set. " +
          "It is deliberately NOT derived from the live key — a demo checkout on a " +
          "live key cannot accept the test card we advertise.",
      );
    }
    return demoKey;
  }
  return getFlutterwavePublicKey();
}

export interface FlutterwaveInlineCustomer {
  email: string;
  name: string;
  phone_number?: string;
}

export interface FlutterwaveInlineConfig {
  publicKey: string;
  txRef: string;
  amount: number;
  currency?: string;
  customer: FlutterwaveInlineCustomer;
  customizations?: {
    title?: string;
    description?: string;
    logo?: string;
  };
  meta?: Record<string, unknown>;
  paymentOptions?: string; // "card,ussd,banktransfer"
  redirectUrl?: string;
}

export interface FlutterwaveInlineResponse {
  status: string;
  transaction_id?: number;
  tx_ref: string;
  flw_ref?: string;
  amount?: number;
  currency?: string;
  customer?: { email: string; name: string };
}

// Extend Window for FlutterwaveCheckout injected by script
declare global {
  interface Window {
    FlutterwaveCheckout?: (config: Record<string, unknown>) => { close: () => void } | void;
  }
}

export interface FlutterwaveCheckoutHandle {
  close: () => void;
}

/**
 * Dynamically load the Flutterwave inline SDK. Safe to call multiple times.
 */
export function loadFlutterwaveScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Window not available"));
  if (window.FlutterwaveCheckout) return Promise.resolve();

  const existing = document.querySelector(`script[src="${FLUTTERWAVE_INLINE_SCRIPT_URL}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Flutterwave script")));
      // If already loaded and window available, resolve
      setTimeout(() => {
        if (window.FlutterwaveCheckout) resolve();
      }, 500);
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = FLUTTERWAVE_INLINE_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Flutterwave checkout script"));
    document.head.appendChild(script);
  });
}

export interface InitiateInlinePaymentCallbacks {
  onSuccess?: (response: FlutterwaveInlineResponse) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Wrapper around FlutterwaveCheckout inline modal.
 * Accepts payment details (email, amount, tx_ref, customer, publicKey) and opens modal.
 *
 * Usage:
 *   await loadFlutterwaveScript();
 *   initiateFlutterwaveInlinePayment({ publicKey, txRef, amount, customer: {email, name} }, { onSuccess, onClose })
 */
export function initiateFlutterwaveInlinePayment(
  config: FlutterwaveInlineConfig,
  callbacks: InitiateInlinePaymentCallbacks = {}
): FlutterwaveCheckoutHandle | null {
  if (typeof window === "undefined") {
    callbacks.onError?.(new Error("FlutterwaveCheckout is only available on the client"));
    return null;
  }

  if (!window.FlutterwaveCheckout) {
    callbacks.onError?.(
      new Error("FlutterwaveCheckout not loaded. Call loadFlutterwaveScript() first.")
    );
    return null;
  }

  if (!config.publicKey) {
    callbacks.onError?.(new Error("Flutterwave public key is missing"));
    return null;
  }

  const { onSuccess, onClose, onError } = callbacks;

  try {
    const checkout = window.FlutterwaveCheckout({
      public_key: config.publicKey,
      tx_ref: config.txRef,
      amount: config.amount,
      currency: config.currency || CURRENCY,
      payment_options: config.paymentOptions || "card,ussd,banktransfer",
      redirect_url: config.redirectUrl,
      customer: {
        email: config.customer.email,
        name: config.customer.name,
        phone_number: config.customer.phone_number,
      },
      customizations: {
        title: config.customizations?.title || "ResultApp - School Registration",
        description:
          config.customizations?.description ||
          `Payment for ${config.meta?.studentCount || ""} students`,
        logo: config.customizations?.logo || "https://resultapp.org/logo.png",
      },
      meta: config.meta,
      callback: function (response: unknown) {
        const res = response as FlutterwaveInlineResponse;
        // Flutterwave calls callback on every modal action; check status
        // Successful transactions have status "successful" or "completed"
        // However we treat any callback with transaction_id as potential success and let caller verify server-side
        try {
          onSuccess?.(res);
        } catch (e) {
          onError?.(e as Error);
        }
      },
      onclose: function () {
        onClose?.();
      },
    });
    if (checkout && typeof checkout.close === "function") return checkout;
    return null;
  } catch (err) {
    onError?.(err as Error);
    return null;
  }
}

/**
 * High-level helper: validate & launch payment for school registration.
 * Combines pricing calculation + tx_ref generation + inline launch.
 */
export async function payForSchoolRegistration(params: {
  publicKey: string;
  schoolName: string;
  subdomain: string;
  adminName: string;
  adminEmail: string;
  phoneNumber: string;
  studentCount: number;
  onSuccess: (res: FlutterwaveInlineResponse) => void;
  onClose: () => void;
  onError: (err: Error) => void;
}): Promise<void> {
  const amount = calculateTotalAmount(params.studentCount);
  if (amount <= 0) throw new Error("Invalid student count");

  const txRef = generateTxRef(params.subdomain);

  await loadFlutterwaveScript();

  initiateFlutterwaveInlinePayment(
    {
      publicKey: params.publicKey,
      txRef,
      amount,
      customer: {
        email: params.adminEmail,
        name: params.adminName,
        phone_number: params.phoneNumber,
      },
      customizations: {
        title: `ResultApp • ${params.schoolName}`,
        description: `${params.studentCount} students × ${formatNaira(PRICE_PER_STUDENT)} = ${formatNaira(amount)}`,
      },
      meta: {
        schoolName: params.schoolName,
        subdomain: params.subdomain,
        adminName: params.adminName,
        studentCount: params.studentCount,
        pricePerStudent: PRICE_PER_STUDENT,
        source: "registration",
      },
    },
    {
      onSuccess: params.onSuccess,
      onClose: params.onClose,
      onError: params.onError,
    }
  );
}
