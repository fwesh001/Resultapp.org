import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { enforceAdminCapability } from "@/lib/enforceCapability";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * Report Card Templates builder.
 *
 * Shared by `/{sub}/admin/templates` and `/{sub}/moderator/templates`.
 */
export async function TemplatesSection({
  params,
  portal,
}: {
  params: Promise<{ subdomain: string }>;
  portal: PortalSegment;
}) {
  const { subdomain } = await params;

  await enforceAdminCapability(params, "templates", portal);

  const tenantId = subdomain.toLowerCase().trim();

  // Optional: verify tenant exists (non-blocking for builder preview).
  const school = await getTenant(tenantId);
  const { TemplatesManager } = await import(
    "@/components/admin/TemplatesManager"
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          href={`/${tenantId}`}
          className="text-sm text-accent hover:text-accent-hover"
        >
          ← Back to {school ? toTitleCase(school.name) : "school portal"}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-text-1">
          Report Card Templates
        </h1>
        <p className="mt-1 text-sm text-text-3">
          Configure how scores and traits appear on your school&apos;s report
          card. Bind templates to classes or leave them global.
        </p>
        {!school && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-2.5 py-1 text-xs text-warning">
            <ShieldCheck className="h-3 w-3" /> School record for
            &quot;{tenantId}&quot; not found yet — you can still set everything up;
            saving activates once setup completes.
          </p>
        )}
      </div>

      <TemplatesManager
        tenantId={tenantId}
        schoolName={school ? toTitleCase(school.name) : undefined}
      />
    </div>
  );
}