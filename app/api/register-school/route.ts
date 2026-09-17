import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 1 – Tenant Onboarding Proxy
 * POST /api/register-school
 *
 * Secure Next.js proxy that validates the 4-field onboarding form and
 * forwards to the live FastAPI provisioning engine.
 *
 * Forward target: http://159.223.178.34:8000/api/v1/provision
 * Auth: header X-API-SECRET-KEY = BACKEND_API_SECRET (fallback PROVISION_API_SECRET)
 *
 * This route is server-only — the secret is never exposed to the client.
 * Keep SchoolRegistrationForm / /api/provision intact for Phase 3 (paid) flow.
 */

// ---------------------------------------------------------------------------
// Config & helpers
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
  "ops",
  "status",
]);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getProvisionSecret(): string {
  // Requirement: check BACKEND_API_SECRET first, fallback to PROVISION_API_SECRET
  const secret =
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    "";
  return secret;
}

function getProvisionUrl(): string {
  // Live backend from spec: http://159.223.178.34:8000/api/v1/provision
  // Allow override via env (PROVISION_API_URL, BACKEND_URL, API_URL)
  const raw =
    process.env.PROVISION_API_URL?.trim() ||
    process.env.BACKEND_URL?.trim() ||
    process.env.API_URL?.trim() ||
    "http://159.223.178.34:8000/api/v1/provision";
  return raw;
}

