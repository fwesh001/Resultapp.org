import { getTenant } from "@/lib/tenant";
import SettingsForm from "@/components/admin/SettingsForm";
import { enforceAdminCapability } from "@/lib/enforceCapability";


// RBAC: the admin layout reads this to enforce the moderator boundary.
// An allow-list, not a deny-list — a new page without this constant is
// unavailable to moderators until someone grants it.
export const requiredCapability = "settings";
export const dynamic = "force-dynamic";

/**
 * School Profile & Branding — pure Server Component.
 * Fetches the tenant and delegates interactivity to SettingsForm.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

    // RBAC gate. See lib/enforceCapability.ts for why this lives here
    // rather than in the layout: Next does not expose a page's exports to
    // its parent layout, so a layout-level check is always a silent no-op.
    await enforceAdminCapability(params, "settings");
  const school = await getTenant(subdomain);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight">
        School Profile &amp; Branding
      </h1>
      <p className="mt-1 text-sm text-purple-200/60">
        Update your school&apos;s public profile and report-card branding.
      </p>

      <SettingsForm school={school} />
    </div>
  );
}
