import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 2 – Records Proxy (Student Report Card)
 * GET /api/records?tenant_id=vhs&student_id=STU001&term=Term 1
 *
 * Proxies to FastAPI:
 *   GET http://159.223.178.34:8000/api/v1/records/academic/{tenant_id}/{student_id}
 *   GET http://159.223.178.34:8000/api/v1/records/behavioral/{tenant_id}/{student_id}
 * Then filters by term (client term handling per decision 4).
 * Auth: X-API-SECRET-KEY = BACKEND_API_SECRET || PROVISION_API_SECRET || API_SECRET_KEY
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

export async function GET(req: NextRequest) {
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const tenant_id = (
    searchParams.get("tenant_id") ||
    searchParams.get("tenantId") ||
    searchParams.get("tenant") ||
    ""
  )
    .toLowerCase()
    .trim();
  const student_id = (searchParams.get("student_id") || searchParams.get("studentId") || "").trim();
  const term = (searchParams.get("term") || "").trim();

  if (!tenant_id || !student_id) {
    return NextResponse.json(
      { success: false, error: "Missing required query: tenant_id and student_id" },
      { status: 400 }
    );
  }

  const base = getBackendBase();
  const academicUrl = `${base}/api/v1/records/academic/${encodeURIComponent(tenant_id)}/${encodeURIComponent(student_id)}`;
  const behavioralUrl = `${base}/api/v1/records/behavioral/${encodeURIComponent(tenant_id)}/${encodeURIComponent(student_id)}`;
  const headers = { "X-API-SECRET-KEY": secret };

  try {
    const [acRes, beRes] = await Promise.all([
      fetch(academicUrl, { headers, cache: "no-store" }),
      fetch(behavioralUrl, { headers, cache: "no-store" }),
    ]);

    let academic: unknown = [];
    let behavioral: unknown = [];

    if (acRes.ok) {
      try {
        academic = await acRes.json();
      } catch {
        academic = [];
      }
    } else if (acRes.status !== 404) {
      const text = await acRes.text().catch(() => "");
      console.warn(`[records proxy] academic fetch ${acRes.status}: ${text}`);
    }

    if (beRes.ok) {
      try {
        behavioral = await beRes.json();
      } catch {
        behavioral = [];
      }
    } else if (beRes.status !== 404) {
      const text = await beRes.text().catch(() => "");
      console.warn(`[records proxy] behavioral fetch ${beRes.status}: ${text}`);
    }

    // Ensure arrays
    const academicArr = Array.isArray(academic) ? academic : [];
    const behavioralArr = Array.isArray(behavioral) ? behavioral : [];

    // Filter by term case-insensitive if term provided
    const termLower = term.toLowerCase();
    const academicFiltered = term
      ? academicArr.filter((r: { term?: string }) => (r.term || "").toLowerCase() === termLower)
      : academicArr;
    const behavioralFiltered = term
      ? behavioralArr.filter((r: { term?: string }) => (r.term || "").toLowerCase() === termLower)
      : behavioralArr;

    return NextResponse.json(
      {
        success: true,
        tenant_id,
        student_id,
        term: term || null,
        academic: academicFiltered,
        behavioral: behavioralFiltered,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("[records proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach grading engine. Try again." },
      { status: 502 }
    );
  }
}
