import { NextRequest, NextResponse } from "next/server";
import { verifyTransaction } from "@/lib/flutterwave";
import { calculateTieredTotal } from "@/lib/pricing";
import { revalidateTag } from "next/cache";

/**
 * Phase 3 – Billing Upgrade Proxy
 * POST /api/billing/upgrade
 * Body: { tenantId, studentCount, transactionId }
 *
 * 1. Verifies Flutterwave transactionId server-side via verifyTransaction
 * 2. Ensures amount paid >= calculateTieredTotal(studentCount) (tiered per decision 1)
 * 3. Proxies to FastAPI POST /api/v1/tenant/{tenantId}/upgrade with X-API-SECRET-KEY
 * 4. Revalidates tenant cache so report gate disappears instantly
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
    studentCount,
    student_count,
    transactionId,
    transaction_id,
  } = body as Record<string, unknown>;

  const tenantId = String(rawTenantId ?? rawTenantIdAlt ?? "").toLowerCase().trim();
  const countRaw = studentCount ?? student_count;
  const txId = String(transactionId ?? transaction_id ?? "").trim();

  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  if (countRaw === undefined || countRaw === null || String(countRaw).trim() === "")
    return NextResponse.json({ success: false, error: "Missing studentCount" }, { status: 400 });
  if (!txId) return NextResponse.json({ success: false, error: "Missing transactionId" }, { status: 400 });

  const studentCountNum = Number(countRaw);
  if (!Number.isFinite(studentCountNum) || !Number.isInteger(studentCountNum) || studentCountNum <= 0 || studentCountNum > 10000) {
    return NextResponse.json({ success: false, error: "Invalid studentCount (must be 1-10000 integer)" }, { status: 400 });
  }

  // 1. Verify Flutterwave transaction
  let verification: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    verification = await verifyTransaction(txId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Verification failed";
    console.error("[billing/upgrade] verifyTransaction failed", msg);
    return NextResponse.json(
      { success: false, error: "Payment verification failed. Please contact support." },
      { status: 402 }
    );
  }

  const data = verification.data;
  if (!data) {
    return NextResponse.json({ success: false, error: "Invalid verification response" }, { status: 502 });
  }

  const flwStatus = (data.status || "").toLowerCase();
  const providerSuccess = verification.status === "success" || flwStatus === "successful" || flwStatus === "completed";
  if (!providerSuccess) {
    return NextResponse.json(
      { success: false, error: `Payment not successful (status: ${data.status})` },
      { status: 402 }
    );
  }

  // 2. Amount check — tiered per decision 1 (consistency with registration)
  const expected = calculateTieredTotal(studentCountNum);
  const paid = Number(data.amount ?? (data as { charged_amount?: number }).charged_amount ?? 0);
  if (paid < expected) {
    console.warn(`[billing/upgrade] amount mismatch paid ${paid} < expected ${expected} for ${studentCountNum}`);
    return NextResponse.json(
      { success: false, error: `Paid amount ₦${paid} is less than expected ₦${expected} for ${studentCountNum} students.` },
      { status: 402 }
    );
  }
  if (data.currency && data.currency.toUpperCase() !== "NGN") {
    console.warn(`[billing/upgrade] currency ${data.currency} != NGN`);
  }

  // 3. Proxy to FastAPI upgrade endpoint
  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  }

  const backendUrl = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/upgrade`;
  let backendRes: Response;
  try {
    backendRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify({ student_count: studentCountNum, transaction_id: txId }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[billing/upgrade] backend fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach upgrade service" }, { status: 502 });
  }

  const text = await backendRes.text();
  let backendData: unknown;
  try {
    backendData = JSON.parse(text);
  } catch {
    backendData = { raw: text };
  }

  if (!backendRes.ok) {
    const detail =
      (backendData as { detail?: unknown })?.detail ??
      (backendData as { error?: unknown })?.error ??
      text;
    const msg = Array.isArray(detail)
      ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
      : String(detail);
    console.error(`[billing/upgrade] backend ${backendRes.status}: ${msg}`);
    return NextResponse.json({ success: false, error: msg, raw: backendData }, { status: backendRes.status });
  }

  // 4. Revalidate tenant cache so report gate clears instantly
  try {
    // Next.js 16 types require second arg (profile) — use 'max' to match existing cache
    (revalidateTag as unknown as (tag: string, profile?: string) => void)(`school-${tenantId}`, "max");
  } catch (e) {
    console.warn("[billing/upgrade] revalidateTag failed", e);
  }

  return NextResponse.json(backendData, { status: 200 });
}
