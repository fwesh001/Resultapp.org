import { PromotionSection } from "@/components/admin/sections/PromotionSection";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * `/{subdomain}/admin/promotion` — close an academic session.
 *
 * The URL keeps the word "promotion" because it names what the admin is doing.
 * The CAPABILITY is `end-of-session`, not `promotion`, because `allocations`
 * already uses "promotion" to mean promoting a staff member to moderator — one
 * word, two unrelated privileges, is how a guard ends up checking the wrong
 * thing.
 *
 * RBAC: `end-of-session` is admin-only (lib/capabilities.ts). It is
 * deliberately NOT in MODERATOR_CAPABILITIES, so the sidebar hides it, this
 * page refuses it, and all four proxies refuse it.
 */
export const requiredCapability = "end-of-session";
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