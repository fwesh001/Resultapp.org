import { getTenant } from "@/lib/tenant";
import AdminShell from "@/components/admin/AdminShell";

/**
 * Admin portal layout — responsive shell (fixed sidebar on md+,
 * hamburger drawer on mobile) wrapping dashboard, allocations,
 * templates, settings, and billing.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: routeSubdomain } = await params;
  const school = await getTenant(routeSubdomain);

  const subdomain = school?.slug ?? routeSubdomain;
  const schoolName = school?.name ?? routeSubdomain;

  return (
    <AdminShell subdomain={subdomain} schoolName={schoolName}>
      {children}
    </AdminShell>
  );
}
