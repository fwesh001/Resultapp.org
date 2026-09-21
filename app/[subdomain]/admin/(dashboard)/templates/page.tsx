import { TemplatesManager } from "@/components/admin/TemplatesManager";
import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const tenantId = subdomain.toLowerCase().trim();

  // Optional: verify tenant exists (non-blocking for builder preview)
  const school = await getTenant(tenantId);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          href={`/${tenantId}`}
          className="text-sm text-purple-300 hover:text-white"
        >
          ← Back to {school ? toTitleCase(school.name) : "school portal"}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
          Report Card Templates
        </h1>
        <p className="mt-1 text-sm text-purple-200/60">
          Configure how scores and traits appear on your school&apos;s report
          card. Bind templates to classes or leave them global.
        </p>
        {!school && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
            <ShieldCheck className="h-3 w-3" /> School record for
            &quot;{tenantId}&quot; not found yet — you can still set everything
            up; saving activates once setup completes.
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
