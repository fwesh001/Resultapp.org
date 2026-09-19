import { NextRequest, NextResponse } from "next/server";

/**
 * Report Proxy — GET /api/report?tenant_id=&student_id=&term=Term 1
 * Forwards securely to FastAPI GET /api/v1/tenant/{tenant_id}/report/{student_id}?term=
 * Injects X-API-SECRET-KEY server-side. cache: no-store.
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

  const base = getBackendBase();
  const url = `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/report/${encodeURIComponent(studentId)}?term=${encodeURIComponent(term)}`;

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
