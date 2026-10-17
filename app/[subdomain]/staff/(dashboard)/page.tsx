import { redirect } from "next/navigation";
import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { getStaffDashboard } from "@/lib/staffDashboard";
import { readStaffSession } from "@/lib/staffAuth";
import { BookOpen, Users, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Staff dashboard page.
 *
 * Uses the shared `readStaffSession` guard: signature verified, and
 * `tenant_id` must match this portal. The previous inline version parsed the
 * cookie with no signature check and then fell back to the URL subdomain when
 * `tenant_id` was absent, so an unsigned cookie scoped to no tenant at all
 * still rendered a dashboard (LEGAL_REMEDIATION.md P0-0).
 */
export default async function StaffDashboardPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  const identity = await readStaffSession(subdomain);
  if (!identity) {
    redirect(`/${subdomain}/staff/login`);
  }

  // staff_id preferred for the backend OR query; falls back to the row UUID.
  const staffId = identity.staffId;
  // No fallback to the URL subdomain — a session without a tenant is rejected
  // by readStaffSession rather than silently adopted.
  const tenantForFetch = identity.tenantId;

  const [school, dashboard] = await Promise.all([
    getTenant(subdomain).catch(() => null),
    getStaffDashboard(tenantForFetch, staffId).catch(() => null),
  ]);

  const allocations = dashboard?.allocations || [];
  const formClasses = dashboard?.form_classes || [];
  const initialTerm = school?.currentTerm?.trim() || "Term 1";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-1">
          Welcome back, {identity.fullName || identity.staffId}
        </h1>
        <p className="mt-1 text-sm text-text-3">
          {identity.staffId}
          {identity.role ? ` • ${identity.role}` : ""} • {school?.name || subdomain}.resultapp.org
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-3">My Subjects</h2>
        {allocations.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-warning/30 bg-warning-soft p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-warning" />
            <h3 className="mt-3 text-sm font-semibold text-text-1">No allocations yet</h3>
            <p className="mt-1 text-sm text-text-3">Your Principal hasn&apos;t assigned any classes. Please check back later or contact admin.</p>
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allocations.map((a) => (
              <div
                key={a.id}
                className="rounded-2xl border border-line-1 bg-surface-1 p-5 backdrop-blur hover:bg-surface-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft ring-1 ring-accent/30">
                  <BookOpen className="h-5 w-5 text-accent" />
                </div>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-text-3">{a.class_name}</p>
                <h3 className="mt-1 text-base font-semibold text-text-1">{a.subject_name}</h3>
                <p className="mt-1 text-xs text-text-3">Assigned as {a.staff_name}</p>
                <Link
                  href={`/${subdomain}/staff/grading/${encodeURIComponent(a.class_name)}/${encodeURIComponent(a.subject_name)}?term=${encodeURIComponent(initialTerm)}`}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full bg-accent py-2 text-sm font-medium text-accent-fg transition hover:bg-accent-hover"
                >
                  <FileText className="h-4 w-4" /> Open Grading Sheet
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {formClasses.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-success">My Form Class</h2>
          <p className="mt-1 text-sm text-text-3">Behavioural traits and remarks only — academic subjects are hidden here.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {formClasses.map((f) => (
              <div
                key={f.class_name}
                className="rounded-2xl border border-line-1 bg-surface-1 p-5 hover:bg-surface-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft ring-1 ring-success/30">
                  <Users className="h-5 w-5 text-success" />
                </div>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-success">Form Teacher</p>
                <h3 className="mt-1 text-base font-semibold text-text-1">{f.class_name}</h3>
                <Link
                  href={`/${subdomain}/staff/forms/${encodeURIComponent(f.class_name)}?term=${encodeURIComponent(initialTerm)}`}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full bg-emerald-600 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
                >
                  <FileText className="h-4 w-4" /> Open Behavioural Grid
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
