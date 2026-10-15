import { NotificationsSection } from "@/components/admin/sections/NotificationsSection";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Notification inbox — served under BOTH `/{sub}/admin/notifications` and
 * `/{sub}/moderator/notifications`.
 *
 * RBAC: the capability id is an allow-list entry (see lib/capabilities.ts). A
 * page added without a decision stays unavailable to moderators.
 */
export const requiredCapability = "notifications";
export const dynamic = "force-dynamic";

export default async function ModeratorNotificationsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  return (
    <NotificationsSection params={params} portal={"admin" as PortalSegment} />
  );
}
