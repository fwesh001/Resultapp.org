import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import BillingClient from "@/components/billing/BillingClient";

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
  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);

  return (
    <div className="min-h-screen bg-[#0B0514] px-4 py-10 sm:px-6 lg:px-8">
      <BillingClient
        tenantId={tenantId}
        schoolName={school?.name ? toTitleCase(school.name) : tenantId}
        customerEmail={school?.email || `${tenantId}@resultapp.org`}
        customerName={school?.proprietorName || school?.name || tenantId}
      />
    </div>
  );
}
