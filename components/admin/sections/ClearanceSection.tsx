import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import { enforceAdminCapability } from "@/lib/enforceCapability";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Financial Clearance — the bursary dashboard.
 *
 * Shared by `/{sub}/admin/clearance` and `/{sub}/moderator/clearance`. Admin-only
 * in the sense that there is no Bursar role yet (see the note in
 * components/admin/ClearanceManager.tsx); `clearance` is in the moderator list,
 * so deputies can hold a student's published result when fees are unpaid.
 */
export async function ClearanceSection({
  params,
  portal,
}: {
  params: Promise<{ subdomain: string }>;
  portal: PortalSegment;
}) {
  const { subdomain } = await params;

  await enforceAdminCapability(params, "clearance", portal);

  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);
  const { default: ClearanceManager } = await import(
    "@/components/admin/ClearanceManager"
  );

  return (
    <div className="min-h-screen bg-surface-0 px-4 py-10 sm:px-6 lg:px-8">
      <ClearanceManager
        tenantId={tenantId}
        schoolName={school?.name ? toTitleCase(school.name) : tenantId}
      />
    </div>
  );
}