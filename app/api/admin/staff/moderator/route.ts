import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";
import { viewerHeaders } from "@/lib/viewerHeaders";

/**
 * PATCH /api/admin/staff/moderator
 * Body: { subdomain, staff_id, is_moderator }
 *
 * THE ESCALATION BOUNDARY.
 *
 * This is the one endpoint in the admin portal that changes what somebody is
 * allowed to do. A moderator who could call it could promote themselves to
 * admin, and every other capability guard would then be correct-but-irrelevant.
 *
 * So the check is the `moderators` capability — taken from the signed session —
 * and never `role === "admin"`. A capability is a statement about what this
 * specific session was granted; a role string is a guess about who they are.
 * The distinction matters the day a third role exists.
 *
 * `viewerHeaders` is forwarded so the audit row names the admin who did it
 * rather than a hardcoded "tenant_admin".
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

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = String(body.subdomain ?? body.tenant_id ?? "").toLowerCase().trim();
  const staffId = String(body.staff_id ?? "").trim();

  if (!tenantId || !staffId || typeof body.is_moderator !== "boolean") {
    return NextResponse.json(
      { success: false, error: "Missing subdomain, staff_id or is_moderator" },
      { status: 400 },
    );
  }

  const guard = await requireAdminCapability(tenantId, "moderators");
  if (guard) return guard;

  // The guard above already proved an identity exists, so a null here means the
  // session vanished between the two reads. Forward an explicit "unknown"
  // rather than dropping the headers: an audit row that names nobody is worse
  // than one that admits it does not know.
  const viewer = (await viewerHeaders(tenantId)) ?? {
    "X-Viewer-Role": "unknown",
    "X-Viewer-Id": "",
    "X-Viewer-Label": "unknown",
  };

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/roster/staff/moderator`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-API-SECRET-KEY": secret,
          ...viewer,
        },
        body: JSON.stringify({
          subdomain: tenantId,
          staff_id: staffId,
          is_moderator: body.is_moderator,
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
      // Surface the upstream reason (last-admin floor, cross-tenant refusal)
      // rather than a generic 500 — the UI needs to explain WHY.
      const detail =
        (data as { detail?: string })?.detail ||
        (data as { error?: string })?.error ||
        "Could not update the staff member";
      return NextResponse.json({ success: false, error: detail }, { status: res.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[admin moderator proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the staff service. Try again." },
      { status: 502 },
    );
  }
}
