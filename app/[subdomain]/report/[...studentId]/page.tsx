import { StudentReportCard } from "@/components/report-card/StudentReportCard";
import { ReportControlBar } from "@/components/report-card/ReportControlBar";
import { getTenant } from "@/lib/tenant";
import { currentAcademicSession } from "@/lib/format";
import { hasAdminSession } from "@/lib/adminAuth";
import SuspendedPortal from "@/components/tenants/SuspendedPortal";

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
 * result_publications for (tenant, student, term, session).
 *
 * Since P0-1 the *data* is gated server-side too, not just this banner:
 * /api/report asks the backend for include_draft only when this page's
 * viewer is a signed-in admin of the tenant. For everyone else the backend
 * returns 404 for an unpublished result, byte-identical to the 404 for an
 * unknown student, so an anonymous visitor cannot distinguish the two.
 *
 * VIEWER SCOPE (UI leak fix): this page resolves `viewer` from the httpOnly
 * session cookie and passes it down as the single authority. The Result
 * Command Center / draft-pill UI renders for viewer === "admin" and nothing
 * else. Previously a public 404 fell through an error branch that was gated on
 * `!isPublished` alone, which leaked the admin draft UI to students. The card
 * now derives one discriminated state and defaults to "public" on any failure.
 */
function normalizeStudentId(raw: string | string[]): string {
  let s: string;
  if (Array.isArray(raw)) {
    // Catch-all: join segments — handles raw slash VHS/005 (["vhs","005"]) and encoded vhs%2F005
    s = raw.map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    }).join("/");
  } else {
    try {
      s = decodeURIComponent(raw);
    } catch {
      s = raw;
    }
  }
  s = s.trim();
  const slashIdx = s.indexOf("/");
  if (slashIdx > -1) {
    return s.slice(0, slashIdx).toLowerCase() + s.slice(slashIdx);
  }
  const m = s.match(/^([A-Za-z]+)(.*)$/);
  if (m) return m[1].toLowerCase() + m[2];
  return s.toLowerCase();
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ subdomain: string; studentId: string | string[] }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { subdomain, studentId: rawStudentId } = await params;
  const { term } = await searchParams;

  const tenantId = subdomain.toLowerCase().trim();
  const studentId = normalizeStudentId(rawStudentId);
  const derivedSession = currentAcademicSession();

  const school = await getTenant(tenantId);
  // Default-plus-override: explicit ?term wins, else the admin's global term.
  const requestedTerm = (term || "").trim();
  const globalTerm = school?.currentTerm?.trim() || "Term 1";
  const effectiveTerm = requestedTerm || globalTerm;
  // Session resolution must match the backend gate exactly: the tenant's
  // configured session wins, otherwise the derived one. The backend reads
  // schools.current_session for the same reason.
  const effectiveSession = school?.currentSession?.trim() || derivedSession;

  // Suspended tenants: report cards blocked for everyone except a signed-in
  // tenant admin (who keeps the billing hatch via the portal link below).
  if (school && school.isActive === false) {
    const showBilling = await hasAdminSession(tenantId);
    return <SuspendedPortal schoolName={school.name} subdomain={tenantId} showBillingLink={showBilling} />;
  }

  // Admin preview: a signed-in admin for THIS tenant gets the draft bundle and
  // the draft overlay. Resolved once and reused for the pill below, so the two
  // can never disagree.
  const isAdminPreview = await hasAdminSession(tenantId);

  // Single viewer scope handed to the card. This is the ONLY authority for
  // admin-only UI (the Result Command Center): it comes from the httpOnly
  // session cookie, resolved here server-side, and the client re-decides
  // nothing. Defaulting to "public" on any failure keeps the leak closed.
  const viewer: "admin" | "public" = isAdminPreview ? "admin" : "public";

  // Whether the visitor actually chose a term. When they did not, the page
  // fell back to the tenant's configured default term, which lets the public
  // "Result Not Available" card offer a term picker (Option 3).
  const termWasExplicit = requestedTerm.length > 0;

  // Publication check (server-side — no hydration flash, no client cost).
  let isPublished = false;
  try {
    const secret = getProxySecret();
    if (secret) {
      const qs = new URLSearchParams({
        student_id: studentId,
        term: effectiveTerm,
        academic_session: effectiveSession,
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
{!isPublished && viewer === "admin" && (
        <div className="mx-auto mb-3 flex max-w-4xl justify-center print:hidden">
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            Draft preview • Not yet published — printing unlocks on publication
          </span>
        </div>
      )}

      {/* Digital Paper container is rendered inside StudentReportCard for lock overlay coordination */}
      <StudentReportCard
        key={`${tenantId}-${studentId}-${effectiveTerm}`}
        tenantId={tenantId}
        studentId={studentId}
        term={effectiveTerm}
        isPublished={isPublished}
        viewer={viewer}
        termWasExplicit={termWasExplicit}
        schoolName={school?.name}
        schoolLogoUrl={school?.logoUrl}
        schoolMotto={school?.motto}
        schoolEmail={school?.email}
        schoolPhone={school?.phone}
      />
    </div>
  );
}
