import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadminAuth";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";

/** PUT /api/superadmin/notifications/templates/[eventType] — edit a system template. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ eventType: string }> }) {
  const guard = await requireSuperadmin();
  if (guard) return guard;
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  const { eventType } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/admin/notification-templates/${encodeURIComponent(eventType)}`,
      {
        method: "PUT",
        headers: { "X-API-SECRET-KEY": secret as string, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ success: false, error: upstreamError(data, "Template update failed") }, { status: r.status });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error("[superadmin notification template update] fetch failed", e);
    return NextResponse.json({ success: false, error: "Could not reach admin service" }, { status: 502 });
  }
}
