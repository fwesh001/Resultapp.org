import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { getStaffDashboard, type StaffFormClass } from "@/lib/staffDashboard";
import { readStaffSession } from "@/lib/staffAuth";
import StaffShell from "@/components/staff/StaffShell";
import SuspendedPortal from "@/components/tenants/SuspendedPortal";

export const dynamic = "force-dynamic";

/**
 * Guarded staff dashboard layout.
 *
 * Uses the shared `readStaffSession` guard, which verifies the HMAC signature
 * AND requires the session's `tenant_id` to match this portal. The previous
 * inline version did `JSON.parse` with no signature check and never compared
 * `tenant_id` at all, so a session for one school would have rendered another
 * school's dashboard (LEGAL_REMEDIATION.md P0-0).
 *
 * Server Components cannot delete cookies, so an invalid session redirects to
 * login rather than clearing the cookie here.
 */
export default async function StaffDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  // Bound to this portal's subdomain — a cross-tenant session is rejected.
  const identity = await readStaffSession(subdomain);
  if (!identity) {
    redirect(`/${subdomain}/staff/login`);
  }

  // Resolve staff identity for the sidebar "My Form Class" link.
  const staffId = identity.staffId;

  const school = await getTenant(subdomain);
  const schoolName = school?.name || subdomain;
  const slug = school?.slug || subdomain;

  // Suspended tenants: staff portal blocked (no billing hatch — staff can't pay).
  if (school && school.isActive === false) {
    return <SuspendedPortal schoolName={schoolName} subdomain={slug} />;
  }

  // Form classes for the dynamic sidebar link. Same URL + options as the
  // dashboard page's fetch, so Next.js request memoization collapses both
  // into one backend hit per render. Fail-open: sidebar hides the link.
  let formClasses: StaffFormClass[] = [];
  try {
    const dashboard = await getStaffDashboard(slug, staffId);
    if (Array.isArray(dashboard?.form_classes)) {
      formClasses = dashboard.form_classes.filter((f) => f?.class_name?.trim());
    }
  } catch {
    formClasses = [];
  }

  return (
    <StaffShell subdomain={slug} schoolName={schoolName} formClasses={formClasses}>
      {children}
    </StaffShell>
  );
}
