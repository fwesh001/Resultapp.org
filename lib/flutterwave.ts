/**
 * Flutterwave payment helper for resultapp.org
 * Supports BOTH server-side (secret-key) and client-side (inline checkout) flows.
 *
 * Pricing: Total Amount = Student Count * PRICE_PER_STUDENT (100 NGN)
 *
 * Env:
 * - FLUTTERWAVE_SECRET_KEY / FLW_SECRET_KEY (server)
 * - NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY / NEXT_PUBLIC_FLW_PUBLIC_KEY (client)
 * - FLUTTERWAVE_WEBHOOK_SECRET_HASH (server webhook verification)
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
 * Calculate total payable amount for a given student count.
 * Example: 150 students * 100 NGN = 15,000 NGN
 */
export function calculateTotalAmount(studentCount: number): number {
  const count = Math.max(0, Math.floor(Number(studentCount) || 0));
  return count * PRICE_PER_STUDENT;
}

/**
 * Format NGN amount with thousand separators.
 * 15000 -> "₦15,000"
 */
export function formatNaira(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount);
}

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

function getSecretKey(): string {
  const key =
    process.env.FLUTTERWAVE_SECRET_KEY ||
    process.env.FLW_SECRET_KEY ||
    process.env.FLW_SECRET_HASH;
  if (!key) {
    throw new Error(
      "Flutterwave secret key is missing. Set FLUTTERWAVE_SECRET_KEY or FLW_SECRET_KEY in env."
    );
  }
  return key;
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

export function verifyWebhookSignature(verifHashHeader: string | null): boolean {
  const secretHash =
    process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH || process.env.FLW_WEBHOOK_HASH || "";
  if (!secretHash) {
    console.warn(
      "FLUTTERWAVE_WEBHOOK_SECRET_HASH not set - skipping verification (allow in dev only)"
    );
    return process.env.NODE_ENV !== "production";
  }
  if (!verifHashHeader) return false;
  return verifHashHeader === secretHash;
}

// ---------------------------------------------------------------------------
// Client-side helpers (inline checkout)
// ---------------------------------------------------------------------------

export function getFlutterwavePublicKey(): string {
  const key =
    process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_FLW_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY_TEST ||
    "";
  return key;
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
    FlutterwaveCheckout?: (config: Record<string, unknown>) => void;
  }
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
): void {
  if (typeof window === "undefined") {
    callbacks.onError?.(new Error("FlutterwaveCheckout is only available on the client"));
    return;
  }

  if (!window.FlutterwaveCheckout) {
    callbacks.onError?.(
      new Error("FlutterwaveCheckout not loaded. Call loadFlutterwaveScript() first.")
    );
    return;
  }

  if (!config.publicKey) {
    callbacks.onError?.(new Error("Flutterwave public key is missing"));
    return;
  }

  const { onSuccess, onClose, onError } = callbacks;

  try {
    window.FlutterwaveCheckout({
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
  } catch (err) {
    onError?.(err as Error);
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
