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
  // Moderator status, read LIVE from the same payload.
  //
  // The session cookie carries is_moderator as of sign-in and lives 12 hours,
  // so a member promoted a minute ago still has it false in their cookie. Using
  // the cookie alone means the "you have Moderator access" notification arrives
  // before the link that tells them what to do with it. The dashboard query is
  // already being made for form classes, so the live value costs nothing.
  let liveIsModerator: boolean | null = null;
  try {
    const dashboard = await getStaffDashboard(slug, staffId);
    if (Array.isArray(dashboard?.form_classes)) {
      formClasses = dashboard.form_classes.filter((f) => f?.class_name?.trim());
    }
    const hub = dashboard as { staff?: { is_moderator?: unknown } } | null;
    if (hub?.staff && typeof hub.staff.is_moderator === "boolean") {
      liveIsModerator = hub.staff.is_moderator;
    }
  } catch {
    formClasses = [];
  }

  const isModerator = liveIsModerator ?? identity.isModerator;

  return (
    <StaffShell subdomain={slug} schoolName={schoolName} logoUrl={school?.logoUrl} formClasses={formClasses} isModerator={isModerator}>
      {children}
    </StaffShell>
  );
}
