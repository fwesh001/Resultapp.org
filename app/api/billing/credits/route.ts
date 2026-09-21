import { NextRequest, NextResponse } from "next/server";
import { verifyTransaction } from "@/lib/flutterwave";
import { calculateTieredTotal, calculateCreditTotal, CREDIT_PRICE } from "@/lib/pricing";
import { revalidateTag } from "next/cache";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Credit top-up API (Credit & Command model).
 *
 * GET  /api/billing/credits?tenant_id=vhs
 *   → { success, credit_balance, entries } (balance + ledger history)
 *
 * POST /api/billing/credits
 * Body: { tenantId, creditCount|studentCount, transactionId }
 *   1. Verifies the Flutterwave transaction server-side.
 *   2. Ensures paid >= tiered package price (same tiers as registration).
 *   3. Proxies to FastAPI POST /api/v1/tenant/{id}/credits/topup which
 *      inserts a PURCHASE ledger row and bumps credit_balance (idempotent
 *      on transaction_id — replays never double-credit).
 *   4. Revalidates tenant cache so the new balance shows instantly.
 *
 * Legacy POST /api/billing/upgrade is kept intact for backwards compat.
 */

function getProxySecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = (searchParams.get("tenant_id") || "").toLowerCase().trim();
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit")) || 50, 200));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });
  }
  const guardGet = await requireAdminSession(tenantId);
  if (guardGet) return guardGet;
  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const base = getBackendBase();
  try {
    const [balanceRes, ledgerRes] = await Promise.all([
      fetch(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/balance`, {
        headers: { "X-API-SECRET-KEY": secret },
        cache: "no-store",
      }),
      fetch(
        `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/ledger?limit=${limit}&offset=${offset}`,
        { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" },
      ),
    ]);
    const balance = await balanceRes.json().catch(() => ({}));
    const ledger = await ledgerRes.json().catch(() => ({}));
    if (!balanceRes.ok || !ledgerRes.ok) {
      throw new Error("Upstream credit service failed");
    }
    return NextResponse.json({
      success: true,
      credit_balance: (balance as { credit_balance?: number }).credit_balance ?? 0,
      entries: (ledger as { entries?: unknown[] }).entries ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Credit service unavailable";
    console.error("[billing/credits] GET failed", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const {
    tenantId: rawTenantId,
    tenant_id: rawTenantIdAlt,
    creditCount,
    credit_count,
    studentCount,
    student_count,
    transactionId,
    transaction_id,
  } = body as Record<string, unknown>;

  const tenantId = String(rawTenantId ?? rawTenantIdAlt ?? "").toLowerCase().trim();
  const countRaw = creditCount ?? credit_count ?? studentCount ?? student_count;
  const txId = String(transactionId ?? transaction_id ?? "").trim();

  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  if (countRaw === undefined || countRaw === null || String(countRaw).trim() === "")
    return NextResponse.json({ success: false, error: "Missing creditCount" }, { status: 400 });
  if (!txId) return NextResponse.json({ success: false, error: "Missing transactionId" }, { status: 400 });

  const countNum = Number(countRaw);
  if (!Number.isFinite(countNum) || !Number.isInteger(countNum) || countNum <= 0 || countNum > 10000) {
    return NextResponse.json({ success: false, error: "Invalid creditCount (must be 1-10000 integer)" }, { status: 400 });
  }

  // 1. Verify the Flutterwave transaction server-side.
  // Dev fallback: when the client used a generated tx_ref (resultapp_*) or
  // Flutterwave keys are placeholders, the transaction won't exist on
  // Flutterwave's side. In non-production we mock a successful verification
  // so local testing isn't blocked. Real production still requires a valid
  // Flutterwave transaction.
  // Credits are flat-rate (superadmin tunable via app_settings, default 200 NGN).
  // Fetching the live price is best-effort — fallback to CREDIT_PRICE on failure.
  let liveCreditPrice = CREDIT_PRICE;
  try {
    const secretTmp = getProxySecret();
    const baseTmp = getBackendBase();
    if (secretTmp) {
      const priceRes = await fetch(`${baseTmp}/api/v1/admin/config/credit-price`, {
        headers: { "X-API-SECRET-KEY": secretTmp },
        cache: "no-store",
      });
      if (priceRes.ok) {
        const priceData = await priceRes.json().catch(() => ({}));
        const p = Number((priceData as { credit_price?: number }).credit_price);
        if (Number.isFinite(p) && p > 0) liveCreditPrice = p;
      }
    }
  } catch {}
  const expectedAmount = calculateCreditTotal(countNum, liveCreditPrice);
  const isMockTxRef = txId.startsWith("resultapp_");
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY || "";
  const isPlaceholderSecret = !secretKey || secretKey.includes("xxxx");
  const allowMock = process.env.NODE_ENV !== "production" && (isMockTxRef || isPlaceholderSecret);

  let verification: Awaited<ReturnType<typeof verifyTransaction>>;
  if (allowMock) {
    console.warn(`[billing/credits] Mock verification for ${txId} — dev mode, crediting ${countNum} credits`);
    verification = {
      status: "success",
      message: "Mock verification (dev)",
      data: {
        id: 0,
        tx_ref: txId,
        flw_ref: `MOCK-${txId}`,
        amount: expectedAmount,
        currency: "NGN",
        charged_amount: expectedAmount,
        status: "successful",
        customer: { email: "", name: "" },
      },
    } as Awaited<ReturnType<typeof verifyTransaction>>;
  } else {
    try {
      verification = await verifyTransaction(txId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      console.error("[billing/credits] verifyTransaction failed", msg, `(txId: ${txId})`);
      return NextResponse.json(
        { success: false, error: "Payment verification failed. Please contact support." },
        { status: 402 },
      );
    }
  }

  const data = verification.data;
  if (!data) {
    return NextResponse.json({ success: false, error: "Invalid verification response" }, { status: 502 });
  }
  const flwStatus = (data.status || "").toLowerCase();
  const providerSuccess =
    verification.status === "success" || flwStatus === "successful" || flwStatus === "completed";
  if (!providerSuccess) {
    return NextResponse.json(
      { success: false, error: `Payment not successful (status: ${data.status})` },
      { status: 402 },
    );
  }

  // 2. Package price check — same tiered table as registration.
  const expected = expectedAmount;
  const paid = Number(data.amount ?? (data as { charged_amount?: number }).charged_amount ?? 0);
  if (paid < expected) {
    console.warn(`[billing/credits] amount mismatch paid ${paid} < expected ${expected} for ${countNum} credits`);
    return NextResponse.json(
      { success: false, error: `Paid amount ₦${paid} is less than expected ₦${expected} for ${countNum} credits.` },
      { status: 402 },
    );
  }
  if (data.currency && data.currency.toUpperCase() !== "NGN") {
    console.warn(`[billing/credits] currency ${data.currency} != NGN`);
  }

  // 3. Proxy to FastAPI top-up (idempotent on transaction_id).
  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }
  const base = getBackendBase();
  let backendRes: Response;
  try {
    backendRes = await fetch(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/topup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({ credit_count: countNum, transaction_id: txId }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[billing/credits] backend fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach credit service" }, { status: 502 });
  }

  const backendData = await backendRes.json().catch(() => ({}));
  if (!backendRes.ok) {
    const detail =
      (backendData as { detail?: unknown })?.detail ??
      (backendData as { error?: unknown })?.error ??
      `Top-up failed (${backendRes.status})`;
    const msg = Array.isArray(detail)
      ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
      : String(detail);
    return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
  }

  // 4. Revalidate so the new balance + ledger show instantly.
  try {
    (revalidateTag as unknown as (tag: string, profile?: string) => void)(`school-${tenantId}`, "max");
  } catch (e) {
    console.warn("[billing/credits] revalidateTag failed", e);
  }

  return NextResponse.json(backendData, { status: 200 });
}
