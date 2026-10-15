import { ResultsSection } from "@/components/admin/sections/ResultsSection";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Result Command Center — served under BOTH `/{sub}/admin/results` and
 * `/{sub}/moderator/results`.
 *
 * RBAC: the capability id is an allow-list entry (see lib/capabilities.ts). A
 * page added without a decision stays unavailable to moderators.
 */
export const requiredCapability = "results";
export const dynamic = "force-dynamic";

export default async function ModeratorResultsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  return (
    <ResultsSection params={params} portal={"moderator" as PortalSegment} />
  );
}
