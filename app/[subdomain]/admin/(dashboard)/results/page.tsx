import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import CommandCenterClient from "@/components/admin/CommandCenterClient";

export const dynamic = "force-dynamic";

/**
 * Result Command Center — publication tracking, missing-grade drill-down,
 * staff nudges, and batch publishing (1 credit per newly published card).
 */
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);

  return (
    <CommandCenterClient
      tenantId={tenantId}
      schoolName={school ? toTitleCase(school.name) : tenantId}
    />
  );
}
