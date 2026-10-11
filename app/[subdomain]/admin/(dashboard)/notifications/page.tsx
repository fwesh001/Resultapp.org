import { Suspense } from "react";
import { getTenant } from "@/lib/tenant";
import NotificationInbox from "@/components/notifications/NotificationInbox";
import { enforceAdminCapability } from "@/lib/enforceCapability";


// RBAC: the admin layout reads this to enforce the moderator boundary.
// An allow-list, not a deny-list — a new page without this constant is
// unavailable to moderators until someone grants it.
export const requiredCapability = "notifications";
export const dynamic = "force-dynamic";

/** Tenant Admin dedicated inbox (Server Component resolves subdomain → client inbox). */
export default async function AdminNotificationsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: routeSubdomain } = await params;

    // RBAC gate. See lib/enforceCapability.ts for why this lives here
    // rather than in the layout: Next does not expose a page's exports to
    // its parent layout, so a layout-level check is always a silent no-op.
    await enforceAdminCapability(params, "notifications");
  const school = await getTenant(routeSubdomain);
  const subdomain = school?.slug ?? routeSubdomain.toLowerCase().trim();

  return (
    <Suspense fallback={<p className="p-8 text-sm text-zinc-400">Loading notifications…</p>}>
      <NotificationInbox tenantId={subdomain} basePath={`/${subdomain}/admin`} portal="admin" />
    </Suspense>
  );
}
