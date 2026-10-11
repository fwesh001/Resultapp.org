import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, SESSION_COOKIES } from "@/lib/session";

/**
 * POST /api/student/login
 * Body: { tenantId, identifier, password }
 * Forwards to FastAPI POST /api/v1/tenant/{tenantId}/student/login
 * On success sets a signed httpOnly secure cookie `student_session`.
 *
 * This is the credential verifier AND the only place a student session is
 * minted. The backend deliberately does not decide who is logged in — it only
 * checks the password and hands back claims — so this proxy plus lib/studentAuth
 * are the entire authorization surface for student data.
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

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = String(
    (body.tenantId as string) || (body as Record<string, unknown>).tenant_id || "",
  )
    .toLowerCase()
    .trim();
  const identifier = String((body.identifier as string) || "").trim();
  const password = String((body.password as string) || "");

  if (!tenantId || !identifier || !password) {
    return NextResponse.json(
      { success: false, error: "Missing tenantId, identifier or password" },
      { status: 400 },
    );
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
  )}/student/login`;

  let backendRes: Response;
  try {
    backendRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify({ identifier, password }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[student login proxy] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach auth service" },
      { status: 502 },
    );
  }

  const data = await backendRes.json().catch(() => ({}));

  if (!backendRes.ok) {
    const detail =
      (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? "Login failed";
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
    return NextResponse.json({ success: false, error: msg }, { status: backendRes.status });
  }

  // Defense in depth: never let a future backend field become a session claim
  // (or a client-visible response field) by accident. Only these keys are kept.
  const student = (data as { student?: Record<string, unknown> }).student ?? {};
  const claims = {
    tenant_id: tenantId,
    student: {
      id: student.id,
      student_id: student.student_id,
      full_name: student.full_name,
      class_name: student.class_name,
      must_change_password: student.must_change_password === true,
    },
  };

  // `claims` is passed by reference and the signer adds iat/exp only to its own
  // copy, so the response body below cannot leak the signed token.
  try {
    await setSessionCookie(SESSION_COOKIES.student, claims as unknown as Record<string, unknown>);
  } catch (e) {
    console.error("[student login proxy] session signing failed", e);
    return NextResponse.json(
      { success: false, error: "Could not establish a secure session" },
      { status: 500 },
    );
  }

  // Echo only safe display fields. No password, no hash, no row UUID.
  return NextResponse.json(
    {
      success: true,
      tenant_id: tenantId,
      student: claims.student,
    },
    { status: 200 },
  );
}