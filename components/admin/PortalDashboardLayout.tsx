import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { readAdminIdentity } from "@/lib/adminAuth";
import AdminShell from "@/components/admin/AdminShell";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * The guarded body of BOTH `/{sub}/admin/(dashboard)` and
 * `/{sub}/moderator/(dashboard)`.
 *
 * ══ WHY THIS IS SHARED ══
 * The moderator console reuses every admin page component, so its layout has to
 * do the same three things: verify the session, resolve the school, and render
 * the shell. Copied into a second file, those two copies would drift — and the
 * first thing that drifted the last time this pattern was duplicated was the
 * suspended-tenant banner link, which pointed at `/admin/billing`. For a
 * moderator that is a link to a page they cannot open. One copy, one portal
 * argument, no possibility of that.
 *
 * ══ WHAT LIVES HERE, AND WHAT CANNOT ══
 * CAPABILITY IS NOT ENFORCED HERE, AND CANNOT BE. Next 16 does not expose a
 * child page's exports through the `children` prop, so this layout cannot know
 * which page it wraps. That was verified live, not assumed: two different pages
 * both logged `requiredCapability=undefined`. Had it shipped, the guard would
 * have silently never fired and every moderator would have had full admin access
 * while every test stayed green.
 *
 * Capability is enforced in the two places that CAN see the route:
 *   1. every page calls enforceAdminCapability() from its own module
 *   2. every /api/admin/* proxy calls requireAdminCapability()
 * Hiding nav entries is UX. The page and the proxy are the enforcement.
 */
export async function PortalDashboardLayout({
  children,
  params,
  portal,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
  portal: PortalSegment;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  // A missing/forged/unrecognised session is a redirect, not a fallback.
  // See normalizeRole() in lib/adminAuth: there is deliberately no path here
  // that assumes the admin role.
  const identity = await readAdminIdentity(subdomain);
  if (!identity) {
    redirect(`/${subdomain}/${portal}/login`);
  }

  // Resolve identity once so the sidebar filters its nav from a single verified
  // read rather than every page re-reading the cookie.
  const viewer = identity;

  const school = await getTenant(subdomain);
  const schoolName = school?.name || subdomain;
  const slug = school?.slug || subdomain;

  // Billing escape hatch: suspended tenants keep full admin access so the ADMIN
  // can self-serve top-ups, with a banner nudge.
  //
  // Fail CLOSED. This used to read `school != null && school.isActive === false`,
  // which meant an unreachable backend (school === null) hid the banner and
  // rendered the whole dashboard as if nothing were wrong. Absence of evidence is
  // not evidence of good standing, so an unknown state shows the notice.
  const suspended = school == null || school.isActive === false;

  // A moderator cannot open /billing, so offering them the top-up link would be
  // a dead end at best and a confusing 403 at worst. They still need to KNOW the
  // portal is suspended — silently dropping the notice would hide a real outage
  // from the person most likely to be asked about it.
  const showBillingLink = !viewer.isModerator;

  return (
    <AdminShell
      subdomain={slug}
      schoolName={schoolName}
      logoUrl={school?.logoUrl}
      isModerator={viewer.isModerator}
      capabilities={viewer.capabilities}
      actorLabel={viewer.staffId || viewer.fullName || viewer.email || null}
      portal={portal}
    >
      {suspended && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
          Portal suspended — public, staff, and report access is paused.{" "}
          {showBillingLink ? (
            <>
              <a
                href={`/${slug}/admin/billing`}
                className="font-semibold underline underline-offset-4 hover:text-white"
              >
                Top up to restore access →
              </a>{" "}
              <span className="text-amber-200/70">
                (A top-up restores access immediately if this suspension was for
                non-payment. If it was for abuse, a legal matter, or a security
                concern, a payment will not lift it — contact support.)
              </span>
            </>
          ) : (
            <span className="text-amber-200/70">
              Ask the school&apos;s administrator to top up. (A top-up restores access
              immediately if this suspension was for non-payment. If it was for abuse,
              a legal matter, or a security concern, a payment will not lift it.)
            </span>
          )}
        </div>
      )}
      {children}
    </AdminShell>
  );
}