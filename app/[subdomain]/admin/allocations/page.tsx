import { getTenant } from "@/lib/tenant";
import { AllocationsManager } from "@/components/admin/AllocationsManager";

export const dynamic = "force-dynamic";

export default async function AllocationsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Allocations & Roster</h1>
          <p className="mt-1 text-sm text-purple-200/60">
            Manage students, staff & subject allocations for{" "}
            <span className="font-mono font-medium text-white">{school?.name || tenantId}</span>
            <span className="ml-2 rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-1 text-xs font-mono text-purple-200">
              {tenantId}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-6">
        <AllocationsManager tenantId={tenantId} idPrefix={school?.idPrefix ?? tenantId.toUpperCase()} />
      </div>
    </div>
  );
}
