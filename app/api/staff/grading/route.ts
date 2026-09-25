import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Staff Grading Proxy — /api/staff/grading (GET + POST)
 *
 * Session guard: reads the httpOnly `staff_session` cookie set at login and
 * only forwards when the session's tenant matches the requested tenant.
 * Injects X-API-SECRET-KEY server-side; the secret never reaches the browser.
 *
 * GET modes:
 *  - Hub mode (no class/subject): ?tenant_id=&tenantId — returns { allocations, template }
 *    by fan-out to /staff/{staffId}/dashboard + /templates/{tenantId} in parallel.
 *  - Bundle mode: ?tenant_id=&class_name=&subject_name=&term=Term 1 — forwards to
 *    /api/v1/tenant/{tenant_id}/staff/grading/{class}/{subject}?term=
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

async function getSessionDetails(): Promise<{ tenant: string; staffId: string } | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("staff_session")?.value;
    if (!raw) return null;
    const session = JSON.parse(raw) as StaffSession;
    const tenant = String(session?.tenant_id || "").toLowerCase().trim();
    const staffId = String(session?.staff?.staff_id || session?.staff?.id || "").trim();
    if (!tenant || !staffId || !session?.staff) return null;
    return { tenant, staffId };
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
  const session = await getSessionDetails();
  if (!session) return unauthorized();

  const params = req.nextUrl.searchParams;
  // Hub mode may omit tenant_id -> fallback to session tenant
  let tenantId = String(params.get("tenant_id") ?? params.get("tenantId") ?? "")
    .toLowerCase()
    .trim();
  if (!tenantId) tenantId = session.tenant;
  const className = String(params.get("class_name") ?? "").trim();
  const subjectName = String(params.get("subject_name") ?? "").trim();
  const term = String(params.get("term") ?? "Term 1").trim();

  if (tenantId !== session.tenant) {
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

  const base = getBackendBase();

  // Form mode (explicit): ?view=form&class_name= — checked before hub mode
  // since form requests carry no subject_name.
  const view = String(params.get("view") ?? "").trim().toLowerCase();
  if (view === "form") {
    if (!className) {
      return NextResponse.json(
        { success: false, error: "view=form requires class_name" },
        { status: 400 },
      );
    }
    const formUrl =
      `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/forms/` +
      `${encodeURIComponent(className)}?term=${encodeURIComponent(term)}` +
      `&staff_id=${encodeURIComponent(session.staffId)}`;
    try {
      const fr = await fetch(formUrl, {
        headers: { "X-API-SECRET-KEY": secret },
        cache: "no-store",
      });
      const fdata = await fr.json().catch(() => ({}));
      if (!fr.ok) {
        const detail = (fdata as { detail?: unknown })?.detail ?? "Form grid failed";
        return NextResponse.json({ success: false, error: String(detail) }, { status: fr.status });
      }
      return NextResponse.json(fdata, { status: 200 });
    } catch (e) {
      console.error("[api/staff/grading GET form] backend fetch failed", e);
      return NextResponse.json(
        { success: false, error: "Could not reach grading service" },
        { status: 502 },
      );
    }
  }

  // Hub mode: no class/subject -> allocations + active template
  if (!className || !subjectName) {
    const dashboardUrl = `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/${encodeURIComponent(session.staffId)}/dashboard`;
    const templatesUrl = `${base}/api/v1/templates/${encodeURIComponent(tenantId)}`;

    let dashboardRes: Response;
    let templatesRes: Response;
    try {
      [dashboardRes, templatesRes] = await Promise.all([
        fetch(dashboardUrl, {
          headers: { "X-API-SECRET-KEY": secret },
          cache: "no-store",
        }),
        fetch(templatesUrl, {
          headers: { "X-API-SECRET-KEY": secret },
          cache: "no-store",
        }),
      ]);
    } catch (e) {
      console.error("[api/staff/grading GET hub] backend fetch failed", e);
      return NextResponse.json(
        { success: false, error: "Could not reach grading service" },
        { status: 502 },
      );
    }

    const dashText = await dashboardRes.text();
    const tmplText = await templatesRes.text();
    let dashData: unknown;
    let tmplData: unknown;
    try {
      dashData = JSON.parse(dashText);
    } catch {
      dashData = { raw: dashText };
    }
    try {
      tmplData = JSON.parse(tmplText);
    } catch {
      tmplData = { raw: tmplText };
    }

    if (!dashboardRes.ok) return backendError(dashData, dashText, dashboardRes.status);
    // Templates: allow empty array (no template) -> return null instead of error; but bubble real errors
    if (!templatesRes.ok) {
      // If 404 / empty, treat as no template
      const isNotFound = templatesRes.status === 404;
      if (!isNotFound) return backendError(tmplData, tmplText, templatesRes.status);
    }

    const allocations = (dashData as { allocations?: unknown })?.allocations ?? [];
    const formClasses = (dashData as { form_classes?: unknown })?.form_classes ?? [];
    // Backend list_templates returns array directly
    let template: unknown = null;
    if (Array.isArray(tmplData)) {
      template = tmplData.length > 0 ? tmplData[0] : null;
    } else if (tmplData && typeof tmplData === "object" && Array.isArray((tmplData as { data?: unknown }).data)) {
      const arr = (tmplData as { data: unknown[] }).data;
      template = arr.length > 0 ? arr[0] : null;
    } else if (tmplData && typeof tmplData === "object") {
      // Single object case
      template = tmplData;
      // If it's an error wrapper without array, null out if it looks like error
      if ((template as { detail?: unknown }).detail && !Array.isArray(template)) {
        template = null;
      }
    }

    return NextResponse.json(
      {
        allocations,
        form_classes: formClasses,
        template,
        tenant_id: tenantId,
      },
      { status: 200 },
    );
  }

  // Bundle mode: class + subject present
  if (!tenantId || !className || !subjectName) {
    return NextResponse.json(
      { success: false, error: "Missing tenant_id, class_name or subject_name" },
      { status: 400 },
    );
  }

  // Forward session staff identity so the backend can compute
  // can_grade_academic / can_grade_traits capability flags.
  const url =
    `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/grading` +
    `/${encodeURIComponent(className)}/${encodeURIComponent(subjectName)}` +
    `?term=${encodeURIComponent(term)}&staff_id=${encodeURIComponent(session.staffId)}`;

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
  const session = await getSessionDetails();
  if (!session) return unauthorized();

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
  if (tenantId !== session.tenant) {
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

  // Inject caller identity server-side (client-supplied staff_id is ignored
  // by the backend contract — session is the source of truth).
  const { staff_id: _clientStaffId, ...restBody } = body;
  void _clientStaffId;
  let backendRes: Response;
  try {
    backendRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify({ ...restBody, tenant_id: tenantId, staff_id: session.staffId }),
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
