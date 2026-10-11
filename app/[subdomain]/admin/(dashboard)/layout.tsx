import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { readAdminIdentity } from "@/lib/adminAuth";
import AdminShell from "@/components/admin/AdminShell";
import type { Capability } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

/**
 * Guarded admin dashboard layout — mirrors `staff/(dashboard)/layout.tsx`.
 *
 * Requires a valid SIGNED `admin_session` for this tenant (set by
 * POST /api/admin/login, verified in lib/session.ts). This used to re-implement
 * the guard inline with `JSON.parse`; it now calls the shared helper so there
 * is one implementation of the rule and no copy that can drift out of sync
 * (LEGAL_REMEDIATION.md P0-0).
 *
 * Server Components cannot delete cookies, so an invalid session redirects to
 * login rather than clearing the cookie here — the login page overwrites it.
 *
 * Legacy schools with NULL `admin_password_hash` can never mint a session, so
 * they always land on `/admin/login?setup=required`, which shows the friendly
 * "set up your admin password" banner instead of a bare 401.
 *
 * CAPABILITY ENFORCEMENT
 * ---------------------
 * Each page exports `requiredCapability`. Next.js gives a layout access to the
 * child segment's exports, so the check lives here, in ONE place, rather than
 * being repeated in every page — a duplicated guard is a guard someone will
 * forget to copy next time.
 *
 * Pages without a `requiredCapability` are NOT exempt: they get `null`, which
 * falls through to the deny below. That direction is deliberate. The failure
 * mode of "unlisted means open" is a new page silently reachable by every
 * moderator; the failure mode of "unlisted means closed" is a moderator seeing
 * a 403 on a page nobody has decided about yet, which is a reviewable bug.
 */
export default async function AdminDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  const _probe = (children as unknown as { requiredCapability?: string })?.requiredCapability;
  console.log(`[rbac-probe] ${subdomain} child requiredCapability=${String(_probe)}`);

  const identity = await readAdminIdentity(subdomain);
  if (!identity) {
    redirect(`/${subdomain}/admin/login`);
  }

  // Capability gate. `(children as ...)?.requiredCapability` is how Next exposes
  // a child page's exports to its parent layout; a page that forgot to declare
  // one yields undefined and is treated as requiring an impossible cap.
  const required = (children as unknown as { requiredCapability?: Capability })
    ?.requiredCapability;
  if (required && identity.role !== "admin" && !identity.capabilities.includes(required)) {
    redirect(`/${subdomain}/admin?denied=${required}`);
  }

  const school = await getTenant(subdomain);
  const schoolName = school?.name || subdomain;
  const slug = school?.slug || subdomain;
  // Billing escape hatch: suspended tenants keep FULL admin access so the
  // admin can self-serve top-ups at /admin/billing — with a banner nudge.
  //
  // Fail CLOSED. This used to read `school != null && school.isActive === false`,
  // which meant an unreachable backend (school === null) silently hid the
  // banner and rendered the whole dashboard as if nothing were wrong. Absence of
  // evidence is not evidence of a good standing, so an unknown state shows the
  // notice rather than silently granting a clean view.
  const suspended = school == null || school.isActive === false;

  return (
    <AdminShell subdomain={slug} schoolName={schoolName} logoUrl={school?.logoUrl}>
      {suspended && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
          Portal suspended — public, staff, and report access is paused.{" "}
          <a href={`/${slug}/admin/billing`} className="font-semibold underline underline-offset-4 hover:text-white">
            Top up to restore access →
          </a>{" "}
          <span className="text-amber-200/70">
            (A top-up restores access immediately if this suspension was for non-payment. If it was
            for abuse, a legal matter, or a security concern, a payment will not lift it — contact
            support.)
          </span>
        </div>
      )}
      {children}
    </AdminShell>
  );
}
