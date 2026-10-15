import { PortalDashboardLayout } from "@/components/admin/PortalDashboardLayout";

export const dynamic = "force-dynamic";

/**
 * Guarded admin dashboard layout — a thin wrapper around the shared
 * PortalDashboardLayout.
 *
 * ══ STALE DOCBLOCK, KEPT DELIBERATELY ══
 * This file previously claimed: "Each page exports `requiredCapability`. Next.js
 * gives a layout access to the child segment's exports, so the check lives
 * here, in ONE place." That is FALSE, and 40 lines further down the same file
 * explained why — Next 16 does not expose a page's exports to its parent layout,
 * verified live with a probe. Two contradictory stories sat in one file, and the
 * confident-sounding one was the wrong one.
 *
 * The false claim has been deleted. Capability enforcement lives in the page
 * (enforceAdminCapability) and the proxy (requireAdminCapability); see
 * components/admin/PortalDashboardLayout.tsx for the full reasoning.
 */
export default async function AdminDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  return (
    <PortalDashboardLayout params={params} portal="admin">
      {children}
    </PortalDashboardLayout>
  );
}