import { Suspense } from "react";
import { getTenant } from "@/lib/tenant";
import NotificationInbox from "@/components/notifications/NotificationInbox";

export const dynamic = "force-dynamic";

/** Tenant Staff dedicated inbox (Server Component resolves subdomain → client inbox). */
export default async function StaffNotificationsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: routeSubdomain } = await params;
  const school = await getTenant(routeSubdomain);
  const subdomain = school?.slug ?? routeSubdomain.toLowerCase().trim();

  return (
    <Suspense fallback={<p className="p-8 text-sm text-zinc-400">Loading notifications…</p>}>
      <NotificationInbox tenantId={subdomain} basePath={`/${subdomain}/staff`} />
    </Suspense>
  );
}
