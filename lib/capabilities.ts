/**
 * Capability model — the single source of truth for what an admin-portal role
 * may do.
 *
 * Kept in its own module with NO React/server imports on purpose. The login
 * proxy, the layouts, the sidebar and the guards all need the same list, and a
 * shared constant is the only thing that stops four copies drifting apart.
 *
 * DESIGN RULE: caps are an allow-list, never a deny-list.
 *
 * A deny-list ("moderator gets everything except settings/billing/audit") reads
 * shorter today and is the wrong shape: the day someone adds an eighth page,
 * every moderator silently gets it, and nobody finds out until it is used. An
 * allow-list fails the other way — the new page is missing until someone
 * deliberately grants it, which is a visible, reviewable decision.
 *
 * Adding a capability:
 *   1. add the id here
 *   2. add it to ADMIN_CAPABILITIES
 *   3. add it to MODERATOR_CAPABILITIES if a moderator should have it
 *   4. export `requiredCapability` from the page so the layout enforces it
 */

/**
 * Capabilities only the school's own admin holds.
 *
 * `settings`, `billing`, `audit` and `moderators` are here because each one
 * either rewrites school-wide configuration, moves money, records the actions
 * that must not be altered, or grants the very authority these caps protect.
 * A deputy holding any of these could escalate, so none of them delegate.
 *
 * `notifications` is deliberately NOT here. Deputies do need the operational
 * picture — a held clearance or a failing publish is exactly what they are on
 * call to act on — so they get the inbox alongside their other duties.
 *
 * Granting this does NOT grant the ability to speak to the school. The
 * tenant-facing notification API is read/receipt-only (list, unread-count,
 * mark-read); composing and broadcasting lives behind /api/superadmin/*, which
 * a tenant moderator's session cannot reach at any capability level. So the
 * school-wide announcement decision stays with the platform, and a deputy
 * holding `notifications` can observe but not publish.
 */
export const ADMIN_ONLY_CAPABILITIES = [
  "settings",
  "billing",
  "audit",
  "moderators",
] as const;

/** Capabilities a moderator (deputy) holds. */
export const MODERATOR_CAPABILITIES = [
  "dashboard",
  "allocations",
  "results",
  "clearance",
  "templates",
  "export",
  "notifications",
] as const;

export type Capability = (typeof ADMIN_CAPABILITIES)[number];

/** Every capability in the system, in a stable order for tests and UI. */
export const ALL_CAPABILITIES = [
  ...ADMIN_ONLY_CAPABILITIES,
  ...MODERATOR_CAPABILITIES,
] as const;

/** The full admin holds all of them. */
export const ADMIN_CAPABILITIES: readonly string[] = ALL_CAPABILITIES;

/** The caps a moderator holds, as a plain list for the session claim. */
export const MODERATOR_CAPABILITY_LIST: readonly string[] = MODERATOR_CAPABILITIES;

export type { Capability as AdminCapability };

/** True when `role`/`caps` may reach pages requiring `capability`. */
export function capabilityGranted(
  role: string | undefined | null,
  caps: readonly string[] | undefined | null,
  capability: string,
): boolean {
  // An admin holds everything, including caps added after their session was
  // minted — otherwise promoting someone to admin would not take effect until
  // they re-logged-in. Moderators get exactly what the claim says.
  if (role === "admin") return true;
  return (caps || []).includes(capability);
}