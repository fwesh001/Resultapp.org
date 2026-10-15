import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";
import { upstreamMessage } from "../../_lib";

/**
 * GET /api/admin/end-of-session/run/[runId]?tenant_id=
 *
 * Inspect a run: its status, the stored plan, and what applying it did.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ runId: string }> }
) {
  const tenantId = (req.nextUrl.searchParams.get("tenant_id") || "")
    .toLowerCase()
    .trim();
  if (!tenantId) {
    return NextResponse.json(
      { success: false, error: "Missing tenant_id" },
      { status: 400 }
    );
  }

  const guard = await requireAdminCapability(tenantId, "promotion");
  if (guard) return guard;

  const { runId } = await ctx.params;

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
    const res = await fetch(
      `${base}/api/v1/tenant/${encodeURIComponent(
        tenantId
      )}/end-of-session/run/${encodeURIComponent(runId)}`,
      { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" }
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: upstreamMessage(
            data as { detail?: unknown; error?: unknown },
            "Could not load that run"
          ),
        },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error("[end-of-session get run proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the roster service" },
      { status: 502 }
    );
  }
}