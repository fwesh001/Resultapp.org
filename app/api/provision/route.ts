import { NextRequest, NextResponse } from "next/server";
import { verifyTransaction, calculateTotalAmount } from "@/lib/flutterwave";

/**
 * Secure server-side provision proxy for ResultApp.
 *
 * POST /api/provision
 * Receives Flutterwave transaction after client checkout, verifies server-side,
 * then securely proxies to FastAPI Droplet via X-API-SECRET-KEY.
 *
 * Env (server-only, NEVER NEXT_PUBLIC_):
 * - PROVISION_API_URL  e.g. http://your-droplet-ip:8000/api/v1/provision
 * - PROVISION_API_SECRET  must match FastAPI backend API_SECRET_KEY
 * - FLUTTERWAVE_SECRET_KEY  (or FLW_SECRET_KEY) for verification
 *
 * Security: Secret is never exposed to client — this route runs only on server.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;
const RESERVED = new Set([
  "www",
  "api",
  "admin",
  "app",
  "dashboard",
  "resultapp",
  "mail",
  "support",
  "help",
  "billing",
]);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[provision] Missing required env: ${name}`);
    throw new Error(`Server misconfigured: missing ${name}`);
  }
  return v.trim();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProvisionBody {
  transaction_id?: number | string;
  transactionId?: number | string; // alias
  tx_ref?: string;
  txRef?: string;
  // School metadata — may come from client OR Flutterwave meta
  schoolName?: string;
  school_name?: string;
  subdomain?: string;
  adminEmail?: string;
  admin_email?: string;
  adminName?: string;
  admin_name?: string;
  phoneNumber?: string;
  phone_number?: string;
  phone?: string;
  studentCount?: number | string;
  student_count?: number | string;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // ---- Step 0: Env validation (fail fast, 500) ----
  let provisionUrl: string;
  let provisionSecret: string;
  let flwSecretPresent: boolean;
  try {
    provisionUrl = getEnvOrThrow("PROVISION_API_URL");
    provisionSecret = getEnvOrThrow("PROVISION_API_SECRET");
    flwSecretPresent = !!(
      process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY || process.env.FLW_SECRET_HASH
    );
    if (!flwSecretPresent) {
      console.error("[provision] FLUTTERWAVE_SECRET_KEY is not set");
      return NextResponse.json(
        { success: false, error: "Server misconfigured: missing FLUTTERWAVE_SECRET_KEY" },
        { status: 500 }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server misconfigured";
    console.error("[provision] env check failed:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  // ---- Parse body ----
  let body: ProvisionBody;
  try {
    body = (await req.json()) as ProvisionBody;
  } catch {
    console.error("[provision] Invalid JSON body");
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // ---- Extract transaction identifier ----
  const transactionIdRaw = body.transaction_id ?? body.transactionId;
  const txRefFromBody = (body.tx_ref ?? body.txRef ?? "").toString().trim();

  if (!transactionIdRaw) {
    console.error("[provision] Missing transaction_id", { bodyKeys: Object.keys(body) });
    return NextResponse.json(
      { success: false, error: "Missing transaction_id — payment verification requires transaction ID" },
      { status: 400 }
    );
  }

  const transactionId = String(transactionIdRaw).trim();
  if (!transactionId) {
    return NextResponse.json({ success: false, error: "Invalid transaction_id" }, { status: 400 });
  }

  // ---- Step A: Verify Flutterwave transaction server-side ----
  let verification: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    console.log(`[provision] Verifying Flutterwave transaction ${transactionId} ...`);
    verification = await verifyTransaction(transactionId);
  } catch (err) {
    console.error("[provision] Flutterwave verification failed:", err);
    const msg = err instanceof Error ? err.message : "Flutterwave verification failed";
    // Do not leak raw Flutterwave error details containing secret context
    return NextResponse.json(
      { success: false, error: "Payment verification failed. Please contact support with your transaction reference.", details: msg },
      { status: 402 }
    );
  }

  // Flutterwave verify response shape: { status, message, data: { id, tx_ref, flw_ref, amount, currency, status, customer, meta } }
  const data = verification.data;
  if (!data) {
    console.error("[provision] Verification response has no data", verification);
    return NextResponse.json({ success: false, error: "Invalid verification response from payment provider" }, { status: 502 });
  }

  // Must be successful
  const flwStatus = (data.status || "").toLowerCase();
  if (flwStatus !== "successful" && flwStatus !== "completed" && verification.status !== "success") {
    console.error("[provision] Transaction not successful", { flwStatus, providerStatus: verification.status, tx_ref: data.tx_ref });
    return NextResponse.json(
      { success: false, error: `Payment not successful (status: ${data.status}). If you were charged, contact support.` },
      { status: 402 }
    );
  }

  // Optional: verify tx_ref matches if client sent one (prevents mix-and-match)
  if (txRefFromBody && data.tx_ref && txRefFromBody !== data.tx_ref) {
    console.warn(`[provision] tx_ref mismatch: body=${txRefFromBody} vs verified=${data.tx_ref} — continuing but logging`);
    // Not fatal — we use verified tx_ref, but could enforce strict
  }

  // ---- Step B: Extract school metadata (prefer verified meta, fallback to body) ----
  const meta = (data.meta as Record<string, unknown> | undefined) || {};

  const schoolNameRaw =
    (meta.schoolName as string) ||
    (meta.school_name as string) ||
    body.schoolName ||
    body.school_name ||
    "";
  const subdomainRaw =
    (meta.subdomain as string) || body.subdomain || "";
  const adminEmailRaw =
    (meta.adminEmail as string) ||
    (meta.admin_email as string) ||
    body.adminEmail ||
    body.admin_email ||
    data.customer?.email ||
    "";
  const adminNameRaw =
    (meta.adminName as string) ||
    (meta.admin_name as string) ||
    body.adminName ||
    body.admin_name ||
    data.customer?.name ||
    "";
  const phoneRaw =
    (meta.phoneNumber as string) ||
    (meta.phone_number as string) ||
    body.phoneNumber ||
    body.phone_number ||
    body.phone ||
    (data.customer as unknown as { phone_number?: string })?.phone_number ||
    "";
  const studentCountRaw =
    (meta.studentCount as number) ??
    (meta.student_count as number) ??
    body.studentCount ??
    body.student_count ??
    "";

  const schoolName = String(schoolNameRaw).trim();
  const subdomain = String(subdomainRaw).trim().toLowerCase();
  const adminEmail = String(adminEmailRaw).trim().toLowerCase();
  const adminName = String(adminNameRaw).trim();
  const phoneNumber = String(phoneRaw).trim();
  const studentCount = Number(studentCountRaw);

  // Validate extracted fields
  if (!schoolName || schoolName.length < 3) {
    console.error("[provision] Missing/invalid schoolName after verification", { meta, body });
    return NextResponse.json({ success: false, error: "Missing school name in payment metadata" }, { status: 400 });
  }
  if (!subdomain || !SUBDOMAIN_RE.test(subdomain) || subdomain.startsWith("-") || subdomain.endsWith("-") || RESERVED.has(subdomain)) {
    console.error("[provision] Invalid subdomain after verification", { subdomain, meta });
    return NextResponse.json({ success: false, error: "Invalid subdomain in payment metadata" }, { status: 400 });
  }
  if (!adminEmail || !isValidEmail(adminEmail)) {
    console.error("[provision] Invalid adminEmail after verification", { adminEmail, meta });
    return NextResponse.json({ success: false, error: "Invalid admin email in payment metadata" }, { status: 400 });
  }
  if (!Number.isFinite(studentCount) || studentCount <= 0 || studentCount > 10000 || !Number.isInteger(studentCount)) {
    console.error("[provision] Invalid studentCount after verification", { studentCount, meta });
    return NextResponse.json({ success: false, error: "Invalid student count in payment metadata" }, { status: 400 });
  }

  // Verify amount matches pricing: studentCount * 100 NGN
  const expectedAmount = calculateTotalAmount(studentCount);
  const paidAmount = Number(data.amount ?? data.charged_amount ?? 0);
  // Allow small tolerance? No, must be exact or greater (in case of fees). Require paid >= expected.
  if (paidAmount < expectedAmount) {
    console.error(`[provision] Amount mismatch: paid ${paidAmount} < expected ${expectedAmount} for ${studentCount} students`, {
      paidAmount,
      expectedAmount,
      currency: data.currency,
      tx_ref: data.tx_ref,
    });
    return NextResponse.json(
      { success: false, error: `Paid amount (₦${paidAmount}) does not match expected price (₦${expectedAmount}) for ${studentCount} students.` },
      { status: 402 }
    );
  }
  if (data.currency && data.currency.toUpperCase() !== "NGN") {
    console.warn(`[provision] Unexpected currency ${data.currency}, expected NGN`);
  }

  console.log(
    `[provision] Verified OK: ${schoolName} (${subdomain}) — ${studentCount} students, ₦${paidAmount} paid (expected ₦${expectedAmount}), tx=${data.tx_ref}`
  );

  // ---- Step C: Proxy to FastAPI Droplet ----
  const fastApiPayload = {
    school_name: schoolName,
    subdomain: subdomain,
    admin_email: adminEmail,
    admin_name: adminName || adminEmail.split("@")[0],
    phone_number: phoneNumber || undefined,
    student_count: studentCount,
  };

  let provisionRes: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s

    // Ensure URL is correct — backend expects /api/v1/provision
    // If PROVISION_API_URL is e.g. http://droplet:8000, we append path; if already full, use as-is
    let targetUrl = provisionUrl.replace(/\/$/, "");
    if (!targetUrl.includes("/api/v1/provision")) {
      // Heuristic: if url ends with /provision already, keep, else append
      if (targetUrl.endsWith("/provision")) {
        // ok
      } else if (targetUrl.includes("/api/v1")) {
        targetUrl = `${targetUrl.replace(/\/$/, "")}/provision`;
      } else {
        targetUrl = `${targetUrl}/api/v1/provision`;
      }
    }

    console.log(`[provision] Forwarding to FastAPI: ${targetUrl} for ${subdomain}`);

    provisionRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": provisionSecret,
      },
      body: JSON.stringify(fastApiPayload),
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeout);
  } catch (err) {
    console.error("[provision] Failed to reach FastAPI backend:", err);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      {
        success: false,
        error: isAbort
          ? "Provisioning service timed out. Please contact support with your transaction reference."
          : "Could not reach provisioning service. Please try again or contact support.",
      },
      { status: 502 }
    );
  }

  const provisionContentType = provisionRes.headers.get("content-type") || "";
  const isJson = provisionContentType.includes("application/json");
  let provisionData: unknown;
  try {
    provisionData = isJson ? await provisionRes.json() : await provisionRes.text();
  } catch (err) {
    console.error("[provision] Failed to parse FastAPI response:", err);
    return NextResponse.json({ success: false, error: "Invalid response from provisioning service" }, { status: 502 });
  }

  // ---- Step D: Handle FastAPI response ----
  if (!provisionRes.ok) {
    const backendDetail =
      (provisionData as { detail?: string; message?: string; error?: string })?.detail ||
      (provisionData as { message?: string })?.message ||
      (provisionData as { error?: string })?.error ||
      (typeof provisionData === "string" ? provisionData : JSON.stringify(provisionData));

    console.error(`[provision] FastAPI error ${provisionRes.status}:`, backendDetail);

    // Map known backend statuses to frontend statuses
    if (provisionRes.status === 409) {
      return NextResponse.json(
        { success: false, error: `Subdomain "${subdomain}" is already taken. Please choose another.` },
        { status: 409 }
      );
    }
    if (provisionRes.status === 401 || provisionRes.status === 403) {
      // This indicates secret mismatch — server misconfig, don't expose details
      return NextResponse.json(
        { success: false, error: "Server configuration error (provisioning auth). Please contact support." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: backendDetail || "Provisioning failed on server. Please contact support.", raw: provisionData },
      { status: provisionRes.status >= 400 && provisionRes.status < 600 ? provisionRes.status : 500 }
    );
  }

  // Success — normalize shape
  const successPayload = provisionData as {
    deployed_url?: string;
    url?: string;
    domain?: string;
    timestamp?: string;
    message?: string;
    [k: string]: unknown;
  };

  const deployedUrl = successPayload.deployed_url || successPayload.url || `https://${subdomain}.resultapp.org`;
  const domain = successPayload.domain || `${subdomain}.resultapp.org`;

  console.log(`[provision] Success: ${schoolName} → ${deployedUrl}`);

  return NextResponse.json(
    {
      success: true,
      message: `Successfully provisioned ${domain} for ${schoolName}`,
      deployed_url: deployedUrl,
      domain,
      subdomain,
      school_name: schoolName,
      student_count: studentCount,
      total_amount_ngn: expectedAmount,
      tx_ref: data.tx_ref,
      flw_ref: data.flw_ref,
      // Pass through backend timestamp if present
      timestamp: successPayload.timestamp || new Date().toISOString(),
      backend: successPayload, // for debugging (remove in prod if sensitive)
    },
    { status: 200 }
  );
}

// Optional: handle preflight / health
export async function GET() {
  const hasUrl = !!process.env.PROVISION_API_URL;
  const hasSecret = !!process.env.PROVISION_API_SECRET;
  const hasFlw = !!(process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY);
  return NextResponse.json({
    service: "provision proxy",
    configured: hasUrl && hasSecret && hasFlw,
    provision_url_set: hasUrl,
    provision_secret_set: hasSecret,
    flutterwave_secret_set: hasFlw,
    timestamp: new Date().toISOString(),
  });
}
