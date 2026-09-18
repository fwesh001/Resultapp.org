import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Staff Grading Proxy — /api/staff/grading (GET + POST)
 *
 * Session guard: reads the httpOnly `staff_session` cookie set at login and
 * only forwards when the session's tenant matches the requested tenant.
 * Injects X-API-SECRET-KEY server-side; the secret never reaches the browser.
 *
 * GET  ?tenant_id=&class_name=&subject_name=&term=Term 1
 * POST { tenant_id, term, subject_name, class_name, assessment_key, scores }
 */

function getSecret(): string {
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

interface StaffSession {
  staff?: { id?: string; staff_id?: string };
  tenant_id?: string;
}

async function getSessionTenant(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("staff_session")?.value;
    if (!raw) return null;
    const session = JSON.parse(raw) as StaffSession;
    const tenant = String(session?.tenant_id || "").toLowerCase().trim();
    if (!tenant || !session?.staff) return null;
    return tenant;
  } catch {
    return null;
  }
}

function unauthorized() {
  return NextResponse.json(
    { success: false, error: "Unauthorized — please sign in again" },
    { status: 401 },
  );
}

function backendError(data: unknown, text: string, status: number) {
  const detail =
    (data as { detail?: unknown })?.detail ??
    (data as { error?: unknown })?.error ??
    text;
  const msg = Array.isArray(detail)
    ? (detail as Array<{ msg?: string }>)
        .map((d) => d.msg || JSON.stringify(d))
        .join("; ")
    : String(detail);
  return NextResponse.json(
    { success: false, error: msg, raw: data },
    { status },
  );
}

export async function GET(req: NextRequest) {
  const sessionTenant = await getSessionTenant();
  if (!sessionTenant) return unauthorized();

  const params = req.nextUrl.searchParams;
  const tenantId = String(
    params.get("tenant_id") ?? params.get("tenantId") ?? "",
  )
    .toLowerCase()
    .trim();
  const className = String(params.get("class_name") ?? "").trim();
  const subjectName = String(params.get("subject_name") ?? "").trim();
  const term = String(params.get("term") ?? "Term 1").trim();

  if (!tenantId || !className || !subjectName) {
    return NextResponse.json(
      { success: false, error: "Missing tenant_id, class_name or subject_name" },
      { status: 400 },
    );
  }
  if (tenantId !== sessionTenant) {
    return NextResponse.json(
      { success: false, error: "Session does not belong to this school" },
      { status: 403 },
    );
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const url =
    `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/grading` +
    `/${encodeURIComponent(className)}/${encodeURIComponent(subjectName)}` +
    `?term=${encodeURIComponent(term)}`;

  let backendRes: Response;
  try {
    backendRes = await fetch(url, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
  } catch (e) {
    console.error("[api/staff/grading GET] backend fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach grading service" },
      { status: 502 },
    );
  }

  const text = await backendRes.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!backendRes.ok) return backendError(data, text, backendRes.status);
  return NextResponse.json(data, { status: 200 });
}

export async function POST(req: NextRequest) {
  const sessionTenant = await getSessionTenant();
  if (!sessionTenant) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const tenantId = String(body.tenant_id ?? body.tenantId ?? "")
    .toLowerCase()
    .trim();
  if (!tenantId) {
    return NextResponse.json(
      { success: false, error: "Missing tenant_id" },
      { status: 400 },
    );
  }
  if (tenantId !== sessionTenant) {
    return NextResponse.json(
      { success: false, error: "Session does not belong to this school" },
      { status: 403 },
    );
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const url = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/grading/batch`;

  let backendRes: Response;
  try {
    backendRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify({ ...body, tenant_id: tenantId }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[api/staff/grading POST] backend fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach grading service" },
      { status: 502 },
    );
  }

  const text = await backendRes.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!backendRes.ok) return backendError(data, text, backendRes.status);
  return NextResponse.json(data, { status: 200 });
}
