import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";

/**
 * POST /api/admin/allocations/reset-password
 * Body: { tenant_id?, type: "student" | "staff", id }
 *
 * Puts a roster member's password back to the shared default and re-arms
 * their must_change_password flag, so the portal banner comes back for them.
 *
 * Capability gate is `allocations`, not a bare session check, to match the page
 * that renders the menu (AllocationsSection calls enforceAdminCapability).
 * A moderator holds `allocations`, so they can reset — deliberately, since
 * resetting a colleague's PIN at the staff room door is exactly the task a
 * deputy is trusted with.
 *
 * Nothing credential-shaped crosses this hop in either direction: the caller
 * sends a record id, never a password, and the response carries the known
 * default so the admin can read it out. The upstream route is the only thing
 * that ever touches password_hash.
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

function resolveTenantId(req: NextRequest, body?: Record<string, unknown>): string {
  const urlTenant =
    req.nextUrl.searchParams.get("tenant_id") ||
    req.nextUrl.searchParams.get("tenantId") ||
    "";
  const bodyTenant = (body?.tenant_id as string) || "";
  if (urlTenant) return urlTenant.toLowerCase().trim();
  if (bodyTenant) return String(bodyTenant).toLowerCase().trim();
  const host = req.headers.get("host") || "";
  const sub = host.split(":")[0].split(".")[0];
  if (sub && sub !== "www" && sub !== "localhost" && host.split(".").length > 2) {
    return sub.toLowerCase().trim();
  }
  return "";
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = resolveTenantId(req, body);
  if (!tenantId) {
    return NextResponse.json({ success: false, error: "Missing tenant_id" }, { status: 400 });
  }

  const guard = await requireAdminCapability(tenantId, "allocations");
  if (guard) return guard;

  const type = String((body.type as string) || "").trim();
  const id = String((body.id as string) || "").trim();

  if (type !== "student" && type !== "staff") {
    return NextResponse.json(
      { success: false, error: "type must be student or staff" },
      { status: 400 },
    );
  }
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing record id" }, { status: 400 });
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const backendUrl = `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(
    tenantId,
  )}/roster/${encodeURIComponent(type)}/${encodeURIComponent(id)}/reset-password`;

  try {
    const backendRes = await fetch(backendUrl, {
      method: "POST",
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });

    const data = (await backendRes.json().catch(() => ({}))) as {
      detail?: unknown;
      error?: unknown;
      password?: string;
    };

    if (!backendRes.ok) {
      const detail = data.detail ?? data.error ?? "Password reset failed";
      const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
      return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
    }

    return NextResponse.json({ success: true, password: data.password ?? "" });
  } catch (e) {
    console.error("[allocations reset-password proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the roster service" },
      { status: 502 },
    );
  }
}
