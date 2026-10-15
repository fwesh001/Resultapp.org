import { PromotionSection } from "@/components/admin/sections/PromotionSection";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * `/{subdomain}/admin/promotion` — close an academic session.
 *
 * RBAC: `promotion` is admin-only (lib/capabilities.ts). It is deliberately NOT
 * in MODERATOR_CAPABILITIES, so the sidebar hides it, this page refuses it, and
 * all four proxies refuse it.
 */
export const requiredCapability = "promotion";
export const dynamic = "force-dynamic";

export default async function PromotionPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  return (
    <PromotionSection params={params} portal={"admin" as PortalSegment} />
  );
}