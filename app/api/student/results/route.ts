import { NextRequest, NextResponse } from "next/server";
import { requireStudentSession, readStudentSession } from "@/lib/studentAuth";

/**
 * GET /api/student/results?tenant_id={tenant}
 *
 * Returns the signed-in student's published-result history.
 *
 * The student_id is taken from the session cookie, NOT from the query string.
 * A student who asks for ?student_id=STD002 gets their OWN history — ignoring
 * the parameter entirely — because the whole point of the endpoint is that it
 * cannot be pointed at another child.
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenant = (
    searchParams.get("tenant_id") || searchParams.get("tenantId") || searchParams.get("tenant") || ""
  )
    .toLowerCase()
    .trim();

  if (!tenant) {
    return NextResponse.json({ success: false, error: "Missing tenant" }, { status: 400 });
  }

  const guard = await requireStudentSession(tenant);
  if (guard) return guard;

  const identity = await readStudentSession(tenant);
  if (!identity) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const backendUrl =
    `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenant)}/student/results` +
    `?student_id=${encodeURIComponent(identity.studentId)}`;

  try {
    const backendRes = await fetch(backendUrl, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });

    const data = await backendRes.json().catch(() => ({}));

    if (!backendRes.ok) {
      const detail =
        (data as { detail?: unknown })?.detail ??
        (data as { error?: unknown })?.error ??
        "Could not load results";
      const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
      return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[student results proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach auth service" },
      { status: 502 },
    );
  }
}