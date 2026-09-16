import { NextRequest, NextResponse } from "next/server";

/**
 * Flutterwave webhook handler
 * POST /api/flutterwave/webhook
 *
 * Set this URL in Flutterwave Dashboard -> Settings -> Webhooks
 * Configure FLUTTERWAVE_WEBHOOK_HASH (verif-hash) in env.
 */
export async function POST(req: NextRequest) {
  // 1. Extract verif-hash from headers
  const verifHash = req.headers.get("verif-hash");

  // 2. Compare against FLUTTERWAVE_WEBHOOK_HASH env variable
  if (verifHash !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
    // Fallback: also support legacy env name FLUTTERWAVE_WEBHOOK_SECRET_HASH
    if (
      !process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH ||
      verifHash !== process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 3. Parse JSON body and verify event type and status
  let body: {
    event?: string;
    data?: {
      status?: string;
      tx_ref?: string;
      customer?: { email?: string };
      meta?: any;
    };
  };

  try {
    body = await req.json();
  } catch {
    // Still return 200 to prevent retries for malformed payloads, or 400 if you prefer strict validation.
    // Here we return 200 with error flag so Flutterwave doesn't retry infinitely on bad JSON.
    return NextResponse.json({ received: true, error: "Invalid JSON" }, { status: 200 });
  }

  if (body.event === "charge.completed" && body.data?.status === "successful") {
    // 4. Extract provisioning details from meta - handles both array and object formats
    const rawMeta = body.data?.meta || [];
    const getMetaVal = (key: string) => {
      if (Array.isArray(rawMeta)) {
        const item = rawMeta.find((m: any) => m.metaname === key || m.name === key);
        return item?.metavalue || item?.value;
      }
      return rawMeta[key];
    };

    const schoolName = getMetaVal("schoolName") || "Victory High";
    const subdomain = getMetaVal("subdomain") || body.data?.tx_ref?.split("_")[1] || "vhs";
    const studentCount = getMetaVal("studentCount") || "300";
    const adminEmail = getMetaVal("adminEmail") || body.data?.customer?.email;

    // 5. Local Mock: bright console output for testing locally
    console.log("RAW FLUTTERWAVE DATA:", JSON.stringify(body.data, null, 2));

    console.log(
      `✅ WEBHOOK VERIFIED: Provisioning ${subdomain} for ${schoolName}...`
    );
    console.log(
      `   → School: ${schoolName} | Subdomain: ${subdomain} | Students: ${studentCount} | Admin: ${adminEmail}`
    );
    // In production, this triggers the secure fetch to our FastAPI droplet:
    // await fetch(`${process.env.PROVISION_API_URL}/provision`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "X-API-Secret": process.env.PROVISION_API_SECRET!,
    //   },
    //   body: JSON.stringify({ schoolName, subdomain, studentCount, adminEmail }),
    // });
  }

  // 6. Always return 200 OK immediately so Flutterwave doesn't retry
  return NextResponse.json({ received: true }, { status: 200 });
}

// Flutterwave may send GET for verification during setup
export async function GET() {
  return NextResponse.json({ status: "ok", service: "flutterwave-webhook" });
}
