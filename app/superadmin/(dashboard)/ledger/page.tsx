import LedgerView from "@/components/superadmin/LedgerView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/** Ledger & Audit — scope-guarded Server Component wrapper. */
export default async function SuperadminLedgerPage() {
  const denied = await enforceSuperadminPage("ledger");
  if (denied) return denied;
  return <LedgerView />;
}
