import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { toTitleCase, currentAcademicSession } from "@/lib/format";
import { ExportDataCard } from "@/components/admin/ExportDataCard";
import {
  Users,
  UserCheck,
  Coins,
  CalendarDays,
  Plus,
  Wallet,
  FileBarChart,
} from "lucide-react";
import { enforceAdminCapability } from "@/lib/enforceCapability";
import { readAdminIdentity } from "@/lib/adminAuth";
import type { PortalSegment } from "@/components/admin/AdminSidebar";

/**
 * ══ WHY `?denied=` WAS INVISIBLE ══
 * `enforceAdminCapability` has always redirected a missing capability to the
 * dashboard with `?denied=<capability>` attached. No page ever READ that query
 * parameter, so the redirect produced a pristine dashboard and the user was left
 * to conclude the feature was broken. The guard worked; the explanation did not
 * exist. The map below is that missing explanation.
 */
const DENIAL_COPY: Record<string, { title: string; body: string }> = {
  settings: {
    title: "School settings are administrator-only",
    body: "Changing your school profile and report-card branding affects every student, so it stays with the school's administrator.",
  },
  billing: {
    title: "Billing and credits are administrator-only",
    body: "Purchasing credits moves money, so it stays with the school's administrator.",
  },
  audit: {
    title: "The audit log is administrator-only",
    body: "The audit trail is append-only and is kept by the school's administrator.",
  },
  moderators: {
    title: "Managing moderators is administrator-only",
    body: "Appointing or removing moderators grants authority, so it stays with the school's administrator.",
  },
  "end-of-session": {
    title: "Closing a session is administrator-only",
    body: "Promoting, graduating or withdrawing a whole cohort changes every student's record and moves money in your slot ledger, so it stays with the school's administrator.",
  },
};

function DenialNotice({
  capability,
  subdomain,
}: {
  capability: string;
  subdomain: string;
}) {
  const copy = DENIAL_COPY[capability];
  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-500/25 bg-warning-soft px-5 py-4"
    >
      <p className="text-sm font-semibold text-warning">
        {copy?.title ?? `You do not have access to ${capability}`}
      </p>
      <p className="mt-1 text-sm text-warning">
        {copy?.body ??
          "That area is limited to the school's administrator."}{" "}
        <Link
          href={`/${subdomain}/${"staff"}`}
          className="font-medium underline underline-offset-4 hover:text-text-1"
        >
          Back to the Staff Portal
        </Link>
      </p>
    </div>
  );
}

/**
 * Overview dashboard, shared by `/{sub}/admin` and `/{sub}/moderator`.
 *
 * Three things here are driven by `portal` + capabilities rather than hardcoded:
 *
 *   1. Publishing Credits stat — HIDDEN for a moderator. They publish results,
 *      which spends credits, so showing a balance they cannot change invites
 *      them to act on a number they have no lever for. The command center still
 *      shows the balance (see CommandCenterClient) because publishing blind is
 *      worse than showing a read-only figure.
 *   2. Quick Actions — FILTERED. "Top-up Credits" pointed at /admin/billing,
 *      which a moderator cannot open; it rendered for them anyway and 403'd on
 *      click. Filtering is derived from the SAME capability list the page guards
 *      use, so a link cannot appear for someone the page would refuse.
 *   3. `?denied=` — RENDERED. See DenialNotice above.
 */
