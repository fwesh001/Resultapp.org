import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import { enforceAdminCapability } from "@/lib/enforceCapability";
import AuditLogClient from "./AuditLogClient";

export const dynamic = "force-dynamic";

export const requiredCapability = "audit";

export default async function AuditPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params;

  // RBAC gate. See lib/enforceCapability.ts for why this lives here rather
  // than in the layout: Next does not expose a page's exports to its parent
  // layout, so a layout-level check is always a silent no-op.
  await enforceAdminCapability(params, "audit");

  const school = await getTenant(subdomain);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
      <p className="mt-1 text-sm text-text-2">
        Who changed what, and when. Append-only — entries cannot be edited or
        removed from this portal.
      </p>

      <AuditLogClient tenantId={subdomain} schoolName={school?.name ? toTitleCase(school.name) : subdomain} />
    </div>
  );
}