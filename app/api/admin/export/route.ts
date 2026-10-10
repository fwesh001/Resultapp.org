import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * Data Export Tool proxy.
 *
 * POST /api/admin/export  body: { tenantId, datasets[], students{}, results{}, className? }
 *
 * WHY THIS ROUTE IS THE SECURITY BOUNDARY
 * --------------------------------------
 * The FastAPI backend only ever sees the shared X-API-SECRET-KEY — it has no
 * notion of "which admin". If this proxy forwarded the call without first
 * verifying a signed `admin_session` cookie for the SAME tenant, then anyone
 * holding the (server-side) secret path could export any school's roster,
 * including minors' names and fee-clearance status. `requireAdminSession` is
 * HMAC-verified and tenant-scoped (lib/adminAuth.ts), so it is the only thing
 * standing between the public internet and another school's data.
 *
 * WHY THE BODY IS STREAMED, NOT BUFFERED
 * --------------------------------------
 * The upstream response IS a file. We forward `res.body` as a stream instead of
 * awaiting `res.arrayBuffer()`, so a large workbook never sits in the proxy's
 * heap on its way to the browser. We copy Content-Length through verbatim:
 * without it the browser cannot compute a real download percentage and the
 * progress bar would have to be faked.
 */

function getProxySecret(): string {
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

const XLSX_MEDIA =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function POST(req: NextRequest) {
  let body: {
    tenantId?: string;
    datasets?: string[];
    students?: Record<string, string>;
    results?: Record<string, string>;
    className?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const tenantId = (body.tenantId || "").toLowerCase().trim();
  const guard = await requireAdminSession(tenantId);
  if (guard) return guard;

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  // Forward only the fields the backend understands. Datasets are validated
  // again server-side; this copy is not a trust boundary, it just avoids
  // sending arbitrary junk upstream.
  const datasets = Array.isArray(body.datasets)
    ? body.datasets.filter((d) => typeof d === "string").slice(0, 12)
    : [];

  const payload = {
    datasets,
    students: body.students ?? {},
    results: body.results ?? {},
    class_name: body.className ?? null,
  };

  try {
    const upstream = await fetch(
      `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/export/xlsx`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-SECRET-KEY": secret,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      },
    );

    if (!upstream.ok || !upstream.body) {
      // Error path is JSON; surface the backend's own message so the modal
      // can explain *why* (throttled, too large, bad filter) rather than
      // showing a generic failure.
      const data = await upstream.json().catch(() => ({}));
      const detail =
        (data as { detail?: string })?.detail ??
        (data as { error?: string })?.error ??
        `Export failed (${upstream.status})`;
      return NextResponse.json(
        { success: false, error: String(detail) },
        {
          status: upstream.status || 502,
          headers: upstream.headers.get("retry-after")
            ? { "Retry-After": upstream.headers.get("retry-after") as string }
            : undefined,
        },
      );
    }

    // Pass the workbook through as a stream, preserving the headers the
    // client needs: the filename, the real byte length, and the sheet list.
    const headers = new Headers();
    headers.set("Content-Type", XLSX_MEDIA);
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    const disp = upstream.headers.get("content-disposition");
    if (disp) headers.set("Content-Disposition", disp);
    const sheets = upstream.headers.get("x-export-sheets");
    if (sheets) headers.set("X-Export-Sheets", sheets);
    headers.set("Cache-Control", "no-store");

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    console.error("[admin export] upstream fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the export service" },
      { status: 502 },
    );
  }
}