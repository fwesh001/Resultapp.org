import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { getStaffDashboard, type StaffFormClass } from "@/lib/staffDashboard";
import StaffShell from "@/components/staff/StaffShell";
import SuspendedPortal from "@/components/tenants/SuspendedPortal";

export const dynamic = "force-dynamic";

interface StaffSession {
  staff?: { id?: string; staff_id?: string };
  tenant_id?: string;
}

export default async function StaffDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  const cookieStore = await cookies();
  const session = cookieStore.get("staff_session")?.value;

  if (!session) {
    redirect(`/${subdomain}/staff/login`);
  }

  // Resolve staff identity for the sidebar "My Form Class" link.
  let staffId = "";
  try {
    const parsed = JSON.parse(session) as StaffSession;
    staffId = String(parsed?.staff?.staff_id || parsed?.staff?.id || "").trim();
  } catch {
    redirect(`/${subdomain}/staff/login`);
  }
  if (!staffId) {
    redirect(`/${subdomain}/staff/login`);
  }

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
