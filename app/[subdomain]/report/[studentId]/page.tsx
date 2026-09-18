import { StudentReportCard } from "@/components/report-card/StudentReportCard";
import { ReportControlBar } from "@/components/report-card/ReportControlBar";
import { getTenant } from "@/lib/tenant";

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
  const effectiveTerm = (term || "Term 1").trim() || "Term 1";

  const school = await getTenant(tenantId);

  const rawStatus =
    ((school as unknown as { subscription_status?: string } | null)?.subscription_status ??
      school?.subscription?.status ??
      "unpaid") as string;
  const isLocked = ["unpaid", "inactive", "past_due"].includes(rawStatus.toLowerCase());

  return (
    <div className="min-h-screen bg-[#0B0514] py-10 px-4 print:bg-white print:py-0">
      {/* Floating Control Bar — hidden during print */}
      <ReportControlBar
        tenantId={tenantId}
        studentId={studentId}
        term={effectiveTerm}
        schoolName={school?.name || null}
      />
      {isLocked && (
        <div className="mx-auto mb-3 flex max-w-4xl justify-center print:hidden">
          <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
            Locked — unpaid • Preview blurred
          </span>
        </div>
      )}

      {/* Digital Paper container is rendered inside StudentReportCard for lock overlay coordination */}
      <StudentReportCard
        tenantId={tenantId}
        studentId={studentId}
        term={effectiveTerm}
        isLocked={isLocked}
        schoolName={school?.name}
      />
    </div>
  );
}
