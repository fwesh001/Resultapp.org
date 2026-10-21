import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { resolveSuperadminAccess, type SuperadminAccess, type SuperadminIdentity } from "./superadminAuth";
import { PLATFORM_PAGE_LABELS, type PlatformPageId } from "./platformPages";

/**
 * Page-level scope guard for the superadmin Command Center — the server twin
 * of enforceAdminCapability's rationale for the tenant portals.
 *
 * WHY PER-PAGE, NOT IN THE LAYOUT: Next does not expose a child page's data
 * to its parent layout, and a layout cannot read the pathname, so a
 * layout-level check would always be a silent no-op for scope (verified and
 * documented in lib/enforceCapability.ts for the admin portal). The check
 * lives where the route is actually known: one line at the top of each page.
 *
 * Server components cannot return raw responses, so a denied page returns the
 * JSX below rather than redirecting. Redirecting every denial to /superadmin
 * would loop: the index itself denies unallocated members, and it cannot
 * redirect to /superadmin?denied=… except by pointing at itself. A clean
 * inline screen is the honest outcome of a straight-URL visit.
 *
 * All existing Command Center pages are client components; this guard wraps
 * them: page.tsx becomes a thin Server Component, rendering <XxxView/> after
 * the scope check passes.
 */

export interface SuperadminPageAccess {
  access: SuperadminAccess;
  identity: SuperadminIdentity;
}

/**
 * Resolve the viewer's access for a Server Component. Returns null-ish when
 * there is no superadmin session — the caller redirects to login itself,
 * because layouts (not pages) own that redirect today and a page-level
 * redirect to /superadmin/login is equally correct and clearer to debug.
 */
export async function superadminAccessOrLogin(): Promise<
  SuperadminPageAccess | { login: true; target: string }
> {
  const access = await resolveSuperadminAccess();
  if (access === null) {
    return { login: true, target: "/superadmin/login" };
  }
  return {
    access,
    identity: {
      email: access.email,
      adminId: access.adminId,
      role: access.role,
    },
  };
}

/** True when `access` may open `pageId`. */
export function pageAllowed(access: SuperadminAccess, pageId: PlatformPageId): boolean {
  return access.pages.includes(pageId);
}

/**
 * Shared "not in your scope" screen. Degrades to a backend-failure variant
 * when the access snapshot was marked degraded, so an unreachable backend
 * never reads as "you lost permission".
 */
export function SuperadminDenied({
  pageIds,
  degraded = false,
}: {
  pageIds: PlatformPageId | PlatformPageId[];
  degraded?: boolean;
}) {
  const label = Array.isArray(pageIds)
    ? pageIds.map((p) => PLATFORM_PAGE_LABELS[p] ?? p).join(" / ")
    : PAGE_LABEL(pageIds);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-warning/30 bg-warning-soft">
        <ShieldAlert className="h-7 w-7 text-warning" />
      </span>
      <h1 className="text-xl font-bold tracking-tight text-text-1">
        {degraded ? "Command Center unreachable" : "This page is not allocated to you"}
      </h1>
      <p className="text-sm leading-6 text-text-2">
        {degraded
          ? "The platform service could not confirm your page scope, so nothing was opened. Try again shortly, or sign out and back in."
          : `Your Command Center scope does not include ${label}. The platform owner can allocate it from Team → membership → pages.`}
      </p>
      <Link
        href="/superadmin"
        className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}

function PAGE_LABEL(pageId: PlatformPageId): string {
  return PLATFORM_PAGE_LABELS[pageId] ?? pageId;
}

/**
 * One-line enforcement for a Command Center page component:
 *
 *   const denied = await enforceSuperadminPage("tenants");
 *   if (denied) return denied;
 *   return <TenantsView />;
 *
 * Returns the denied screen's JSX when the signed-in member's DB-resolved
 * scope lacks `pageId`, redirects to login when there is no superadmin
 * session, and returns null when the page may render. Throwing-auth pattern
 * mirrors enforceAdminCapability, only here the caller returns the node (a
 * page redirect target like /superadmin would deny-loop — see file header).
 */
export async function enforceSuperadminPage(
  pageId: PlatformPageId,
): Promise<React.ReactNode | null> {
  const result = await superadminAccessOrLogin();
  if ("login" in result) {
    redirect(result.target);
  }
  if (!pageAllowed(result.access, pageId)) {
    return <SuperadminDenied pageIds={pageId} degraded={result.access.degraded} />;
  }
  return null;
}

export type { SuperadminAccess };

