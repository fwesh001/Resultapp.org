import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";
import { viewerHeaders } from "@/lib/viewerHeaders";
import { upstreamMessage } from "../../../_lib";

/**
 * POST /api/admin/end-of-session/run/[runId]/apply
 *
 * THE DESTRUCTIVE CALL. Closes the cohort: reclassifies every active student,
 * releases graduation slots immediately, records withdrawal refunds against the
 * next session, and writes the audit row — all in one backend transaction.
 *
 * Deliberately takes no body. Everything it needs is on the stored run, which
 * is what makes a retry safe: applying run X twice cannot promote the cohort
 * twice, because the second call finds the run already 'applied' and returns
 * the stored outcome untouched.
 *
 * Re-authorised here even though the draft was authorised when it was created.
 * A run can sit in draft across a shift change, and the person pressing Apply
 * is not necessarily the person who drafted it.
 */
export async function POST(
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
    const viewer = (await viewerHeaders(tenantId)) ?? {};
    const res = await fetch(
      `${base}/api/v1/tenant/${encodeURIComponent(
        tenantId
      )}/end-of-session/run/${encodeURIComponent(runId)}/apply`,
      {
        method: "POST",
        // Forwarded so the backend audit row names the admin who pressed the
        // button, not whoever drafted the run.
        headers: { "X-API-SECRET-KEY": secret, ...viewer },
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
            "Could not apply the session close. Nothing was changed."
          ),
        },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error("[end-of-session apply proxy] fetch failed", e);
    return NextResponse.json(
      {
        success: false,
        error:
          "Could not reach the roster service. Nothing was changed — you can safely try again.",
      },
      { status: 502 }
    );
  }
}