import { ClearanceSection } from "@/components/admin/sections/ClearanceSection";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Financial Clearance — served under BOTH `/{sub}/admin/clearance` and
 * `/{sub}/moderator/clearance`.
 *
 * RBAC: the capability id is an allow-list entry (see lib/capabilities.ts). A
 * page added without a decision stays unavailable to moderators.
 */
export const requiredCapability = "clearance";
export const dynamic = "force-dynamic";

export default async function ClearancePage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  return (
    <ClearanceSection params={params} portal={"admin" as PortalSegment} />
  );
}
