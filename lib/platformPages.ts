/**
 * Platform RBAC — page ids for the superadmin Command Center.
 *
 * MODULE ONLY mirrors the DB's allow-list for UI purposes (sidebar labels,
 * the Team allocator's checkbox list). The AUTHORITATIVE list and the
 * effective pages for a member come from the backend
 * (services.db_manager.PLATFORM_PAGES / resolve_platform_admin_pages) —
 * this file must never be the enforcement source.
 *
 * Allow-list, never a deny-list (same rule lib/capabilities.ts states for
 * tenant moderators): a new Command Center section is unavailable to every
 * non-owner until the owner deliberately allocates it.
 */

export const PLATFORM_PAGES = [
  "dashboard",
  "tenants",
  "adjustments",
  "tickets",
  "ledger",
  "waivers",
  "notifications",
  "vitals",
  "settings",
  "team",
] as const;

export type PlatformPageId = (typeof PLATFORM_PAGES)[number];

/** Team is a page only an owner can hold, whatever the checkbox claims. */
export const OWNER_ONLY_PAGES = ["team"] as const;

/**
 * Role defaults when a member carries no explicit page_scope.
 * Mirrors DEFAULT_PLATFORM_ADMIN_PAGES / DEFAULT_PLATFORM_SUPPORT_PAGES in
 * db_manager.py.
 */
export function roleDefaultPages(role: string | null | undefined): PlatformPageId[] {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "owner") return [...PLATFORM_PAGES];
  if (r === "admin") return PLATFORM_PAGES.filter((p) => p !== "team");
  // support ("mod"): nothing until allocated.
  return [];
}

/**
 * Effective pages for a member. `allocated` (a stored page_scope list)
 * REPLACES the role default for that member; owner always sees everything.
 */
export function resolvePlatformPages(
  role: string | null | undefined,
  allocated: readonly string[] | null | undefined,
): PlatformPageId[] {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "owner") return [...PLATFORM_PAGES];
  const base: PlatformPageId[] = allocated?.length
    ? PLATFORM_PAGES.filter((p) => (allocated as readonly string[]).includes(p))
    : roleDefaultPages(r);
  // Owner-only pages can never enter a non-owner's set through allocation.
  return base.filter((p) => !(OWNER_ONLY_PAGES as readonly string[]).includes(p));
}

export const PLATFORM_PAGE_LABELS: Record<PlatformPageId, string> = {
  dashboard: "Dashboard",
  tenants: "Tenants",
  adjustments: "Credit & Slot Adjustments",
  tickets: "Tickets",
  ledger: "Ledger & Audit",
  waivers: "Waiver Tokens",
  notifications: "Notifications",
  vitals: "Platform Vitals",
  settings: "Settings",
  team: "Team",
};

export function isPlatformPageId(value: string): value is PlatformPageId {
  return (PLATFORM_PAGES as readonly string[]).includes(value);
}
