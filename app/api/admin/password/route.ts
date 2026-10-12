import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";
import { viewerHeaders } from "@/lib/viewerHeaders";

/**
 * POST /api/admin/password
 * Body: { subdomain, current_password, new_password }
 *
 * Guarded on `settings`, which moderators do not hold: a deputy is not the
 * credential holder, and letting them rotate the school's admin password would
 * be an escalation path that does not go through the Moderator Management
 * screen at all.
 *
 * The current password is verified server-side. This proxy never inspects it —
 * it only checks that one was supplied, so an obviously-malformed request
 * fails here instead of costing a bcrypt round trip.
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

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = String(body.subdomain ?? body.tenant_id ?? "").toLowerCase().trim();
  const current = String(body.current_password ?? "");
  const next = String(body.new_password ?? "");

  if (!tenantId || !current || !next) {
    return NextResponse.json(
      { success: false, error: "Missing subdomain, current_password or new_password" },
      { status: 400 },
    );
  }

  const guard = await requireAdminCapability(tenantId, "settings");
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const viewer = (await viewerHeaders(tenantId)) ?? {
    "X-Viewer-Role": "unknown",
    "X-Viewer-Id": "",
    "X-Viewer-Label": "unknown",
  };

  try {
    const res = await fetch(
      `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-SECRET-KEY": secret,
          ...viewer,
        },
        body: JSON.stringify({
          subdomain: tenantId,
          current_password: current,
          new_password: next,
        }),
        cache: "no-store",
      },
    );

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const detail =
        (data as { detail?: string })?.detail ||
        (data as { error?: string })?.error ||
        "Could not change the password";
      return NextResponse.json({ success: false, error: detail }, { status: res.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin password proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the auth service. Try again." },
      { status: 502 },
    );
  }
}
