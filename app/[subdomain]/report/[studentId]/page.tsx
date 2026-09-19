import { StudentReportCard } from "@/components/report-card/StudentReportCard";
import { ReportControlBar } from "@/components/report-card/ReportControlBar";
import { getTenant } from "@/lib/tenant";
import { currentAcademicSession } from "@/lib/format";

export const dynamic = "force-dynamic";

function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

function getProxySecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

/**
 * Report page — Credit & Command publication gate.
 *
 * A report card is fully unlocked ONLY when the backend confirms a row in
 * result_publications for (tenant, student, term, session). Everything else
 * renders as a free "Draft — Pending Publication" preview (blurred, no print).
 */
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
  const session = currentAcademicSession();

  const school = await getTenant(tenantId);

  // Publication check (server-side — no hydration flash, no client cost).
  let isPublished = false;
  try {
    const secret = getProxySecret();
    if (secret) {
      const qs = new URLSearchParams({
        student_id: studentId,
        term: effectiveTerm,
        academic_session: session,
      });
      const res = await fetch(
        `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(tenantId)}/credits/publications?${qs.toString()}`,
        { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        isPublished = (data as { published?: boolean }).published === true;
      }
    }
  } catch {
    // Fail closed: backend unreachable → draft preview (free, unprintable).
    isPublished = false;
  }

  return (
    <div className="min-h-screen bg-[#0B0514] py-10 px-4 print:bg-white print:py-0">
      {/* Floating Control Bar — hidden during print */}
      <ReportControlBar
        tenantId={tenantId}
        studentId={studentId}
        term={effectiveTerm}
        schoolName={school?.name || null}
        canPrint={isPublished}
      />
      {!isPublished && (
        <div className="mx-auto mb-3 flex max-w-4xl justify-center print:hidden">
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            Draft preview • Not yet published — free to view, printing unlocks on publication
          </span>
        </div>
      )}

      {/* Digital Paper container is rendered inside StudentReportCard for lock overlay coordination */}
      <StudentReportCard
        tenantId={tenantId}
        studentId={studentId}
        term={effectiveTerm}
        isPublished={isPublished}
        schoolName={school?.name}
      />
    </div>
  );
}