function buildTargetUrl(raw: string): string {
  const url = raw.replace(/\/$/, "");
  // Ensure we end at /api/v1/provision
  if (url.includes("/api/v1/provision")) return url;
  if (url.endsWith("/provision")) return url;
  if (url.includes("/api/v1")) return `${url.replace(/\/$/, "")}/provision`;
  return `${url}/api/v1/provision`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RegisterSchoolBody {
  // Phase 1 required 4 fields (support both camel & snake for robustness)
  schoolName?: string;
  school_name?: string;
  subdomain?: string;
  adminEmail?: string;
  admin_email?: string;
  studentCount?: number | string;
  student_count?: number | string;
  // Optional for forward-compat (if Phase 3 merges)
  adminName?: string;
  admin_name?: string;
  phoneNumber?: string;
  phone_number?: string;
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // ---- Env check (fail fast) ----
  const secret = getProvisionSecret();
  const rawUrl = getProvisionUrl();

  if (!secret) {
    console.error("[register-school] Missing BACKEND_API_SECRET / PROVISION_API_SECRET");
    return NextResponse.json(
      {
        success: false,
        error: "Server misconfigured: missing BACKEND_API_SECRET (or PROVISION_API_SECRET). Set it in .env.local and restart.",
      },
      { status: 500 }
    );
  }

  if (!rawUrl) {
    console.error("[register-school] Missing provision URL");
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing provision URL" },
      { status: 500 }
    );
  }

  // ---- Parse body ----
  let body: RegisterSchoolBody;
  try {
    body = (await req.json()) as RegisterSchoolBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // ---- Normalize ----
  const schoolName = String(body.schoolName ?? body.school_name ?? "").trim();
  const subdomainRaw = String(body.subdomain ?? "").trim().toLowerCase();
  const subdomain = subdomainRaw; // already lowercased
  const adminEmail = String(body.adminEmail ?? body.admin_email ?? "")
    .trim()
    .toLowerCase();
  const studentCountRaw = body.studentCount ?? body.student_count ?? "";
  // coerce student count: string "150" -> 150
  const studentCount = Number(String(studentCountRaw).trim());

  // Optional derived
  const adminNameRaw = String(body.adminName ?? body.admin_name ?? "").trim();
  const adminName = adminNameRaw || adminEmail.split("@")[0] || "";

  // ---- Validation (client spec + backend 409/422 parity) ----
  const fieldErrors: Record<string, string> = {};

  if (!schoolName || schoolName.length < 3) {
    fieldErrors.schoolName = "School name must be at least 3 characters";
  }

  if (!subdomain) {
    fieldErrors.subdomain = "Subdomain is required";
  } else if (subdomain.length < 3 || subdomain.length > 30) {
    fieldErrors.subdomain = "Subdomain must be 3-30 characters";
  } else if (!SUBDOMAIN_RE.test(subdomain)) {
    fieldErrors.subdomain = "Only lowercase letters, numbers, and hyphens allowed";
  } else if (subdomain.startsWith("-") || subdomain.endsWith("-")) {
    fieldErrors.subdomain = "Subdomain cannot start or end with hyphen";
  } else if (RESERVED.has(subdomain)) {
    fieldErrors.subdomain = `Subdomain "${subdomain}" is reserved`;
  }

  if (!adminEmail) {
    fieldErrors.adminEmail = "Admin email is required";
  } else if (!isValidEmail(adminEmail)) {
    fieldErrors.adminEmail = "Enter a valid email address";
  }

  if (
    studentCountRaw === "" ||
    studentCountRaw === null ||
    studentCountRaw === undefined ||
    String(studentCountRaw).trim() === ""
  ) {
    fieldErrors.studentCount = "Estimated student count is required";
  } else if (!Number.isFinite(studentCount) || !Number.isInteger(studentCount)) {
    fieldErrors.studentCount = "Student count must be a whole number";
  } else if (studentCount <= 0) {
    fieldErrors.studentCount = "Student count must be greater than 0";
  } else if (studentCount > 10000) {
    fieldErrors.studentCount = "Maximum 10,000 students";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { success: false, error: "Validation failed", fieldErrors },
      { status: 400 }
    );
  }

  // ---- Build FastAPI payload ----
  const fastApiPayload: Record<string, unknown> = {
    school_name: schoolName,
    subdomain: subdomain,
    admin_email: adminEmail,
    student_count: studentCount,
  };
  // Include optional only if present (backend treats as optional)
  if (adminName) fastApiPayload.admin_name = adminName;
  // phone not in Phase 1; omit

  // ---- Forward to FastAPI ----
  const targetUrl = buildTargetUrl(rawUrl);

  // Local mock: if target contains localhost, return mock success (dev without droplet)
  // Remove this block when always hitting live droplet; kept for local dev safety.
  const isLocalMock = targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");
  if (isLocalMock) {
    console.log(`[register-school] MOCK forward for ${subdomain} -> ${targetUrl} (localhost detected)`);
    // Simulate small delay then success
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json(
      {
        success: true,
        message: `Successfully provisioned ${subdomain}.resultapp.org for ${schoolName} (MOCK)`,
        deployed_url: `https://${subdomain}.resultapp.org`,
        domain: `${subdomain}.resultapp.org`,
        subdomain,
        school_name: schoolName,
        student_count: studentCount,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  let provisionRes: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // FastAPI may take ~30-60s

    console.log(`[register-school] Forwarding to FastAPI ${targetUrl} for subdomain=${subdomain} school=${schoolName} students=${studentCount}`);

    provisionRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify(fastApiPayload),
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeout);
  } catch (err) {
    console.error("[register-school] Failed to reach FastAPI:", err);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      {
        success: false,
        error: isAbort
          ? "Provisioning your school is taking longer than expected. Please check your email in a minute or contact support@resultapp.org."
          : "Could not reach provisioning service. Please try again or contact support@resultapp.org.",
      },
      { status: 502 }
    );
  }

  // Parse backend response
  const contentType = provisionRes.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  let data: unknown;
  try {
    data = isJson ? await provisionRes.json() : await provisionRes.text();
  } catch {
    console.error("[register-school] Failed to parse backend response");
    return NextResponse.json(
      { success: false, error: "Invalid response from provisioning service" },
      { status: 502 }
    );
  }

  // ---- Handle backend error statuses gracefully ----
  if (!provisionRes.ok) {
    const detail =
      (data as { detail?: unknown })?.detail ??
      (data as { message?: string })?.message ??
      (data as { error?: string })?.error ??
      (typeof data === "string" ? data : JSON.stringify(data));

    // FastAPI may return detail as string or array of validation errors
    const detailStr = Array.isArray(detail)
      ? (detail as Array<{ msg?: string; loc?: unknown }>)
          .map((d) => d.msg || JSON.stringify(d))
          .join("; ")
      : String(detail);

    console.error(`[register-school] Backend ${provisionRes.status}:`, detailStr);

    if (provisionRes.status === 409) {
      return NextResponse.json(
        {
          success: false,
          error: "Subdomain already exists",
          fieldErrors: { subdomain: "Subdomain already exists — please choose another." },
          details: detailStr,
        },
        { status: 409 }
      );
    }

    if (provisionRes.status === 400 || provisionRes.status === 422) {
      return NextResponse.json(
        { success: false, error: detailStr || "Invalid request", details: detailStr },
        { status: provisionRes.status }
      );
    }

    if (provisionRes.status === 401 || provisionRes.status === 403) {
      return NextResponse.json(
        {
          success: false,
          error: "Server configuration error (provisioning auth). Please contact support@resultapp.org.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: detailStr || "Provisioning failed. Please contact support.", raw: data },
      { status: provisionRes.status >= 400 && provisionRes.status < 600 ? provisionRes.status : 500 }
    );
  }

  // ---- Success ----
  const payload = data as {
    deployed_url?: string;
    url?: string;
    domain?: string;
    deployedUrl?: string;
    subdomain?: string;
    school_name?: string;
    student_count?: number;
    message?: string;
    timestamp?: string;
    provisioning_ms?: number;
    [k: string]: unknown;
  };

  const deployedUrl =
    payload.deployed_url || payload.deployedUrl || payload.url || `https://${subdomain}.resultapp.org`;
  const domain = payload.domain || `${subdomain}.resultapp.org`;

  console.log(`[register-school] Success: ${schoolName} -> ${deployedUrl}`);

  return NextResponse.json(
    {
      success: true,
      message:
        (payload.message as string) || `Successfully provisioned ${domain} for ${schoolName}`,
      deployed_url: deployedUrl,
      domain,
      subdomain: (payload.subdomain as string) || subdomain,
      school_name: (payload.school_name as string) || schoolName,
      student_count: (payload.student_count as number) ?? studentCount,
      timestamp: (payload.timestamp as string) || new Date().toISOString(),
      provisioning_ms: payload.provisioning_ms,
      backend: payload,
    },
    { status: 200 }
  );
}

// Health / config check
export async function GET() {
  const hasSecret = !!getProvisionSecret();
  const rawUrl = getProvisionUrl();
  return NextResponse.json({
    service: "register-school proxy (Phase 1)",
    target: buildTargetUrl(rawUrl),
    configured: hasSecret,
    backend_secret_set: hasSecret,
    provision_url_set: !!rawUrl,
    // fallback domain for preview
    base_domain: process.env.NEXT_PUBLIC_BASE_DOMAIN || "resultapp.org",
    timestamp: new Date().toISOString(),
  });
}
