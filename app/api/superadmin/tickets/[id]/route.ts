import { NextRequest, NextResponse } from "next/server";
import { readSuperadminIdentity, requireSuperadmin } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/**
 * PATCH /api/superadmin/tickets/[id] — advance a ticket's status.
 *
 * The acting superadmin's email is read from the session cookie here and
 * forwarded, because the backend only ever sees the shared API secret and can
 * therefore not attribute the `audit_logs` entry on its own.
 */

const VALID_STATUSES = new Set(["open", "in_progress", "resolved"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperadmin();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: "Invalid ticket id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    status?: unknown;
    resolution_note?: unknown;
  };
  const status = String(body.status ?? "").trim().toLowerCase();
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { success: false, error: "status must be open, in_progress or resolved" },
      { status: 400 },
    );
  }

  const note = String(body.resolution_note ?? "").trim().slice(0, 2000);
  const identity = await readSuperadminIdentity();

  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/admin/support-tickets/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret as string },
        body: JSON.stringify({
          status,
          resolution_note: note || null,
          actor_email: identity?.email ?? null,
          actor_id: identity?.adminId ?? null,
        }),
        cache: "no-store",
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: upstreamError(data, "Could not update ticket") },
        { status: r.status },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin ticket status] fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach admin service" },
      { status: 502 },
    );
  }
}
