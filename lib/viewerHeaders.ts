import { readAdminIdentity, type AdminIdentity } from "./adminAuth";

/**
 * Caller-identity headers forwarded to FastAPI (defence in depth).
 *
 * THE BOUNDARY, STATED HONESTLY
 * -----------------------------
 * The backend only ever accepts the shared X-API-SECRET-KEY, so today anything
 * holding that secret reaches every route. That is a PRE-EXISTING property of
 * the architecture, documented in app/api/admin/export/route.ts. These headers
 * do not make it worse — the same secret that would forge them already grants
 * full access — but they let the backend *further restrict* known-good callers,
 * and they make the audit trail name a real actor instead of "someone".
 *
 * They are therefore DEFENCE IN DEPTH, NOT A HARD GUARANTEE. The hard
 * guarantee stays in Next: `requireAdminCapability` runs before any fetch, on
 * the request, in a place the caller cannot touch.
 *
 * HEADER NAMES
 * ------------
 * `X-Viewer-*` rather than `X-Role`/`X-User`: "viewer" says who is LOOKING,
 * which is exactly what these carry. A `X-Role` header invites the reader to
 * assume the backend trusts roles generally.
 */
export interface ViewerHeaders {
  /** `admin` or `moderator`. Omitted when unknown rather than sent as "". */
  role: string;
  /** The acting identifier: staff_id for a moderator, email for an admin. */
  id: string;
  /** Human label for audit rows. */
  label: string;
}

/**
 * Build the headers for `tenant`, or null if the viewer is not authenticated.
 *
 * `id` and `label` fall back to each other rather than being omitted: an audit
 * row with no actor is useless, and "unknown" is worse than a name that at
 * least identifies the row.
 */
export async function viewerHeaders(
  tenant: string,
): Promise<Record<string, string> | null> {
  const identity: AdminIdentity | null = await readAdminIdentity(tenant);
  if (!identity) return null;

  const id = identity.staffId || identity.email || "";
  const label = identity.fullName || id || "unknown";

  const headers: Record<string, string> = {
    "X-Viewer-Role": identity.role,
    "X-Viewer-Id": id,
    "X-Viewer-Label": label,
  };

  // A moderator's capability list travels too, so a backend route that wants to
  // be strict can check the cap directly instead of re-deriving it from the role.
  if (identity.isModerator) {
    headers["X-Viewer-Caps"] = identity.capabilities.join(",");
  }

  return headers;
}
