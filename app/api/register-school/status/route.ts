import { NextRequest, NextResponse } from "next/server";

/**
 * Payment status lookup by tx_ref
 * GET /api/register-school/status?tx_ref=<ref>
 *
 * Exists because the Flutterwave inline modal cannot be relied on to deliver
 * its client-side `callback` for every successful payment. Card flows that
 * require 3-D Secure validation (VBV) hand control to the issuing bank, and
 * the modal's own success screen can sit there without ever resolving the
 * callback. When that happens the user has paid, but the wizard never learns
 * the transaction id, so it never provisions and never redirects.
 *
 * This endpoint is the recovery path: the wizard already generated the tx_ref
 * BEFORE opening checkout, so we can always ask Flutterwave what happened to
 * it. Verified server-side with the secret key, so a client cannot use it to
 * claim a payment it did not make.
 *
 * Returns the transaction id and amount on success, which is exactly what
 * POST /api/register-school needs to finish provisioning.
 */

const TX_REF_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SUCCESS_STATUSES = new Set(["successful", "success", "completed"]);

export async function GET(req: NextRequest) {
  const txRef = (req.nextUrl.searchParams.get("tx_ref") || "").trim();

  if (!txRef || !TX_REF_RE.test(txRef)) {
    return NextResponse.json(
      { status: "unknown", error: "A valid tx_ref is required" },
      { status: 400 }
    );
  }

  const secretKey =
    process.env.FLUTTERWAVE_SECRET_KEY ||
    process.env.FLW_SECRET_KEY ||
    process.env.FLW_SECRET_HASH ||
    "";

  if (!secretKey) {
    // Never claim a payment failed when we simply cannot check. The wizard
    // treats "unknown" as "still pending" and offers to retry, which is the
    // safe direction to err in — a false negative strands a paying customer.
    return NextResponse.json(
      { status: "unknown", error: "Payment verification is not configured" },
      { status: 503 }
    );
  }

  let data: {
    status?: string;
    message?: string;
    data?: {
      id?: number;
      status?: string;
      amount?: number;
      charged_amount?: number;
      tx_ref?: string;
    };
  };

  try {
    const res = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );
    data = (await res.json()) as typeof data;
  } catch (err) {
    console.error("[register-school/status] lookup failed", err);
    return NextResponse.json(
      { status: "unknown", error: "Could not reach the payment provider" },
      { status: 502 }
    );
  }

  const tx = data?.data;
  const status = String(tx?.status || data?.status || "").toLowerCase();

  if (!tx?.id) {
    // No transaction for this reference yet. For a genuinely abandoned
    // checkout this is terminal; for one still mid-3DS it is transient. We
    // report "unknown" so the client can distinguish "not yet" from "failed".
    return NextResponse.json({ status: "unknown", tx_ref: txRef });
  }

  const paid = SUCCESS_STATUSES.has(status);

  return NextResponse.json({
    status: paid ? "successful" : status || "unknown",
    paid,
    transaction_id: tx.id,
    amount: Number(tx.charged_amount ?? tx.amount ?? 0),
    tx_ref: tx.tx_ref || txRef,
  });
}