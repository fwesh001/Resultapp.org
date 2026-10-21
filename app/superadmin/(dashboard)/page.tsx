import DashboardView from "@/components/superadmin/DashboardView";
import { enforceSuperadminPage } from "@/lib/superadminGuard";

export const dynamic = "force-dynamic";

/**
 * Command Center Dashboard — scope-guarded Server Component wrapper.
 *
 * The client view holds all interactivity; this server component owns the one
 * check a layout cannot perform (Next does not expose a page's routes or
 * exports to its layout — see lib/superadminGuard.tsx). A member without the
 * "dashboard" page gets the inline denial (no redirect: the index is the
 * denial landing page and cannot point at itself).
 */
export default async function SuperadminDashboardIndexPage() {
  const denied = await enforceSuperadminPage("dashboard");
  if (denied) return denied;
  return <DashboardView />;
}
