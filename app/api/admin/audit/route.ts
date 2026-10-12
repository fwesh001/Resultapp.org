import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";

/**
 * GET /api/admin/audit?tenant_id={tenant}&limit=&offset=&action=&actor_type=
 *
 * Tenant audit trail, ADMIN ONLY.
 *
 * Moderators are deliberately locked out (capability: "audit"). The log is a
 * record of what the moderators did, so a moderator who can read it can see
 * exactly which of their actions have been noticed and which have not.
 *
 * Read-only, so no viewer headers are forwarded: the capability guard is the
 * whole story here. The WRITE paths (publish, roster, clearance, profile) carry
 * X-Viewer-* so the audit row can name who acted.
 */

function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

function getProxySecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = (searchParams.get("tenant_id") || "").toLowerCase().trim();

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });
  }

  // Admin-only. A moderator hitting this gets 403, not an empty list — silence
  // would look like "there is no audit of me yet", which is worse.
  const guard = await requireAdminCapability(tenantId, "audit");
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  // Whitelist the passthrough params rather than echoing the whole query: the
  // upstream route only understands these, and echoing junk would make a typo
  // look like a working filter that silently matches nothing.
  const limit = Math.min(Number(searchParams.get("limit")) || 25, 200);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
  const action = (searchParams.get("action") || "").slice(0, 40);
  const actorType = (searchParams.get("actor_type") || "").slice(0, 20);

  const upstream = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (action) upstream.set("action_prefix", action);
  if (actorType) upstream.set("actor_type", actorType);

  try {
    const res = await fetch(
      `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/audit-logs?${upstream.toString()}`,
      { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" },
    );

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: "Could not load the audit trail" },
        { status: res.status },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin audit proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the audit service. Try again." },
      { status: 502 },
    );
  }
}