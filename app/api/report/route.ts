import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/adminAuth";

/**
 * Report Proxy — GET /api/report?tenant_id=&student_id=&term=Term 1
 * Forwards securely to FastAPI GET /api/v1/tenant/{tenant_id}/report/{student_id}?term=
 * Injects X-API-SECRET-KEY server-side. cache: no-store.
 *
 * Access scope (LEGAL_REMEDIATION.md P0 item 1)
 * ---------------------------------------------
 * This route backs the *public* result checker, so it must stay callable
 * without a session. It is therefore NOT guarded with requireAdminSession.
 *
 * Instead it computes a scope and lets the backend enforce it:
 *   - signed-in admin of THIS tenant -> include_draft=true (full draft bundle)
 *   - anyone else                   -> include_draft omitted
 *
 * The backend then returns 404 for an unpublished result to the public scope,
 * byte-identical to the 404 for an unknown student, so this endpoint cannot be
 * used to enumerate admission numbers. The proxy is trusted (server-side, it
 * injects the shared secret), so the flag is safe to send; the backend still
 * verifies publication itself rather than trusting the flag.
 *
 * This is a scope decision, never a client-supplied one: the flag is derived
 * from the httpOnly session cookie, never from a query parameter.
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

/** Admission numbers are prefix+number, e.g. vhs/005 or JSS1B12. */
const STUDENT_ID_RE = /^[A-Za-z0-9-]{1,30}\/?[A-Za-z0-9-]{0,30}$/;

/**
 * The single 404 shape for "not available to you".
 *
 * Unknown student, unpublished result and malformed admission number must be
 * indistinguishable, so they all render this exact body. Any divergence here
 * re-opens the enumeration oracle the backend gate closes.
 *
 * The `not_found` marker is a UI routing hint, not extra information: it says
 * "treat this as a withheld/absent result", letting the report card show a
 * public 'Not Available' state instead of falling through to its transport
 * error branch. It carries no signal about whether the student exists.
 */
function notFound() {
  return NextResponse.json(
    {
      success: false,
      error: "Report not found",
      not_found: true,
      raw: { detail: "Report not found" },
    },
    { status: 404 },
  );
}

export async function GET(req: NextRequest) {
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const tenantId = (
    searchParams.get("tenant_id") ||
    searchParams.get("tenantId") ||
    searchParams.get("tenant") ||
    ""
  )
    .toLowerCase()
    .trim();
  const rawStudentId = (searchParams.get("student_id") || searchParams.get("studentId") || "").trim();
  // Normalize prefix to lower case (vhs/005 not VHS/005)
  const studentId = (() => {
    const s = rawStudentId;
    const idx = s.indexOf("/");
    if (idx > -1) return s.slice(0, idx).toLowerCase() + s.slice(idx);
    const m = s.match(/^([A-Za-z]+)(.*)$/);
    if (m) return m[1].toLowerCase() + m[2];
    return s.toLowerCase();
  })();
  const term = (searchParams.get("term") || "Term 1").trim() || "Term 1";

  if (!tenantId || !studentId) {
    return NextResponse.json(
      { success: false, error: "Missing required query: tenant_id and student_id" },
      { status: 400 },
    );
  }

  // Reject malformed admission numbers before they reach the backend so a
  // junk id cannot be used to probe query behaviour.
  if (!STUDENT_ID_RE.test(studentId)) {
    return notFound();
  }

  // Scope: admin of this tenant gets the draft; everyone else gets the
  // published-only view. Falls back to public scope on any error.
  const isAdmin = await hasAdminSession(tenantId);

  const base = getBackendBase();
  // Preserve slash for backend :path param — encode segments individually so vhs/004 stays vhs/004 not vhs%2F004
  const encodedStudentPath = studentId.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  const params = new URLSearchParams({ term });
  if (isAdmin) params.set("include_draft", "true");
  const url = `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/report/${encodedStudentPath}?${params.toString()}`;

  try {
    const r = await fetch(url, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const text = await r.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!r.ok) {
      // Collapse every 404 from the backend to one indistinguishable body, so
      // an unpublished result cannot be told apart from an unknown student.
      if (r.status === 404) {
        return notFound();
      }
      const detail =
        (data as { detail?: unknown })?.detail ??
        (data as { error?: unknown })?.error ??
        text;
      const msg = Array.isArray(detail)
        ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
        : String(detail);
      return NextResponse.json({ success: false, error: msg, raw: data }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[report proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach report service. Try again." },
      { status: 502 },
    );
  }
}
