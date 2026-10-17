import { getTenant } from "@/lib/tenant";
import { enforceAdminCapability } from "@/lib/enforceCapability";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Allocations & Roster — students, staff and subject allocations.
 *
 * Shared by `/{sub}/admin/allocations` and `/{sub}/moderator/allocations`.
 */
export async function AllocationsSection({
  params,
  portal,
}: {
  params: Promise<{ subdomain: string }>;
  portal: PortalSegment;
}) {
  const { subdomain } = await params;

  await enforceAdminCapability(params, "allocations", portal);

  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);
  const { AllocationsManager } = await import(
    "@/components/admin/AllocationsManager"
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-1">
            Allocations &amp; Roster
          </h1>
          <p className="mt-1 text-sm text-text-3">
            Manage students, staff &amp; subject allocations for{" "}
            <span className="font-mono font-medium text-text-1">
              {school?.name || tenantId}
            </span>
            <span className="ml-2 rounded-full border border-line-2 bg-surface-2 px-2.5 py-1 text-xs font-mono text-text-2">
              {tenantId}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-6">
        <AllocationsManager
          tenantId={tenantId}
          idPrefix={school?.idPrefix ?? tenantId.toLowerCase()}
          staffIdPrefix={school?.staffIdPrefix ?? "STAFF/"}
        />
      </div>
    </div>
  );
}