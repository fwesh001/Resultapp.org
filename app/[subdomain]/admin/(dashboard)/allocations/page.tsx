import { AllocationsSection } from "@/components/admin/sections/AllocationsSection";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Allocations and Roster — served under BOTH `/{sub}/admin/allocations` and
 * `/{sub}/moderator/allocations`.
 *
 * RBAC: the capability id is an allow-list entry (see lib/capabilities.ts). A
 * page added without a decision stays unavailable to moderators.
 */
export const requiredCapability = "allocations";
export const dynamic = "force-dynamic";

export default async function AllocationsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  return (
    <AllocationsSection params={params} portal={"admin" as PortalSegment} />
  );
}
