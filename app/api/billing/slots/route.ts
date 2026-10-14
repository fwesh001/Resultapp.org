import { NextRequest, NextResponse } from "next/server";
import { verifyTransaction } from "@/lib/flutterwave";
import { calculateTieredTotal } from "@/lib/pricing";
import { revalidateTag } from "next/cache";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Slot top-up API (Dual-Ledger: capacity).
 *
 * POST /api/billing/slots
 * Body: { tenantId, slotCount|studentCount, transactionId, waiverTokenId?, waiverReservationTxRef? }
 *   1. Prices the purchase (list price, or the waived split from the backend)
 *   2. Verifies the Flutterwave transaction against that price
 *   3. Proxies to FastAPI, which grants the slots and burns any token
 *   4. Revalidates tenant cache
 *
 * Idempotent on transaction_id — replays never double-credit.
 *
 * ── WAIVERS ───────────────────────────────────────────────────────────────
 * The waiver CODE never reaches this route. It is exchanged for a token id and
 * a reservation ref by /api/billing/waiver/reserve before checkout opens; this
 * route is handed those instead. A code that has already been exchanged has no
 * reason to be in flight again.
 *
 * The 100% BYPASS is real here, not theoretical: when the backend's split says
 * charged_ngn is 0 there is no charge to verify, no transaction id, and the
 * grant goes straight through. Flutterwave rejects a zero-value transaction, so
 * handing it ₦0 would fail the purchase rather than complete it.
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
    waiverTokenId,
    waiver_token_id,
    waiverReservationTxRef,
    waiver_reservation_tx_ref,
  } = body as Record<string, unknown>;

  const tenantId = String(rawTenantId ?? rawTenantIdAlt ?? "").toLowerCase().trim();
  const countRaw = slotCount ?? slot_count ?? studentCount ?? student_count;
  const txId = String(transactionId ?? transaction_id ?? "").trim();
  const wTokenId = Number(waiverTokenId ?? waiver_token_id);
  const wTxRef = String(waiverReservationTxRef ?? waiver_reservation_tx_ref ?? "").trim();

  if (!tenantId) return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
  const guardPost = await requireAdminSession(tenantId);
  if (guardPost) return guardPost;
  if (countRaw === undefined || countRaw === null || String(countRaw).trim() === "")
    return NextResponse.json({ success: false, error: "Missing slotCount" }, { status: 400 });

  const countNum = Number(countRaw);
  if (!Number.isFinite(countNum) || !Number.isInteger(countNum) || countNum <= 0 || countNum > 10000) {
    return NextResponse.json({ success: false, error: "Invalid slotCount (must be 1-10000 integer)" }, { status: 400 });
  }

  const secret = getProxySecret();
  if (!secret) return NextResponse.json({ success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" }, { status: 500 });
  const base = getBackendBase();

  // ------------------------------------------------------------------------
  // WAIVED PATH
  //
  // The verification order is the design, so it is spelled out rather than
  // left to the order of statements below:
  //
  //     quote (backend terms) -> verify Flutterwave against the DISCOUNTED
  //     amount -> with-waiver (grant)
  //
  // The expected charge comes from the BACKEND, never from the request body.
  // Verifying against a client-supplied "expected" would make the discount an
  // attack surface — the client would simply claim it expected ₦0. Verifying
  // after the grant would mean the seats are already committed when the amount
  // turns out to be short.
  // ------------------------------------------------------------------------
  if (Number.isInteger(wTokenId) && wTokenId > 0) {
    if (!wTxRef) {
      return NextResponse.json({ success: false, error: "Missing waiver reservation reference" }, { status: 400 });
    }

    let split: Record<string, unknown>;
    try {
      const q = await fetch(`${base}/api/v1/waiver/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
        body: JSON.stringify({
          token_id: wTokenId,
          reservation_tx_ref: wTxRef,
          requested_slots: countNum,
        }),
        cache: "no-store",
      });
      const qData = (await q.json().catch(() => ({}))) as {
        split?: Record<string, unknown>;
        detail?: unknown;
        error?: unknown;
      };
      if (!q.ok || !qData.split) {
        return NextResponse.json(
          {
            success: false,
            error: String(qData.detail ?? qData.error ?? "That waiver code is not available"),
          },
          { status: q.ok ? 502 : q.status },
        );
      }
      split = qData.split;
    } catch (e) {
      console.error("[billing/slots] waiver quote failed", e);
      return NextResponse.json({ success: false, error: "Could not price that waiver code." }, { status: 502 });
    }

    const chargedNgn = Number(split.charged_ngn ?? 0);
    const bypass = split.bypass_gateway === true;
    let paidAmount = 0;

    if (!bypass) {
      if (!txId) {
        return NextResponse.json(
          { success: false, error: "Missing transactionId for a partially-waived purchase" },
          { status: 400 },
        );
      }
      const verification = await verifyCharge(txId, chargedNgn, countNum);
      if ("error" in verification) {
        return NextResponse.json({ success: false, error: verification.error }, { status: verification.status });
      }
      paidAmount = verification.paid;
    } else if (txId) {
      // A charge on a fully-waived order is unaccounted-for money. Refuse it
      // rather than quietly booking revenue with no matching grant.
      return NextResponse.json(
        { success: false, error: "This order is fully covered by the waiver code and must not be charged" },
        { status: 400 },
      );
    }

    try {
      const r = await fetch(
        `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/slots/topup/with-waiver`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
          body: JSON.stringify({
            waiver_token_id: wTokenId,
            reservation_tx_ref: wTxRef,
            requested_slots: countNum,
            // Omitted entirely on a bypass. Sending transaction_id: null would
            // fail the model's min_length and, worse, invite someone to "fix"
            // it with a placeholder that lands in the ledger.
            ...(bypass ? {} : { transaction_id: txId, amount_ngn: paidAmount }),
          }),
          cache: "no-store",
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return NextResponse.json(
          { success: false, error: (data as { detail?: string })?.detail ?? `Waiver top-up failed (${r.status})` },
          { status: r.status },
        );
      }
      try {
        (revalidateTag as unknown as (tag: string, profile?: string) => void)(`school-${tenantId}`, "max");
      } catch {}
      return NextResponse.json(data, { status: 200 });
    } catch (e) {
      console.error("[billing/slots] waived top-up proxy failed", e);
      return NextResponse.json({ success: false, error: "Could not reach billing service" }, { status: 502 });
    }
  }

  // ------------------------------------------------------------------------
  // PLAIN PATH — behaviour unchanged from before waiver support existed.
  // ------------------------------------------------------------------------
  if (!txId) return NextResponse.json({ success: false, error: "Missing transactionId" }, { status: 400 });

  const verification = await verifyCharge(txId, calculateTieredTotal(countNum), countNum);
  if ("error" in verification) {
    return NextResponse.json({ success: false, error: verification.error }, { status: verification.status });
  }
  const paid = verification.paid;

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
        body: JSON.stringify({ slot_count: countNum, transaction_id: txId, amount_ngn: paid }),
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

/**
 * Verify a Flutterwave charge against an expected amount.
 *
 * Extracted so the waived and plain paths cannot drift apart on the one thing
 * that matters: that "paid" means the same thing, and that a short payment is
 * a 402, in both.
 */
async function verifyCharge(
  txId: string,
  expectedAmount: number,
  countNum: number,
): Promise<{ paid: number } | { error: string; status: number }> {
  const isMockTxRef = txId.startsWith("resultapp_");
  // Canonical name only — see the note in app/api/billing/credits/route.ts.
  // Mock verification stays behind NODE_ENV so production can never
  // short-circuit a real payment.
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY || "";
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
      console.error(`[billing/slots] verifyTransaction failed`, msg, `(txId: ${txId})`);
      return { error: "Payment verification failed. Please contact support.", status: 402 };
    }
  }

  const data = verification.data;
  if (!data) return { error: "Invalid verification response", status: 502 };
  const flwStatus = (data.status || "").toLowerCase();
  const providerSuccess =
    verification.status === "success" || flwStatus === "successful" || flwStatus === "completed";
  if (!providerSuccess) {
    return { error: `Payment not successful (status: ${data.status})`, status: 402 };
  }
  const paid = Number(data.amount ?? (data as { charged_amount?: number }).charged_amount ?? 0);
  if (paid < expectedAmount) {
    return {
      error: `Paid amount NGN ${paid} is less than expected NGN ${expectedAmount} for ${countNum} slots.`,
      status: 402,
    };
  }
  return { paid };
}
