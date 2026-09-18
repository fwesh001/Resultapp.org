import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import {
  Users,
  UserCheck,
  CreditCard,
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

  // Real values from the tenant registry (see lib/tenant normalizeSchool):
  // - student count lives at credits.balance (mapped from student_count)
  // - subscription status lives at subscription.status
  const studentCount = school?.credits?.balance ?? 0;
  const rawSubscriptionStatus = school?.subscription?.status ?? "unpaid";
  const subscriptionStatus = rawSubscriptionStatus.toLowerCase();
  const isSubscriptionActive = subscriptionStatus === "active";
  const subscriptionClassName = isSubscriptionActive
    ? "text-emerald-400"
    : "text-red-400";

  const stats = [
    {
      label: "Total Students Enrolled",
      value: studentCount.toLocaleString(),
      icon: Users,
      demo: false,
    },
    {
      label: "Active Staff",
      value: "12",
      icon: UserCheck,
      demo: true,
    },
    {
      label: "Subscription",
      value: (
        <span className={`capitalize ${subscriptionClassName}`}>
          {rawSubscriptionStatus}
        </span>
      ),
      icon: CreditCard,
      demo: false,
    },
    {
      label: "Current Term",
      value: "Term 1, 2026",
      icon: CalendarDays,
      demo: true,
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
      href: `/${subdomain}/staff`,
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
                {stat.demo && (
                  <span
                    title="Placeholder metric — live data coming soon"
                    className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
                  >
                    Demo
                  </span>
                )}
              </div>
              <p className="mt-3 text-2xl font-bold">{stat.value}</p>
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

        {/* Grading Progress */}
        <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Grading Progress</h2>
            <span className="text-sm font-semibold text-purple-300">
              65% complete
            </span>
          </div>
          <p className="mt-1 text-sm text-purple-200/60">
            Staff have submitted most Term 1 scores.
          </p>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-purple-500"
              style={{ width: "65%" }}
            />
          </div>
          <p className="mt-3 text-xs text-purple-200/50">
            65 of 100 class results compiled.
          </p>
        </div>
      </div>
    </div>
  );
}
