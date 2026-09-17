import { StudentReportCard } from "@/components/report-card/StudentReportCard";
import { getTenant } from "@/lib/tenant";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ subdomain: string; studentId: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { subdomain, studentId } = await params;
  const { term } = await searchParams;

  const tenantId = subdomain.toLowerCase().trim();
  // Decision 4: default to "Term 1" if missing
  const effectiveTerm = (term || "Term 1").trim() || "Term 1";

  const school = await getTenant(tenantId);

  // Phase 3: Blurred Preview Billing Gate — server-side evaluation (prevents client tamper)
  // Locked for unpaid/inactive/past_due (future-proof per decision 2); default 'unpaid' if missing
  const rawStatus =
    ((school as unknown as { subscription_status?: string } | null)?.subscription_status ??
      school?.subscription?.status ??
      "unpaid") as string;
  const isLocked = ["unpaid", "inactive", "past_due"].includes(rawStatus.toLowerCase());

  return (
    <div className="min-h-screen bg-zinc-50 print:bg-white">
      {/* Top nav — hidden on print */}
      <div className="mx-auto max-w-5xl px-4 py-4 print:hidden">
        <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">
          ← Back to {school?.name || tenantId}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 font-mono">
            {tenantId} • {studentId} • {effectiveTerm}
          </span>
          {isLocked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              Locked — unpaid
            </span>
          )}
          <span className="hidden sm:inline">Append ?term=Term 2 to switch term.</span>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-8 print:px-0 print:pb-0">
        <StudentReportCard tenantId={tenantId} studentId={studentId} term={effectiveTerm} isLocked={isLocked} />
      </div>
    </div>
  );
}
