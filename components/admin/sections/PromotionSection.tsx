import { getTenant } from "@/lib/tenant";
import { enforceAdminCapability } from "@/lib/enforceCapability";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * End of Session — cohort promotion.
 *
 * ADMIN-ONLY by design. A moderator holds `allocations`, which lets them edit
 * any student row individually, so gating the BULK action here does not stop a
 * deputy hand-promoting a cohort one UPDATE at a time — nothing in this
 * capability model can, and pretending otherwise would be worse. What it does
 * buy is that the cohort-wide, money-affecting, audited path is one deliberate
 * transaction an administrator authorised, rather than forty silent edits.
 *
 * The section is shared with the moderator route so a deputy hitting the URL
 * gets the same explanation the dashboard gives, rather than a bare 403.
 */
export async function PromotionSection({
  params,
  portal,
}: {
  params: Promise<{ subdomain: string }>;
  portal: PortalSegment;
}) {
  const { subdomain } = await params;

  await enforceAdminCapability(params, "promotion", portal);

  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);
  const { default: PromotionWizard } = await import(
    "@/components/admin/PromotionWizard"
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          End of Session
        </h1>
        <p className="mt-1 text-sm text-purple-200/60">
          Promote, repeat, graduate or withdraw the whole cohort for{" "}
          <span className="font-mono font-medium text-white">
            {school?.name || tenantId}
          </span>
          <span className="ml-2 rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-1 text-xs font-mono text-purple-200">
            {tenantId}
          </span>
        </p>
      </div>

      <div className="mt-6">
        <PromotionWizard tenantId={tenantId} />
      </div>
    </div>
  );
}