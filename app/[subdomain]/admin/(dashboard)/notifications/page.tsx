import { Suspense } from "react";
import { getTenant } from "@/lib/tenant";
import NotificationInbox from "@/components/notifications/NotificationInbox";

export const dynamic = "force-dynamic";

/** Tenant Admin dedicated inbox (Server Component resolves subdomain → client inbox). */
export default async function AdminNotificationsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: routeSubdomain } = await params;
  const school = await getTenant(routeSubdomain);
  const subdomain = school?.slug ?? routeSubdomain.toLowerCase().trim();

  return (
    <Suspense fallback={<p className="p-8 text-sm text-zinc-400">Loading notifications…</p>}>
      <NotificationInbox tenantId={subdomain} basePath={`/${subdomain}/admin`} portal="admin" />
    </Suspense>
  );
}
