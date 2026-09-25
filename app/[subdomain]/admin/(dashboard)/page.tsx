import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { toTitleCase, currentAcademicSession } from "@/lib/format";
import {
  Users,
  UserCheck,
  Coins,
  CalendarDays,
  Plus,
  Wallet,
  FileBarChart,
} from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Principal / Administrator overview dashboard (Server Component).
 * Renders real tenant data via getTenant.
 */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: routeSubdomain } = await params;
  const school = await getTenant(routeSubdomain);
  const subdomain = school?.slug ?? routeSubdomain;

  // Live wiring — subscription card retired in favor of dual-ledger.
  const currentTerm = school?.currentTerm ?? "Term 1";
  const currentSession = school?.currentSession ?? currentAcademicSession();
  // Fetch live counts best-effort (server-side, no-store so publish revalidates via school tag).
  // liveOk gates every derived stat: on failure we render an explicit
  // "unavailable" state instead of authoritative-looking zeros (Bug 1 fix).
  let liveOk = false;
  let liveStudents = 0;
  let liveActiveStaff = 0;
  let livePublished = 0;
  let liveCompletion = 0;
  let liveSession = currentSession;
  try {
    const base = (process.env.BACKEND_URL || "http://159.223.178.34:8000").replace(/\/$/, "");
    const secret = (process.env.BACKEND_API_SECRET || process.env.PROVISION_API_SECRET || process.env.API_SECRET_KEY || "").trim();
    if (!secret) {
      console.error(`[admin dashboard] summary fetch skipped for '${subdomain}': missing BACKEND_API_SECRET`);
    } else {
      const qs = new URLSearchParams({ term: currentTerm, academic_session: currentSession });
      const r = await fetch(`${base}/api/v1/tenant/${encodeURIComponent(subdomain)}/command-center/summary?${qs.toString()}`, {
        headers: { "X-API-SECRET-KEY": secret },
        cache: "no-store",
      });
      if (r.ok) {
        const d = (await r.json()) as {
          total_students?: number; published_count?: number; completion_pct?: number;
          academic_session?: string; active_staff?: number;
        };
        liveStudents = d.total_students ?? 0;
        livePublished = d.published_count ?? 0;
        liveCompletion = d.completion_pct ?? 0;
        liveSession = d.academic_session ?? currentSession;
        liveActiveStaff = d.active_staff ?? 0;
        liveOk = true;
      } else {
        console.error(`[admin dashboard] summary fetch failed for '${subdomain}': upstream status ${r.status}`);
      }
    }
  } catch (e) {
    console.error(`[admin dashboard] summary fetch errored for '${subdomain}': ${e instanceof Error ? e.message : "network failure"}`);
  }
  // Fallback: derive slot capacity from schools row when command-center is unreachable
  const slotCapacity = school?.slotsBalance ?? school?.credits?.totalPurchased ?? 0;
  // Used slots come strictly from the live summary (no derivation when
  // unreachable — the cards below render "unavailable" instead of zeros).
  const displayUsed = liveOk ? liveStudents : 0;
  const displayCapacity = slotCapacity > 0 ? slotCapacity : Math.max(displayUsed, 0);
  const remaining = Math.max(0, displayCapacity - displayUsed);

  const stats = [
    {
      label: "Slots",
      value: liveOk ? `${displayUsed} / ${displayCapacity} Slots` : "—",
      sub: liveOk ? `${remaining} remaining` : "Stats unavailable",
      icon: Users,
    },
    {
      label: "Active Staff",
      value: liveOk ? String(liveActiveStaff) : "—",
      sub: liveOk ? undefined : "Stats unavailable",
      icon: UserCheck,
    },
    {
      label: "Publishing Credits",
      value: String(school?.creditBalance ?? 0),
      icon: Coins,
    },
    {
      label: "Current Term",
      value: `${currentTerm}, ${liveSession}`,
      icon: CalendarDays,
    },
  ];

  const quickActions = [
    {
      label: "Add Student",
      href: `/${subdomain}/admin/allocations`,
      icon: Plus,
    },
    {
      label: "Top-up Credits",
      href: `/${subdomain}/admin/billing`,
      icon: Wallet,
    },
    {
      label: "View Reports",
      href: `/${subdomain}/admin/results`,
      icon: FileBarChart,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Overview Dashboard
        </h1>
        <p className="mt-1 text-sm text-purple-200/60">
          Welcome back
          {school ? `, ${toTitleCase(school.name)}` : ""} — here is what is
          happening across your school today.
        </p>
      </div>

      {/* Top stats — 4 cols */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const sub = (stat as { sub?: string }).sub;
          return (
            <div
              key={stat.label}
              className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/15 bg-purple-600/10">
                  <Icon className="h-5 w-5 text-purple-300" />
                </span>
                <p className="text-xs text-purple-200/60">{stat.label}</p>
              </div>
              <p className="mt-3 text-2xl font-bold">{stat.value}</p>
              {sub && <p className="mt-1 text-xs text-purple-300/50">{sub}</p>}
            </div>
          );
        })}
      </div>

      {/* Middle — 2 cols */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Quick Actions */}
        <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-6">
          <h2 className="text-base font-semibold">Quick Actions</h2>
          <p className="mt-1 text-sm text-purple-200/60">
            Jump into common admin workflows.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-600/10 px-4 py-2 text-sm font-medium text-purple-200 transition hover:bg-purple-600/20 hover:text-white"
                >
                  <Icon className="h-4 w-4" />
                  {action.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Publication Progress */}
        <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Publication Progress</h2>
            <span className="text-sm font-semibold text-purple-300">
              {liveOk ? `${liveCompletion}% complete` : "Stats unavailable"}
            </span>
          </div>
          <p className="mt-1 text-sm text-purple-200/60">
            {liveOk
              ? `${livePublished} of ${displayUsed || liveStudents} results published • ${currentTerm} ${liveSession}`
              : `Could not reach live data • ${currentTerm} ${liveSession}`}
          </p>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-purple-500"
              style={{ width: `${liveOk ? Math.min(100, liveCompletion) : 0}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-purple-200/50">
            {liveOk
              ? `${livePublished} of ${displayUsed || liveStudents} results published.`
              : "Publication stats unavailable."}
          </p>
        </div>
      </div>
    </div>
  );
}
