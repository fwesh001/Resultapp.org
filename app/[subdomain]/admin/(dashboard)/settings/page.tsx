import { getTenant } from "@/lib/tenant";
import SettingsForm from "@/components/admin/SettingsForm";

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
