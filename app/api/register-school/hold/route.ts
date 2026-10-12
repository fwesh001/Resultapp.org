import { NextRequest, NextResponse } from "next/server";
import { holdRegistration, type PendingPayload } from "@/lib/pendingRegistrations";

/**
 * POST /api/register-school/hold
 *
 * Parks a registration server-side and returns the tx_ref the checkout must
 * use. Called before Flutterwave opens so a webhook can finish provisioning if
 * the browser callback never arrives.
 *
 * The admin password is encrypted here (AES-256-GCM, dedicated key) before it
 * reaches the database, and is never echoed back. See
 * lib/pendingRegistrationCrypto.ts for why a dedicated key rather than
 * SESSION_SECRET.
 *
 * This endpoint stores and returns a tx_ref. It does NOT provision and does NOT
 * take payment — it is a reservation, and an attacker minting holds only
 * occupies short-lived rows that expire on their own.
 */

export const dynamic = "force-dynamic";

/** Mirrors the wizard's rules so an obviously-invalid hold is refused early. */
function validate(p: PendingPayload): string | null {
  if (!p.school_name?.trim()) return "School name is required";
  const sub = p.subdomain?.trim().toLowerCase() || "";
  if (!/^[a-z0-9-]{3,30}$/.test(sub)) return "Subdomain is invalid";
  if (!p.admin_email?.includes("@")) return "Admin email is invalid";
  if (!p.admin_password || p.admin_password.length < 8) {
    return "Admin password must be at least 8 characters";
  }
  // Must match the wizard and the backend. See MIN_REGISTRATION_STUDENTS in
  // lib/pricing.ts — this copy is deliberate, the backend is authoritative.
  if (!Number.isInteger(p.student_count) || p.student_count < 10) {
    return "Minimum 10 students";
  }
  if (p.student_count > 10000) return "Maximum 10,000 students";
  return null;
}

export async function POST(req: NextRequest) {
  let body: Partial<PendingPayload>;
  try {
    body = (await req.json()) as Partial<PendingPayload>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const payload: PendingPayload = {
    school_name: String(body.school_name ?? "").trim(),
    subdomain: String(body.subdomain ?? "").trim().toLowerCase(),
    admin_name: body.admin_name ? String(body.admin_name).trim() : undefined,
    admin_email: String(body.admin_email ?? "").trim().toLowerCase(),
    admin_password: typeof body.admin_password === "string" ? body.admin_password : undefined,
    student_count: Number(body.student_count ?? 0),
    accepted_terms: body.accepted_terms === true,
  };

  const invalid = validate(payload);
  if (invalid) {
    return NextResponse.json({ success: false, error: invalid }, { status: 400 });
  }

  try {
    const txRef = await holdRegistration(payload);
    // No payload echoed — it contains the admin password.
    return NextResponse.json({ success: true, tx_ref: txRef }, { status: 200 });
  } catch (e) {
    console.error("[register/hold] failed", e);
    return NextResponse.json(
      {
        success: false,
        error: "Could not start checkout. Please try again in a moment.",
      },
      { status: 503 },
    );
  }
}
