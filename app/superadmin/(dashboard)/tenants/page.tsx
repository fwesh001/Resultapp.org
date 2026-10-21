import TenantsView from "@/components/superadmin/TenantsView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/** Tenants directory — scope-guarded Server Component wrapper. */
export default async function SuperadminTenantsPage() {
  const denied = await enforceSuperadminPage("tenants");
  if (denied) return denied;
  return <TenantsView />;
}
