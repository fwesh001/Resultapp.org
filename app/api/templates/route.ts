import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 2 – Template Proxy
 * POST /api/templates
 * GET  /api/templates?tenant_id=vhs   (or ?tenantId)
 *
 * Server-only proxy to FastAPI:
 *   POST http://159.223.178.34:8000/api/v1/templates
 *   GET  http://159.223.178.34:8000/api/v1/templates/{tenant_id}
 *
 * Auth: X-API-SECRET-KEY = BACKEND_API_SECRET || PROVISION_API_SECRET || API_SECRET_KEY
 * tenant_id injected from body/query or host subdomain — not client-editable beyond prop.
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

function buildUrl(path: string): string {
  const base = getBackendBase();
  // if base already contains /api/v1, keep; else append
  if (path.startsWith("http")) return path;
  if (base.includes("/api/v1")) return `${base}${path.replace("/api/v1", "")}`;
  return `${base}${path}`;
}

// ---------------------------------------------------------------------------
// POST – create template
// ---------------------------------------------------------------------------
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

  const payload = body as Record<string, unknown>;
  // Inject tenant_id if missing — try body, header, host
  let tenantId = (payload.tenant_id as string) || (payload.tenantId as string) || "";
  if (!tenantId) {
    const host = req.headers.get("host") || "";
    const sub = host.split(":")[0].split(".")[0];
    if (sub && sub !== "www" && sub !== "localhost" && host.split(".").length > 2) {
      tenantId = sub;
    }
  }
  if (tenantId) {
    (payload as Record<string, unknown>).tenant_id = tenantId.toLowerCase().trim();
  }

  const url = buildUrl("/api/v1/templates");
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify(payload),
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
        ? (detail as Array<{ msg?: string }>).map((d) => d.msg).join("; ")
        : String(detail);
      return NextResponse.json(
        { success: false, error: msg, detail, raw: data },
        { status: r.status }
      );
    }

    return NextResponse.json(data, { status: r.status });
  } catch (e) {
    console.error("[templates proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach grading engine. Try again." },
      { status: 502 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET – list templates for tenant
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  let tenantId =
    searchParams.get("tenant_id") || searchParams.get("tenantId") || searchParams.get("subdomain") || "";
  if (!tenantId) {
    const host = req.headers.get("host") || "";
    const sub = host.split(":")[0].split(".")[0];
    if (sub && host.split(".").length > 2) tenantId = sub;
  }
  if (!tenantId) {
    return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });
  }
  tenantId = tenantId.toLowerCase().trim();
  const url = buildUrl(`/api/v1/templates/${encodeURIComponent(tenantId)}`);
  try {
    const r = await fetch(url, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: (data as { detail?: string })?.detail || "Failed to fetch" }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[templates proxy GET] failed", e);
    return NextResponse.json({ success: false, error: "Could not reach backend" }, { status: 502 });
  }
}
