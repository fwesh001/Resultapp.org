import VitalsView from "@/components/superadmin/VitalsView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/** Platform Vitals — scope-guarded Server Component wrapper. */
export default async function SuperadminVitalsPage() {
  const denied = await enforceSuperadminPage("vitals");
  if (denied) return denied;
  return <VitalsView />;
}
