import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import ClearanceManager from "@/components/admin/ClearanceManager";

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
  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);

  return (
    <div className="min-h-screen bg-[#0B0514] px-4 py-10 sm:px-6 lg:px-8">
      <ClearanceManager
        tenantId={tenantId}
        schoolName={school?.name ? toTitleCase(school.name) : tenantId}
      />
    </div>
  );
}