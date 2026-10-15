/**
 * Shared plumbing for the four End of Session proxies.
 *
 * Every one of them is admin-only via `requireAdminCapability(tenantId,
 * "end-of-session")`. Hiding the page from the sidebar is UX, not security —
 * this is the gate that actually refuses, and it must never be relaxed to
 * `requireAdminSession` (which a moderator satisfies).
 *
 * The capability is named end-of-session, NOT "promotion": `allocations`
 * already uses that word for promoting a staff member to moderator. Same word,
 * two unrelated privileges, in the same guard file, is how the wrong thing
 * ends up being checked.
 *
 * There is deliberately no shared secret in this module: the callers are
 * expected to import getSecret/getBackendBase from the canonical definitions
 * rather than re-declaring them, because a second copy of the backend base URL
 * is how a proxy ends up talking to the wrong environment.
 */

/**
 * Narrow an untrusted upstream payload to a single user-facing message.
 *
 * The backend's `detail` is FastAPI's own error text and is safe to echo, but
 * it can also be a list (HTTPException with a list detail) or a dict. Blindly
 * interpolating any of those into the UI produces "[object Object]".
 */
export function upstreamMessage(
  data: { detail?: unknown; error?: unknown },
  fallback: string,
): string {
  const detail = data.detail ?? data.error;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc, msg, type}, ...]
    const msgs = detail
      .map((d) =>
        typeof d === "object" && d !== null && "msg" in d
          ? String((d as { msg: unknown }).msg)
          : String(d)
      )
      .filter(Boolean);
    if (msgs.length) return msgs.join("; ");
  }
  return fallback;
}