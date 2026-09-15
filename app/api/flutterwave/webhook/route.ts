import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, verifyTransaction } from "@/lib/flutterwave";

/**
 * Flutterwave webhook handler
 * POST /api/flutterwave/webhook
 *
 * Set this URL in Flutterwave Dashboard -> Settings -> Webhooks
 * Also set FLUTTERWAVE_WEBHOOK_SECRET_HASH env variable to the "verif-hash" you configure.
 *
 * Forward verified payment events to FastAPI backend for credit fulfillment.
 */
export async function POST(req: NextRequest) {
  const verifHash = req.headers.get("verif-hash");

  if (!verifyWebhookSignature(verifHash)) {
    console.warn("Flutterwave webhook: invalid verif-hash");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = payload as {
    event?: string;
    data?: {
      id?: number;
      tx_ref?: string;
      flw_ref?: string;
      amount?: number;
      currency?: string;
      status?: string;
      customer?: { email?: string };
      meta?: Record<string, unknown>;
    };
  };

  console.log("Flutterwave webhook received:", event.event, event.data?.tx_ref);

  // Optional: verify transaction server-side before fulfilling
  // This prevents spoofed webhook payloads
  if (event.data?.id) {
    try {
      const verification = await verifyTransaction(event.data.id);
      if (verification.data.status !== "successful") {
        console.log("Transaction not successful, skipping fulfillment", verification.data.status);
        return NextResponse.json({ received: true, verified: false });
      }

      // Forward to FastAPI backend for credit allocation
      // Example: POST /webhooks/flutterwave
      const backendUrl =
        process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

      const backendRes = await fetch(`${backendUrl.replace(/\/$/, "")}/webhooks/flutterwave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: event.event,
          data: verification.data,
          raw: event,
        }),
      });

      if (!backendRes.ok) {
        console.error("Failed to forward webhook to backend:", await backendRes.text());
        // Still return 200 to avoid Flutterwave retries flooding; log for manual reconciliation
      }
    } catch (err) {
      console.error("Webhook verification error:", err);
      return NextResponse.json({ error: "Verification failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}

// Flutterwave may send GET for verification during setup
export async function GET() {
  return NextResponse.json({ status: "ok", service: "flutterwave-webhook" });
}
