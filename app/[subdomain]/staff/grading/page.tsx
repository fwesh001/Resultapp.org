import { TeacherDataEntry } from "@/components/forms/TeacherDataEntry";
import { getTenant } from "@/lib/tenant";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StaffGradingPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const tenantId = subdomain.toLowerCase().trim();

  const school = await getTenant(tenantId);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link href="/" className="text-sm text-purple-300 hover:text-white">
          ← Back to {school?.name || tenantId}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Staff Data Entry</h1>
        <p className="mt-1 text-sm text-purple-200/60">
          Select a grading template — the grid renders exactly the assessment items defined in its{" "}
          <span className="font-mono">academic_structure</span> with max-score enforcement.
        </p>
        {!school && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
            <ShieldCheck className="h-3 w-3" /> Tenant &quot;{tenantId}&quot; not yet provisioned — you can still preview templates; saves will fail until DB exists.
          </p>
        )}
      </div>

      <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-5 backdrop-blur-xl sm:p-6">
        <TeacherDataEntry tenantId={tenantId} />
      </div>

      <p className="mt-4 text-center text-xs text-zinc-500">
        Need to configure weights? Go to <Link href={`/${tenantId}/admin/templates`} className="font-mono text-purple-300 underline">/admin/templates</Link> •
        Backend: <span className="font-mono">POST /api/v1/records/academic</span>
      </p>
    </div>
  );
}
