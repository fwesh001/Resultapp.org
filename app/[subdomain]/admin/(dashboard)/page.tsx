import { DashboardSection } from "@/components/admin/sections/DashboardSection";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/** Overview dashboard, served under BOTH `/{sub}/admin` and `/{sub}/moderator`. */
export const requiredCapability = "dashboard";
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ subdomain: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <DashboardSection
      params={params}
      searchParams={searchParams}
      portal={"admin" as PortalSegment}
    />
  );
}
