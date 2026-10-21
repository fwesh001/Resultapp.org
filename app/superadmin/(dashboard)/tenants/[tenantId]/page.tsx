import TenantDetailView from "@/components/superadmin/TenantDetailView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/** Tenant detail — scope-guarded Server Component wrapper (needs "tenants"). */
export default async function SuperadminTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const denied = await enforceSuperadminPage("tenants");
  if (denied) return denied;
  return <TenantDetailView params={params} />;
}
