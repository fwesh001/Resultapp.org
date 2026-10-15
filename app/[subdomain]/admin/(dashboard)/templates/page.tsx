import { TemplatesSection } from "@/components/admin/sections/TemplatesSection";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Report Card Templates — served under BOTH `/{sub}/admin/templates` and
 * `/{sub}/moderator/templates`.
 *
 * RBAC: the capability id is an allow-list entry (see lib/capabilities.ts). A
 * page added without a decision stays unavailable to moderators.
 */
export const requiredCapability = "templates";
export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  return (
    <TemplatesSection params={params} portal={"admin" as PortalSegment} />
  );
}
