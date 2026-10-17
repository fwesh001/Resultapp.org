import { Suspense } from "react";
import { getTenant } from "@/lib/tenant";
import NotificationInbox from "@/components/notifications/NotificationInbox";
import { enforceAdminCapability } from "@/lib/enforceCapability";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Dedicated notification inbox, shared by `/{sub}/admin/notifications` and
 * `/{sub}/moderator/notifications`.
 *
 * NOTE THE DELIBERATE ASYMMETRY IN `portal` vs `basePath`:
 *
 *   portal={portal}            -> identity. The derived moderator session lives
 *                                  in the ADMIN cookie, so the inbox must ask
 *                                  for that identity even on the moderator
 *                                  console. Passing "moderator" here would fall
 *                                  back to the default admin-then-staff order,
 *                                  which happens to be right today and would
 *                                  silently break the moment a moderator's admin
 *                                  cookie expired.
 *   basePath={`/${sub}/${portal}`} -> navigation. Back-links inside the inbox
 *                                  must stay in the portal the user is in.
 */
export async function NotificationsSection({
  params,
  portal,
}: {
  params: Promise<{ subdomain: string }>;
  portal: PortalSegment;
}) {
  const { subdomain: routeSubdomain } = await params;

  await enforceAdminCapability(params, "notifications", portal);

  const school = await getTenant(routeSubdomain);
  const subdomain = school?.slug ?? routeSubdomain.toLowerCase().trim();

  return (
    <Suspense
      fallback={
        <p className="p-8 text-sm text-text-3">Loading notifications…</p>
      }
    >
      <NotificationInbox
        tenantId={subdomain}
        basePath={`/${subdomain}/${portal}`}
        portal="admin"
      />
    </Suspense>
  );
}