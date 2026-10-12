import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";

/**
 * GET /api/admin/staff?tenant_id={tenant}
 *
 * Staff roster for the Moderator Management screen.
 *
 * Guarded on `moderators`, not on `settings`. Listing the roster is harmless,
 * but this endpoint exists to drive the promote/demote controls, and the only
 * thing that keeps those honest is that the screen they live on is behind the
 * same capability as the mutation behind them.
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

  const guard = await requireAdminCapability(tenantId, "moderators");
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/roster/staff`,
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
        { success: false, error: "Could not load the staff roster" },
        { status: res.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin staff proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the staff service. Try again." },
      { status: 502 },
    );
  }
}
