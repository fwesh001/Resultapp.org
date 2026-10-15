import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import { enforceAdminCapability } from "@/lib/enforceCapability";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Result Command Center — publication tracking, missing-grade drill-down, staff
 * nudges, and batch publishing (1 credit per newly published card).
 *
 * Shared by `/{sub}/admin/results` and `/{sub}/moderator/results`. The ONLY
 * difference between those two URLs is the `portal` argument, which decides
 * where a rejection redirect lands. Anything else — which capability is
 * required, what renders — is identical by construction, so the two portals
 * cannot drift apart in what they expose.
 */
export async function ResultsSection({
  params,
  portal,
}: {
  params: Promise<{ subdomain: string }>;
  portal: PortalSegment;
}) {
  const { subdomain } = await params;

  // RBAC gate. See lib/enforceCapability.ts for why this lives in the page
  // rather than the layout: Next does not expose a page's exports to its parent
  // layout, so a layout-level check is always a silent no-op.
  await enforceAdminCapability(params, "results", portal);

  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);

  // Lazy import keeps CommandCenterClient (a heavy client component) out of the
  // server module graph for routes that never render it.
  const { default: CommandCenterClient } = await import(
    "@/components/admin/CommandCenterClient"
  );

  return (
    <CommandCenterClient
      tenantId={tenantId}
      schoolName={school ? toTitleCase(school.name) : tenantId}
      initialTerm={school?.currentTerm?.trim() || "Term 1"}
      portal={portal}
    />
  );
}