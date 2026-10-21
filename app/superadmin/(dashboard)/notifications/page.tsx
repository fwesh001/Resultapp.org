import NotificationsView from "@/components/superadmin/NotificationsView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/** Notifications (templates + broadcast) — scope-guarded Server wrapper. */
export default async function SuperadminNotificationsPage() {
  const denied = await enforceSuperadminPage("notifications");
  if (denied) return denied;
  return <NotificationsView />;
}
