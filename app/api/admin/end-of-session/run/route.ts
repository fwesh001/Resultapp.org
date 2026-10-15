import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";
import { viewerHeaders } from "@/lib/viewerHeaders";
import { upstreamMessage } from "../_lib";

/**
 * POST /api/admin/end-of-session/run
 * Body: { tenant_id, from_session, to_session, decisions[], class_map? }
 *
 * Store the operator's confirmed plan as a draft. Writes nothing to the roster
 * and moves no money — the apply call is separate and deliberate.
 *
 * `class_map` is the admin's override of the derived progression, including
 * explicit nulls for a terminal class. It is forwarded verbatim because the
 * backend, not the browser, decides what a class mapping means.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const tenantId = String(body.tenant_id || "").toLowerCase().trim();
  if (!tenantId) {
    return NextResponse.json(
      { success: false, error: "Missing tenant_id" },
      { status: 400 }
    );
  }

  const guard = await requireAdminCapability(tenantId, "end-of-session");
  if (guard) return guard;

  // Shape-checked here so a malformed payload is a clear 400 from the proxy
  // rather than a FastAPI 422 with a list-shaped `detail` the UI has to render.
  const from = String(body.from_session || "").trim();
  const to = String(body.to_session || "").trim();
  if (!from || !to) {
    return NextResponse.json(
      { success: false, error: "from_session and to_session are required" },
      { status: 400 }
    );
  }
  if (from === to) {
    return NextResponse.json(
      { success: false, error: "from_session and to_session must differ" },
      { status: 400 }
    );
  }
  const decisions = body.decisions;
  if (!Array.isArray(decisions)) {
    return NextResponse.json(
      { success: false, error: "decisions must be an array" },
      { status: 400 }
    );
  }

  const secret =
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    "";
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 }
    );
  }

  const base = (
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000"
  ).replace(/\/$/, "");

  try {
    const viewer = (await viewerHeaders(tenantId)) ?? {};
    const res = await fetch(
      `${base}/api/v1/tenant/${encodeURIComponent(tenantId)}/end-of-session/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-SECRET-KEY": secret,
          ...viewer,
        },
        body: JSON.stringify({
          from_session: from,
          to_session: to,
          decisions,
          class_map: body.class_map ?? undefined,
          // The actor is read from the VERIFIED session, never from the body.
          // A caller must not be able to attribute a cohort close to somebody
          // else in the audit trail.
          actor: viewer["X-Viewer-Label"] || viewer["X-Viewer-Id"] || "tenant_admin",
          actor_id: viewer["X-Viewer-Id"] || undefined,
          x_viewer_role: viewer["X-Viewer-Role"] || undefined,
        }),
        cache: "no-store",
      }
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: upstreamMessage(
            data as { detail?: unknown; error?: unknown },
            "Could not create the session close plan"
          ),
        },
        { status: res.status }
      );
    }
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    console.error("[end-of-session run proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the roster service" },
      { status: 502 }
    );
  }
}