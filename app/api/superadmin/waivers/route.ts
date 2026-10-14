import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin, readSuperadminIdentity } from "@/lib/superadminAuth";
import { getBackendBase, upstreamError, requireSecret } from "../_lib";

/**
 * Superadmin waiver-token lifecycle.
 *
 *   GET  /api/superadmin/waivers        list (paged, filterable by status)
 *   POST /api/superadmin/waivers        mint
 *
 * `created_by` is attached HERE, from the signed session cookie, and not taken
 * from the request body. That is the whole reason the backend's
 * /api/v1/admin/* prefix is guarded only by a shared secret: the FastAPI tier
 * has no idea who is signed in and cannot verify an identity it is handed. If
 * the browser could choose this value, the audit trail would be whatever the
 * caller typed.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (guard) return guard;

  const { secret, error } = requireSecret();
  if (error) return error;

  const incoming = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  for (const k of ["status", "limit", "offset"]) {
    const v = incoming.get(k);
    if (v !== null && v !== "") qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/waivers${suffix}`, {
      headers: { "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, `Could not load waiver tokens (${r.status})`) },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin/waivers] GET failed", e);
    return NextResponse.json({ success: false, error: "Could not reach waiver service" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (guard) return guard;

  const { secret, error } = requireSecret();
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Attribute the issuance to the signed-in superadmin, never to the request.
  // Falls back to a non-null label for the legacy SUPERADMIN_PASSWORD path,
  // which mints an identity-less session — never to an empty string, because
  // created_by is NOT NULL and the mint would fail with an opaque 500.
  const identity = await readSuperadminIdentity();
  const createdBy = identity?.email ?? identity?.adminId ?? "superadmin(legacy)";

  const payload = {
    discount_percentage: Number(body.discount_percentage),
    slot_allowance: Number(body.slot_allowance),
    applies_to: String(body.applies_to ?? "BOTH").trim().toUpperCase(),
    locked_to_tenant: body.locked_to_tenant ? String(body.locked_to_tenant).trim().toLowerCase() : null,
    restores_suspension: body.restores_suspension === true,
    ttl_days: body.ttl_days === undefined ? 30 : Number(body.ttl_days),
    note: body.note ? String(body.note).slice(0, 500) : null,
    created_by: createdBy,
  };

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/admin/waivers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "Could not create the waiver token") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin/waivers] POST failed", e);
    return NextResponse.json({ success: false, error: "Could not reach waiver service" }, { status: 502 });
  }
}
