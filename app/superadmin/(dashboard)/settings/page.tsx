import SettingsView from "@/components/superadmin/SettingsView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/**
 * Global Settings — scope-guarded Server Component wrapper.
 *
 * Tabbed client view behind this wrapper: Billing (credit price, free
 * credits) and Security (change own password), matching the school admin
 * settings shape (tab list + sibling panels, never nested forms).
 */
export default async function SuperadminSettingsPage() {
  const denied = await enforceSuperadminPage("settings");
  if (denied) return denied;
  return <SettingsView />;
}
