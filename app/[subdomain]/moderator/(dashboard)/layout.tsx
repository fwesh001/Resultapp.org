import { PortalDashboardLayout } from "@/components/admin/PortalDashboardLayout";

export const dynamic = "force-dynamic";

/**
 * Guarded Moderator Console layout.
 *
 * Same shared body as the admin portal, one argument different. See
 * components/admin/PortalDashboardLayout.tsx for why it is shared and why
 * capability enforcement is NOT here.
 */
export default async function ModeratorDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  return (
    <PortalDashboardLayout params={params} portal="moderator">
      {children}
    </PortalDashboardLayout>
  );
}