import TicketsView from "@/components/superadmin/TicketsView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/** Support tickets — scope-guarded Server Component wrapper. */
export default async function SuperadminTicketsPage() {
  const denied = await enforceSuperadminPage("tickets");
  if (denied) return denied;
  return <TicketsView />;
}
