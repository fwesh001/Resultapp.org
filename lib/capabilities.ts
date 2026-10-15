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
 * `announcements` is here for a different reason: it does not escalate, it
 * speaks. Broadcasting writes an ANNOUNCEMENT into every active staff member's
 * inbox, and no amount of capability means a deputy should be able to say
 * something to the whole staff body that the administrator did not. Note this is
 * the TENANT-scoped broadcast, which is distinct from composing platform-wide
 * announcements behind /api/superadmin/*.
 *
 * `notifications` is deliberately NOT here. Deputies do need the operational
 * picture — a held clearance or a failing publish is exactly what they are on
 * call to act on — so they get the inbox alongside their other duties.
 *
 * Granting `notifications` does NOT grant the ability to broadcast. The
 * tenant-facing notification API is read/receipt-only (list, unread-count,
 * mark-read); composing and broadcasting lives behind /api/superadmin/*, which
 * a tenant moderator's session cannot reach at any capability level.
 *
 * `end-of-session` is here because it is the one capability a
 * deputy already holds everything needed to fake. Moderators can edit every
 * student row via `allocations` — so a deputy could promote a cohort by hand,
 * one UPDATE at a time, with no ledger entry and no audit record. Gating the
 * BULK action behind a capability does not stop that, and this list is not the
 * place to pretend otherwise: what it buys is that the destructive,
 * cohort-wide, money-affecting path is a deliberate, audited, single
 * transaction an administrator authorised, rather than forty silent edits a
 * deputy made over an afternoon.
 *
 * NAMED end-of-session, NOT "promotion", ON PURPOSE. `allocations` already has
 * a long-standing notion of "promotion" — promoting a STAFF MEMBER to moderator
 * via PATCH /staff/moderator, which is a moderator-held capability and fires
 * MODERATOR_GRANTED. One word meaning two unrelated privileges in the same
 * codebase is how a guard ends up checking the wrong thing. The cohort close is
 * named after what it does to a cohort, not after one of its four outcomes.
 */
export const ADMIN_ONLY_CAPABILITIES = [
  "settings",
  "billing",
  "audit",
  "moderators",
  "announcements",
  "end-of-session",
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

/**
 * Shape the authorization claims for a signed session.
 *
 * ONE function, called by every minting site: the admin login proxy and the
 * moderator elevation route. Before this existed the login proxy's own comment
 * said the role and capability claims "must be minted here and nowhere else" —
 * and then moderator elevation needed the same two fields, which would have
 * made that a lie with no harness watching. Two sites drifting is how a
 * moderator ends up holding a subset nobody intended.
 *
 * `role` is returned EXPLICITLY and never inferred from a missing field.
 * `readAdminIdentity.normalizeRole` returns null for anything unrecognised and
 * rejects the session, so a caller that forgot this would produce a cookie that
 * verifies but does not authenticate — a confusing 401 loop rather than a
 * privilege escalation. Callers should still assert the returned role.
 */
export function buildSessionClaims(
  upstream: Record<string, unknown>,
  forcedRole?: "admin" | "moderator",
): { role: "admin" | "moderator"; capabilities: string[] } {
  const claimed =
    forcedRole ?? (String(upstream.role ?? "").trim().toLowerCase() === "moderator"
      ? "moderator"
      : "admin");
  return {
    role: claimed,
    capabilities: claimed === "moderator" ? [...MODERATOR_CAPABILITY_LIST] : [...ADMIN_CAPABILITIES],
  };
}

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