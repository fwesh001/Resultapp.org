import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { hasAdminSession } from "@/lib/adminAuth";
import AdminShell from "@/components/admin/AdminShell";

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

  if (!(await hasAdminSession(subdomain))) {
    redirect(`/${subdomain}/admin/login`);
  }

  const school = await getTenant(subdomain);
  const schoolName = school?.name || subdomain;
  const slug = school?.slug || subdomain;
  // Billing escape hatch: suspended tenants keep FULL admin access so the
  // admin can self-serve top-ups at /admin/billing — with a banner nudge.
  const suspended = school != null && school.isActive === false;

  return (
    <AdminShell subdomain={slug} schoolName={schoolName}>
      {suspended && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
          Portal suspended — public, staff, and report access is paused.{" "}
          <a href={`/${slug}/admin/billing`} className="font-semibold underline underline-offset-4 hover:text-white">
            Top up to restore access →
          </a>
        </div>
      )}
      {children}
    </AdminShell>
  );
}
