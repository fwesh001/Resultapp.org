import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/flutterwave";
import { provisionHeldRegistration } from "@/lib/pendingRegistrations";

/**
 * Flutterwave webhook — the safety net for a paid registration whose browser
 * callback never arrived.
 *
 * WHY THIS EXISTS
 * ---------------
 * Registration hands the visitor to Flutterwave and then provisions from the
 * browser's callback. If that tab closes, crashes, or loses signal after the
 * charge settles, the callback never arrives, /api/register-school is never
 * called, and the school has paid for a portal that does not exist. In test
 * mode someone notices and refunds manually. With live money that is a real
 * customer paying for nothing.
 *
 * WHY IT IS SAFE TO ACT HERE
 * --------------------------
 * Three properties, in order:
 *
 *   1. The signature is verified BEFORE anything is parsed or acted on. An
 *      unsigned request is rejected with a 401 and touches nothing.
 *   2. The webhook does not trust its own payload for anything that matters.
 *      The transaction is re-verified against Flutterwave's API, so amount,
 *      status and currency come from the provider — the same authoritative
 *      check the browser path performs. A forged-but-signed event cannot skip it.
 *   3. Provisioning is idempotent. The hold is claimed atomically, so when the
 *      browser callback and this handler both run (the normal case), one
 *      provisions and the other sees the hold already claimed and exits. A 409
 *      from the backend meaning "subdomain taken" is also treated as success,
 *      because that is precisely what the other path finishing looks like.
 *
 * The registration details are NOT read from the webhook payload. The admin
 * password is deliberately absent from the checkout `meta` — meta is retained by
 * Flutterwave and putting a credential there would disclose it to a third party
 * (a remediated P0). Details come from the server-side hold instead.
 *
 * RESPONSES
 * ---------
 * Always 200 once the signature checks out, even for events we ignore or fail to
 * act on. A non-2xx makes Flutterwave retry, and retrying a permanently
 * un-actionable event just generates load. Real failures are logged with enough
 * detail to act on.
 */

/** Flutterwave event types we act on. Everything else is acknowledged and ignored. */
const PROVISIONING_EVENT = "charge.completed";

export async function POST(req: NextRequest) {
  // 1. Verify BEFORE parsing. An unauthenticated caller must not be able to
  //    reach the body parser, let alone the provisioning path.
  const verifHash = req.headers.get("verif-hash");
  if (!verifyWebhookSignature(verifHash)) {
    console.warn(
      "[flutterwave-webhook] rejected: bad or missing verif-hash signature",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse.
  let body: {
    event?: string;
    data?: {
      status?: string;
      tx_ref?: string;
      id?: number;
      amount?: number;
      charged_amount?: number;
      currency?: string;
      customer?: { email?: string };
    };
  };
  try {
    body = await req.json();
  } catch {
    // Signature was valid but the body is not JSON. Acknowledge so Flutterwave
    // does not retry forever against a payload that will never parse.
    console.error("[flutterwave-webhook] verified request had an unparseable body");
    return NextResponse.json({ received: true, error: "Invalid JSON" }, { status: 200 });
  }

  // 3. Narrow to events we act on, BEFORE any log noise for the rest. Flutterwave
  //    sends a steady stream of unrelated events to this endpoint.
  if (body.event !== PROVISIONING_EVENT) {
    return NextResponse.json({ received: true, ignored: body.event ?? "unknown" }, { status: 200 });
  }

  const status = String(body.data?.status || "").toLowerCase();
  if (status !== "successful") {
    // Not a settlement. Nothing to provision, and nothing to retry later: the
    // browser path owns failed-payment messaging.
    return NextResponse.json({ received: true, ignored_status: status }, { status: 200 });
  }

  // 4. The tx_ref is the join key between this event and the parked hold.
  const txRef = (body.data?.tx_ref || "").trim();
  if (!txRef) {
    console.error("[flutterwave-webhook] charge.completed with no tx_ref");
    return NextResponse.json({ received: true, error: "Missing tx_ref" }, { status: 200 });
  }

  // Reject anything that is not one of OUR references. The signature already
  // proves Flutterwave sent this, but a school could attach an arbitrary
  // tx_ref to their own payment, and this endpoint provisions on that key.
  if (!/^resultapp_[a-z0-9-]+_\d+_[a-z0-9]+$/.test(txRef)) {
    console.warn(`[flutterwave-webhook] ignoring non-registration tx_ref: ${txRef}`);
    return NextResponse.json({ received: true, ignored: "not_a_registration" }, { status: 200 });
  }

  // 5. Provision from the hold. All payment truth is re-derived inside.
  try {
    const outcome = await provisionHeldRegistration(txRef, { source: "webhook" });

    switch (outcome.status) {
      case "provisioned":
        console.log(
          `[flutterwave-webhook] ✅ provisioned ${outcome.subdomain} from webhook (tx_ref ${txRef})`,
        );
        break;
      case "already_done":
        // The expected outcome whenever the browser callback already won.
        console.log(
          `[flutterwave-webhook] ${outcome.subdomain} already provisioned; nothing to do (tx_ref ${txRef})`,
        );
        break;
      case "no_hold":
        // Payment succeeded but we hold no details — e.g. a billing top-up, which
        // has its own path, or a hold already reaped. Not an incident.
        console.log(
          `[flutterwave-webhook] no pending registration for ${txRef} (handled elsewhere or expired)`,
        );
        break;
      case "expired":
        // PAID, but the hold aged out. This is the one case that needs a human.
        console.error(
          `[flutterwave-webhook] ⛔ PAID but hold expired for ${txRef} — manual provisioning required`,
        );
        break;
      case "undecryptable":
        console.error(
          `[flutterwave-webhook] ⛔ PAID but held credentials could not be decrypted for ${txRef} — manual provisioning required`,
        );
        break;
      case "not_paid":
        console.warn(
          `[flutterwave-webhook] ${txRef} reported successful by Flutterwave but failed re-verification; not provisioning`,
        );
        break;
      default:
        console.error(
          `[flutterwave-webhook] ⛔ provisioning failed for ${txRef}: ${outcome.detail}`,
        );
        break;
    }

    // Every outcome is a 200. The outcome is recorded in logs; a non-2xx would
    // only provoke retries of something the browser path or an operator handles.
    return NextResponse.json(
      { received: true, outcome: outcome.status },
      { status: 200 },
    );
  } catch (e) {
    console.error(
      "[flutterwave-webhook] unhandled error during provisioning:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ received: true, error: "processing failed" }, { status: 200 });
  }
}

/** Flutterwave pings this during dashboard webhook setup. */
export async function GET() {
  return NextResponse.json({ status: "ok", service: "flutterwave-webhook" });
}
