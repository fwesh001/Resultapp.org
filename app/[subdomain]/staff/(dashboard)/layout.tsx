import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import StaffShell from "@/components/staff/StaffShell";
import SuspendedPortal from "@/components/tenants/SuspendedPortal";

export const dynamic = "force-dynamic";

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

  // Optional: validate session JSON shape
  try {
    JSON.parse(session);
  } catch {
    redirect(`/${subdomain}/staff/login`);
  }

  const school = await getTenant(subdomain);
  const schoolName = school?.name || subdomain;
  const slug = school?.slug || subdomain;

  // Suspended tenants: staff portal blocked (no billing hatch — staff can't pay).
  if (school && school.isActive === false) {
    return <SuspendedPortal schoolName={schoolName} subdomain={slug} />;
  }

  return (
    <StaffShell subdomain={slug} schoolName={schoolName}>
      {children}
    </StaffShell>
  );
}
