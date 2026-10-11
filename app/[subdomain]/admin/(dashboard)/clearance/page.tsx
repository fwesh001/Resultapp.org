import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import ClearanceManager from "@/components/admin/ClearanceManager";
import { enforceAdminCapability } from "@/lib/enforceCapability";


// RBAC: the admin layout reads this to enforce the moderator boundary.
// An allow-list, not a deny-list — a new page without this constant is
// unavailable to moderators until someone grants it.
export const requiredCapability = "clearance";
export const dynamic = "force-dynamic";

/**
 * Financial Clearance — the bursary dashboard.
 *
 * Admin-only (there is no Bursar role yet; see the note in
 * components/admin/ClearanceManager.tsx). Lets the school hold a student's
 * published result when fees are unpaid, per academic term.
 */
export default async function ClearancePage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

    // RBAC gate. See lib/enforceCapability.ts for why this lives here
    // rather than in the layout: Next does not expose a page's exports to
    // its parent layout, so a layout-level check is always a silent no-op.
    await enforceAdminCapability(params, "clearance");
  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);

  return (
    <div className="min-h-screen bg-surface-0 px-4 py-10 sm:px-6 lg:px-8">
      <ClearanceManager
        tenantId={tenantId}
        schoolName={school?.name ? toTitleCase(school.name) : tenantId}
      />
    </div>
  );
}