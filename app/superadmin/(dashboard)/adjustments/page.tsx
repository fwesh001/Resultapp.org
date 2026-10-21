import AdjustmentsView from "@/components/superadmin/AdjustmentsView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/**
 * Credit & Slot Adjustments — scope-guarded Server Component wrapper.
 *
 * Allocate/deduct with a required reason; every successful adjustment writes
 * a billing_ledger row, an audit entry attributed to the acting member, and
 * dispatches TOKEN_ADJUSTED to the school's admin bell. Deductions that would
 * take a balance negative are rejected server-side and surfaced here.
 */
export default async function SuperadminAdjustmentsPage() {
  const denied = await enforceSuperadminPage("adjustments");
  if (denied) return denied;
  return <AdjustmentsView />;
}