export async function DashboardSection({
  params,
  searchParams,
  portal,
}: {
  params: Promise<{ subdomain: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  portal: PortalSegment;
}) {
  const { subdomain: routeSubdomain } = await params;
  const query = await searchParams;

  // RBAC gate. See lib/enforceCapability.ts for why this lives in the page
  // rather than in the layout.
  await enforceAdminCapability(params, "dashboard", portal);

  const school = await getTenant(routeSubdomain);
  const subdomain = school?.slug ?? routeSubdomain;
  const base = `/${subdomain}/${portal}`;

  // Only used to FILTER what to render. The guard above is what actually
  // refuses; this is UX, and it reads the same verified cookie the guard did.
  const identity = await readAdminIdentity(subdomain);
  const isModerator = identity?.isModerator ?? false;
  const held = identity?.capabilities ?? [];

  const deniedRaw = Array.isArray(query.denied) ? query.denied[0] : query.denied;
  const denied = (deniedRaw ?? "").trim().toLowerCase();

  const currentTerm = school?.currentTerm ?? "Term 1";
  const currentSession = school?.currentSession ?? currentAcademicSession();

  // liveOk gates every derived stat: on failure we render an explicit
  // "unavailable" state instead of authoritative-looking zeros.
  let liveOk = false;
  let liveStudents = 0;
  let liveActiveStaff = 0;
  let livePublished = 0;
  let liveCompletion = 0;
  let liveSession = currentSession;
  try {
    const baseUrl = (
      process.env.BACKEND_URL || "http://159.223.178.34:8000"
    ).replace(/\/$/, "");
    const secret = (
      process.env.BACKEND_API_SECRET ||
      process.env.PROVISION_API_SECRET ||
      process.env.API_SECRET_KEY ||
      ""
    ).trim();
    if (!secret) {
      console.error(
        `[${portal} dashboard] summary fetch skipped for '${subdomain}': missing BACKEND_API_SECRET`,
      );
    } else {
      const qs = new URLSearchParams({
        term: currentTerm,
        academic_session: currentSession,
      });
      const r = await fetch(
        `${baseUrl}/api/v1/tenant/${encodeURIComponent(subdomain)}/command-center/summary?${qs.toString()}`,
        { headers: { "X-API-SECRET-KEY": secret }, cache: "no-store" },
      );
      if (r.ok) {
        const d = (await r.json()) as {
          total_students?: number;
          published_count?: number;
          completion_pct?: number;
          academic_session?: string;
          active_staff?: number;
        };
        liveStudents = d.total_students ?? 0;
        livePublished = d.published_count ?? 0;
        liveCompletion = d.completion_pct ?? 0;
        liveSession = d.academic_session ?? currentSession;
        liveActiveStaff = d.active_staff ?? 0;
        liveOk = true;
      } else {
        const body = (await r.text().catch(() => "")).slice(0, 300);
        console.error(
          `[${portal} dashboard] summary fetch failed for '${subdomain}': upstream status ${r.status} detail=${body || "<empty>"}`,
        );
      }
    }
  } catch (e) {
    console.error(
      `[${portal} dashboard] summary fetch errored for '${subdomain}': ${e instanceof Error ? e.message : "network failure"}`,
    );
  }

  const slotCapacity = school?.slotsBalance ?? school?.credits?.totalPurchased ?? 0;
  const displayUsed = liveOk ? liveStudents : 0;
  const displayCapacity =
    slotCapacity > 0 ? slotCapacity : Math.max(displayUsed, 0);
  const remaining = Math.max(0, displayCapacity - displayUsed);

  type Stat = {
    label: string;
    value: string;
    sub?: string;
    icon: typeof Users;
  };

  const stats: Stat[] = [
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
    // Hidden for moderators — see the note on this component. The 4-column
    // grid below is `lg:grid-cols-4`; with 3 cards that leaves a visible gap, so
    // it becomes a 3-up layout instead of a ragged row.
    ...(isModerator
      ? []
      : [
          {
            label: "Publishing Credits",
            value: String(school?.creditBalance ?? 0),
            icon: Coins,
          } as Stat,
        ]),
    {
      label: "Current Term",
      value: `${currentTerm}, ${liveSession}`,
      icon: CalendarDays,
    },
  ];

  type QuickAction = {
    label: string;
    href: string;
    icon: typeof Plus;
    capability: string;
  };

  const allQuickActions: QuickAction[] = [
    {
      label: "Add Student",
      href: `${base}/allocations`,
      icon: Plus,
      capability: "allocations",
    },
    {
      label: "Top-up Credits",
      href: `${base}/billing`,
      icon: Wallet,
      capability: "billing",
    },
    {
      label: "View Reports",
      href: `${base}/results`,
      icon: FileBarChart,
      capability: "results",
    },
  ];

  // A full admin sees everything. A moderator sees only what their capability
  // list allows — derived from the same list the page guards enforce, so a tile
  // can never appear for someone the server would refuse.
  const quickActions = allQuickActions.filter((a) =>
    isModerator ? held.includes(a.capability) : true,
  );

  const statCols =
    stats.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {portal === "moderator" ? "Moderator Overview" : "Overview Dashboard"}
        </h1>
        <p className="mt-1 text-sm text-text-2">
          Welcome back
          {school ? `, ${toTitleCase(school.name)}` : ""} — here is what is
          happening across your school today.
        </p>
      </div>

      {denied && <DenialNotice capability={denied} subdomain={subdomain} />}

      <div
        className={`mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 ${statCols}`}
      >
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="rounded-xl border border-line-1 bg-surface-1 p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-1 bg-accent-soft">
                  <Icon className="h-5 w-5 text-accent" />
                </span>
                <p className="text-xs text-text-2">{stat.label}</p>
              </div>
              <p className="mt-3 text-2xl font-bold">{stat.value}</p>
              {stat.sub && (
                <p className="mt-1 text-xs text-text-3">{stat.sub}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line-1 bg-surface-1 p-6">
          <h2 className="text-base font-semibold">Quick Actions</h2>
          <p className="mt-1 text-sm text-text-2">
            {portal === "moderator"
              ? "Jump into your moderation workflows."
              : "Jump into common admin workflows."}
          </p>
          {quickActions.length === 0 ? (
            <p className="mt-4 text-sm text-text-3">
              No quick actions are available with your current permissions.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-3">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="inline-flex items-center gap-2 rounded-full border border-line-1 bg-accent-soft px-4 py-2 text-sm font-medium text-accent transition hover:bg-surface-2 hover:text-text-1"
                  >
                    <Icon className="h-4 w-4" />
                    {action.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line-1 bg-surface-1 p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Publication Progress</h2>
            <span className="text-sm font-semibold text-accent">
              {liveOk ? `${liveCompletion}% complete` : "Stats unavailable"}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-2">
            {liveOk
              ? `${livePublished} of ${displayUsed || liveStudents} results published • ${currentTerm} ${liveSession}`
              : `Could not reach live data • ${currentTerm} ${liveSession}`}
          </p>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${liveOk ? Math.min(100, liveCompletion) : 0}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-text-3">
            {liveOk
              ? `${livePublished} of ${displayUsed || liveStudents} results published.`
              : "Publication stats unavailable."}
          </p>
        </div>

        {/* Export Data — client component: this page is a Server Component, so
            the modal + progress state live in the card, not here. Moderators
            hold `export`, so this renders for them too. */}
        <ExportDataCard subdomain={subdomain} currentTerm={currentTerm} />
      </div>
    </div>
  );
}