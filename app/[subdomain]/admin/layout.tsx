import { getTenant } from "@/lib/tenant";
import AdminSidebar from "@/components/admin/AdminSidebar";

/**
 * Admin portal layout — persistent sidebar wrapping
 * dashboard, allocations, templates, settings, and billing.
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
    <div className="flex h-screen bg-[#0B0514] text-white">
      <AdminSidebar subdomain={subdomain} schoolName={schoolName} />
      <main className="flex-1 overflow-y-auto bg-[#0B0514]">{children}</main>
    </div>
  );
}
