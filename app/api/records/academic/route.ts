import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 2 – Academic Records Proxy
 * POST /api/records/academic
 *
 * Forwards to FastAPI http://159.223.178.34:8000/api/v1/records/academic
 * with X-API-SECRET-KEY = BACKEND_API_SECRET || PROVISION_API_SECRET || API_SECRET_KEY
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

export async function POST(req: NextRequest) {
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const url = `${getBackendBase()}/api/v1/records/academic`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify(body),
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
      return NextResponse.json(
        { success: false, error: msg, detail, raw: data },
        { status: r.status }
      );
    }

    return NextResponse.json(data, { status: r.status });
  } catch (e) {
    console.error("[records/academic proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach grading engine. Try again." },
      { status: 502 }
    );
  }
}
