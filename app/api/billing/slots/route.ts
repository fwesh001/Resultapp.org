import { NextRequest, NextResponse } from "next/server";
import { verifyTransaction } from "@/lib/flutterwave";
import { calculateTieredTotal } from "@/lib/pricing";
import { revalidateTag } from "next/cache";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Slot top-up API (Dual-Ledger: capacity).
 *
 * POST /api/billing/slots
 * Body: { tenantId, slotCount|studentCount, transactionId }
 *   1. Verifies Flutterwave transaction (tiered amount must match).
 *   2. Proxies to FastAPI POST /api/v1/tenant/{id}/slots/topup (also accepts /credits/slots/topup for compat)
 *   3. Revalidates tenant cache.
 *
 * Idempotent on transaction_id — replays never double-credit.
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
  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });
  const guardGet = await requireAdminSession(tenantId);
  if (guardGet) return guardGet;
  const secret = getProxySecret();
  if (!secret) return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  const base = getBackendBase();
  try {
    const res = await fetch(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/slots/balance`, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    // Fallback to direct credits/slots/balance if nested path 404
    let data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const alt = await fetch(`${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/slots/balance`, {
        headers: { "X-API-SECRET-KEY": secret },
        cache: "no-store",
      });
      data = await alt.json().catch(() => ({}));
      if (!alt.ok) throw new Error((data as { detail?: string })?.detail || `Upstream slots service failed (${alt.status})`);
      return NextResponse.json({ success: true, slots_balance: (data as { slots_balance?: number }).slots_balance ?? 0 });
    }
    return NextResponse.json({ success: true, slots_balance: (data as { slots_balance?: number }).slots_balance ?? 0, raw: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Slots service unavailable";
    console.error("[billing/slots] GET failed", msg);
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
    slotCount,
    slot_count,
    studentCount,
    student_count,
    transactionId,
    transaction_id,
  } = body as Record<string, unknown>;

  const tenantId = String(rawTenantId ?? rawTenantIdAlt ?? "").toLowerCase().trim();
  const countRaw = slotCount ?? slot_count ?? studentCount ?? student_count;
  const txId = String(transactionId ?? transaction_id ?? "").trim();

  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  const guardPost = await requireAdminSession(tenantId);
  if (guardPost) return guardPost;
  if (countRaw === undefined || countRaw === null || String(countRaw).trim() === "")
    return NextResponse.json({ success: false, error: "Missing slotCount" }, { status: 400 });
  if (!txId) return NextResponse.json({ success: false, error: "Missing transactionId" }, { status: 400 });

  const countNum = Number(countRaw);
  if (!Number.isFinite(countNum) || !Number.isInteger(countNum) || countNum <= 0 || countNum > 10000) {
    return NextResponse.json({ success: false, error: "Invalid slotCount (must be 1-10000 integer)" }, { status: 400 });
  }

  const expectedAmount = calculateTieredTotal(countNum);
  const isMockTxRef = txId.startsWith("resultapp_");
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY || "";
  const isPlaceholderSecret = !secretKey || secretKey.includes("xxxx");
  const allowMock = process.env.NODE_ENV !== "production" && (isMockTxRef || isPlaceholderSecret);

  let verification: Awaited<ReturnType<typeof verifyTransaction>>;
  if (allowMock) {
    console.warn(`[billing/slots] Mock verification for ${txId} — dev mode, crediting ${countNum} slots`);
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
      console.error("[billing/slots] verifyTransaction failed", msg, `(txId: ${txId})`);
      return NextResponse.json({ success: false, error: "Payment verification failed. Please contact support." }, { status: 402 });
    }
  }

  const data = verification.data;
  if (!data) return NextResponse.json({ success: false, error: "Invalid verification response" }, { status: 502 });
  const flwStatus = (data.status || "").toLowerCase();
  const providerSuccess = verification.status === "success" || flwStatus === "successful" || flwStatus === "completed";
  if (!providerSuccess) {
    return NextResponse.json({ success: false, error: `Payment not successful (status: ${data.status})` }, { status: 402 });
  }
  const paid = Number(data.amount ?? (data as { charged_amount?: number }).charged_amount ?? 0);
  if (paid < expectedAmount) {
    return NextResponse.json(
      { success: false, error: `Paid amount ₦${paid} is less than expected ₦${expectedAmount} for ${countNum} slots.` },
      { status: 402 },
    );
  }

  const secret = getProxySecret();
  if (!secret) return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  const base = getBackendBase();
  // Try primary slot topup path, fallback to credits/slots nested
  const tryUrls = [
    `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/slots/topup`,
    `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/slots/topup`,
  ];
  let backendRes: Response | null = null;
  let lastError = "";
  for (const url of tryUrls) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
        body: JSON.stringify({ slot_count: countNum, transaction_id: txId }),
        cache: "no-store",
      });
      backendRes = r;
      if (r.ok) break;
      const d = await r.json().catch(() => ({}));
      lastError = String((d as { detail?: unknown })?.detail ?? (d as { error?: unknown })?.error ?? `Top-up failed (${r.status})`);
      if (r.status !== 404) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!backendRes || !backendRes.ok) {
    return NextResponse.json({ success: false, error: lastError || "Slot top-up failed" }, { status: backendRes?.status || 502 });
  }
  const backendData = await backendRes.json().catch(() => ({}));
  try {
    (revalidateTag as unknown as (tag: string, profile?: string) => void)(`school-${tenantId}`, "max");
  } catch {}
  return NextResponse.json(backendData, { status: 200 });
}
