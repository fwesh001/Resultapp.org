import { NextRequest, NextResponse } from "next/server";
import { holdRegistration, newTxRef, type PendingPayload, type WaiverBinding } from "@/lib/pendingRegistrations";
import { getBackendBase, upstreamError, requireSecret } from "../../superadmin/_lib";

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
 *
 * ── WAIVERS ───────────────────────────────────────────────────────────────
 * When a waiver code is supplied this route does three things, in this order:
 *
 *   1. PREVIEWS it against the backend (read-only, cannot consume anything)
 *   2. RESERVES it under the tx_ref it is about to mint
 *   3. Parks the hold carrying the waiver binding
 *
 * Reserve-before-park is the ordering that matters. If the reservation came
 * after the hold, two tabs could each park a hold and then race to reserve, and
 * the loser would hold a registration it can never complete — with a code it
 * has already burned. One reference, one reservation, one hold.
 *
 * THE PUBLIC BRUTE-FORCE SURFACE. This route is unauthenticated, and a waiver
 * code is a bearer credential with cash value, so the preview step is rate
 * limited at both tiers. Without that, this endpoint is a free oracle for
 * grinding codes.
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
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
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

  const { secret, error } = requireSecret();
  if (error) return error;

  const base = getBackendBase();
  const tokenString = String(body.waiver_token ?? "").trim();

  let txRef = newTxRef(payload.subdomain);
  let waiver: WaiverBinding | undefined;
  let split: Record<string, unknown> | null = null;

  if (tokenString) {
    // 1. Preview — read-only, so a bad code costs nothing and a school who
    //    mistypes it is not punished by having their previous code consumed.
    const preview = await fetch(`${base}/api/v1/waiver/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({
        token_string: tokenString,
        requested_slots: payload.student_count,
        applies_to: "REGISTRATION",
      }),
      cache: "no-store",
    });
    const previewData = await preview.json().catch(() => ({}));
    if (!preview.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(previewData, "That waiver code could not be applied") },
        { status: preview.status },
      );
    }

    const pd = previewData as {
      token_id?: number;
      split?: Record<string, unknown>;
    };
    split = pd.split ?? null;
    const chargedNgn = Number(split?.charged_ngn ?? 0);
    const chargedSlots = Number(split?.charged_slots ?? 0);

    // 2. Reserve under the tx_ref we are about to park, so the token's
    //    reservation and the registration's hold are the same lifecycle.
    const reserved = await fetch(`${base}/api/v1/waiver/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify({
        token_string: tokenString,
        tx_ref: txRef,
        applies_to: "REGISTRATION",
      }),
      cache: "no-store",
    });
    const reservedData = await reserved.json().catch(() => ({}));
    if (!reserved.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(reservedData, "That waiver code is not available") },
        { status: reserved.status },
      );
    }

    waiver = {
      token_id: pd.token_id ?? Number((reservedData as { reservation?: { id?: number } })?.reservation?.id ?? 0),
      reservation_tx_ref: txRef,
      // The 100% bypass marker. The backend's own split decides this, never
      // the client, because this field decides whether the completion path
      // waits for a charge that will never exist.
      charge_required: chargedNgn > 0,
      charge_ngn: chargedNgn,
      charged_slots: chargedSlots,
    };
  }

  try {
    const parked = await holdRegistration(payload, { txRef, waiver });
    // No payload echoed — it contains the admin password. The split IS echoed
    // so the wizard can render the discounted total without a second round
    // trip, and it is display-only: the backend recomputes it at redemption.
    return NextResponse.json(
      {
        success: true,
        tx_ref: parked,
        waiver: waiver ? { token_id: waiver.token_id, ...split } : null,
      },
      { status: 200 },
    );
  } catch (e) {
    // Park failed, so nothing will ever claim this reservation. Give the
    // token straight back rather than making the school wait out the TTL.
    if (waiver) {
      await fetch(`${base}/api/v1/waiver/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
        body: JSON.stringify({ token_id: waiver.token_id, tx_ref: txRef }),
        cache: "no-store",
      }).catch(() => null);
    }
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
