import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import BillingClient from "@/components/billing/BillingClient";
import { enforceAdminCapability } from "@/lib/enforceCapability";


// RBAC: the admin layout reads this to enforce the moderator boundary.
// An allow-list, not a deny-list — a new page without this constant is
// unavailable to moderators until someone grants it.
export const requiredCapability = "billing";
export const dynamic = "force-dynamic";

/**
 * Billing & Credits — 100% credit-ledger focused.
 * Legacy subscription_status is intentionally not displayed here;
 * the single source of truth is schools.credit_balance + credit_ledger.
 */
export default async function BillingPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

    // RBAC gate. See lib/enforceCapability.ts for why this lives here
    // rather than in the layout: Next does not expose a page's exports to
    // its parent layout, so a layout-level check is always a silent no-op.
    await enforceAdminCapability(params, "billing");
  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);

  return (
    // Matches the Dashboard wrapper exactly: one max-width, one horizontal
    // gutter, no height of its own.
    //
    // This used to be `min-h-screen bg-surface-0 px-4 py-10 sm:px-6 lg:px-8`,
    // which stacked two full-height columns: AdminShell's <main> is already
    // `flex-1 overflow-y-auto`, so min-h-screen made the inner column at least
    // as tall as the viewport INSIDE a box that was itself viewport-tall. On
    // mobile that produced an inner scrollbar with the page's own scroll
    // behind it, and the background colour stopped at the fold instead of
    // running to the bottom. Both gutters (this one plus BillingClient's own
    // px-4) also doubled the mobile inset, so content sat noticeably further
    // from the edge than on the Dashboard.
    <div className="mx-auto max-w-6xl px-6 py-8">
      <BillingClient
        tenantId={tenantId}
        schoolName={school?.name ? toTitleCase(school.name) : tenantId}
        customerEmail={school?.email || `${tenantId}@resultapp.org`}
        customerName={school?.proprietorName || school?.name || tenantId}
      />
    </div>
  );
}
