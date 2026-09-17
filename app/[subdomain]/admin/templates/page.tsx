import { TemplateBuilder } from "@/components/forms/TemplateBuilder";
import { getTenant } from "@/lib/tenant";
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
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link href="/" className="text-sm text-purple-300 hover:text-white">
          ← Back to {school?.name || tenantId}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Grading Template Configurator</h1>
        <p className="mt-1 text-sm text-purple-200/60">
          Build the JSON structure that powers your dynamic grading engine. Define categories &gt; items (max scores) and behavioral traits.
        </p>
        {!school && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
            <ShieldCheck className="h-3 w-3" /> Tenant &quot;{tenantId}&quot; not yet provisioned — you can still preview the JSON; save will fail until DB exists.
          </p>
        )}
      </div>

      <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-5 backdrop-blur-xl sm:p-6">
        <TemplateBuilder tenantId={tenantId} />
      </div>

      <p className="mt-4 text-center text-xs text-zinc-500">
        On submit → <span className="font-mono">POST /api/templates</span> → proxy →{" "}
        <span className="font-mono">POST /api/v1/templates</span> with <span className="font-mono">X-API-SECRET-KEY</span>. See FastAPI <code>/docs</code>.
      </p>
    </div>
  );
}
