import WaiversView from "@/components/superadmin/WaiversView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/** Waiver Tokens — scope-guarded Server Component wrapper. */
export default async function SuperadminWaiversPage() {
  const denied = await enforceSuperadminPage("waivers");
  if (denied) return denied;
  return <WaiversView />;
}
