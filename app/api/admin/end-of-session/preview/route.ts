import { NextRequest, NextResponse } from "next/server";
import { requireAdminCapability } from "@/lib/adminAuth";
import { upstreamMessage } from "../_lib";

/**
 * GET /api/admin/end-of-session/preview?tenant_id=&from_session=&to_session=
 *
 * Classify the cohort. Reads only — the backend takes no locks and writes
 * nothing, so this is safe to call repeatedly while the admin edits the map.
 *
 * Returns the DERIVED class progression alongside the counts, because the
 * derivation is a heuristic (N < P < J < SS, then numeric) and a school using
 * names like "Year 7" will get it wrong. The UI must render the map so it can
 * be corrected before anything is committed.
 */
export async function GET(req: NextRequest) {
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

  const sp = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  const from = sp.get("from_session");
  const to = sp.get("to_session");
  if (from) qs.set("from_session", from);
  if (to) qs.set("to_session", to);

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

  const backendUrl = `${base}/api/v1/tenant/${encodeURIComponent(
    tenantId
  )}/end-of-session/preview${qs.toString() ? `?${qs.toString()}` : ""}`;

  try {
    const res = await fetch(backendUrl, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: upstreamMessage(
            data as { detail?: unknown; error?: unknown },
            "Could not load the promotion preview"
          ),
        },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error("[end-of-session preview proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the roster service" },
      { status: 502 }
    );
  }
}