import { NextRequest, NextResponse } from "next/server";
import { getBackendBase, requireSecret, upstreamError } from "@/app/api/superadmin/_lib";
import { readOptionalSession } from "@/lib/supportAuth";

/**
 * POST /api/support — public support ticket intake for the marketing /support
 * page. Backs both the "Report a Bug" and "Give Feedback" tabs.
 *
 * Auth is OPTIONAL by design: an anonymous visitor is a legitimate submitter,
 * so a missing session produces an unlinked ticket rather than a 401. The only
 * hard failures are malformed input and an unreachable backend.
 *
 * Trust rule: when a session is present its tenant/email/role OVERWRITE the
 * client-supplied values, so the form field can never be used to impersonate a
 * tenant admin. `submitter_email` from the body is honoured only when no
 * session exists, where it is unverified contact info.
 */

const VALID_TYPES = new Set(["bug", "feedback"]);
const MAX_FIELDS = 20;

interface SupportBody {
  type?: unknown;
  payload?: unknown;
  email?: unknown;
}

/** Coerce a form payload into a small, bounded, JSON-safe object. */
function sanitizePayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, MAX_FIELDS)) {
    const k = String(key).slice(0, 100);
    if (typeof value === "string") {
      out[k] = value.slice(0, 4000);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[k] = value;
    } else if (Array.isArray(value)) {
      out[k] = value.slice(0, 20);
    }
    // Objects/other types are dropped — the current forms only send scalars.
  }
  return out;
}

export async function POST(req: NextRequest) {
  const { secret, error } = requireSecret() as { secret?: string; error?: NextResponse };
  if (error) return error;

  let body: SupportBody;
  try {
    body = (await req.json()) as SupportBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const type = String(body.type ?? "").trim().toLowerCase();
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ success: false, error: "type must be bug or feedback" }, { status: 400 });
  }

  const payload = sanitizePayload(body.payload);
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ success: false, error: "Please describe the issue before submitting" }, { status: 400 });
  }

  // Session wins over anything the client sent.
  const session = await readOptionalSession();
  const typedEmail = String(body.email ?? "").trim().toLowerCase();
  const submitterEmail = session?.email ?? (typedEmail || null);

  try {
    const r = await fetch(`${getBackendBase()}/api/v1/support/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret as string },
      body: JSON.stringify({
        type,
        payload,
        tenant_id: session?.tenantId ?? null,
        submitter_email: submitterEmail,
        submitter_role: session?.role ?? null,
        submitter_kind: session?.kind ?? "anonymous",
        submitter_id: session?.userId ?? null,
      }),
      cache: "no-store",
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = upstreamError(data, "Could not submit your report");
      // Surface the backend's throttle message verbatim — it tells the user
      // how long to wait, which a generic error would throw away.
      return NextResponse.json({ success: false, error: msg }, { status: r.status });
    }

    const ticket = data as { ticket_id?: string; status?: string };
    return NextResponse.json(
      { success: true, ticket_id: ticket.ticket_id ?? null, status: ticket.status ?? "open" },
      { status: 201 },
    );
  } catch (e) {
    console.error("[support] submit proxy fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the support service — please try again" },
      { status: 502 },
    );
  }
}
