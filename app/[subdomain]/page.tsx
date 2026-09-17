import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import ResultLookupWidget from "@/components/landing/ResultLookupWidget";
import {
  ShieldCheck,
  GraduationCap,
  Users,
  Settings,
  CreditCard,
} from "lucide-react";

/**
 * Tenant landing page — public-facing portal for parents
 * and quick-access hub for school staff.
 */
export default async function TenantPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: routeSubdomain } = await params;
  const school = await getTenant(routeSubdomain);

  // `School.slug` holds the tenant subdomain (see lib/tenant normalizeSchool).
  const subdomain = school?.slug ?? routeSubdomain;

  if (!school) {
    return (
      <main className="min-h-screen bg-[#0B0514] text-white">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
          <GraduationCap className="h-12 w-12 text-purple-400" />
          <h1 className="mt-4 text-3xl font-bold">
            School not found ({routeSubdomain})
          </h1>
          <p className="mt-2 text-purple-200/70">
            School data unavailable — backend unreachable or subdomain not
            provisioned.
          </p>
          <footer className="mt-10 text-sm text-purple-300/50">
            Powered by ResultApp.org • Academic Registry Portal
          </footer>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0514] text-white">
      {/* Section 1 — Hero */}
      <section className="border-b border-purple-500/20 bg-purple-900/[0.04]">
        <div className="mx-auto max-w-5xl px-6 py-14 text-center">
          <div className="flex items-center justify-center gap-3">
            <GraduationCap className="h-10 w-10 text-purple-400" />
            {school.isVerified && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-900/20 px-3 py-1 text-xs font-medium text-purple-200">
                <ShieldCheck className="h-4 w-4 text-purple-300" />
                Verified School
              </span>
            )}
          </div>

          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
            {school.name}
          </h1>
          {school.motto && (
            <p className="mt-3 text-lg italic text-purple-300">
              &ldquo;{school.motto}&rdquo;
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-purple-200/80">
            {school.email && <span>{school.email}</span>}
            {school.phone && <span>{school.phone}</span>}
          </div>
        </div>
      </section>

      {/* Section 2 — Result Lookup */}
      <section className="mx-auto flex max-w-5xl flex-col items-center px-6 py-12">
        <h2 className="text-2xl font-semibold">Check Results Online</h2>
        <p className="mt-2 text-center text-sm text-purple-200/70">
          Parents — enter your child&apos;s Student ID and select a term to view
          the report card.
        </p>
        <div className="mt-6 flex w-full justify-center">
          <ResultLookupWidget subdomain={subdomain} />
        </div>
      </section>

      {/* Section 3 — Staff Portals */}
      <section className="mx-auto max-w-5xl px-6 pb-14">
        <h2 className="text-center text-2xl font-semibold">Staff Portals</h2>
        <p className="mt-2 text-center text-sm text-purple-200/70">
          Quick access for teachers and administrators.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link
            href={`/${subdomain}/teacher/grading`}
            className="rounded-2xl border border-purple-500/20 bg-purple-900/[0.04] p-6 transition hover:bg-purple-900/10"
          >
            <Users className="h-8 w-8 text-purple-300" />
            <h3 className="mt-3 text-lg font-semibold">Teacher Portal</h3>
            <p className="mt-1 text-sm text-purple-200/70">
              Enter scores and grade student results.
            </p>
          </Link>

          <Link
            href={`/${subdomain}/admin/templates`}
            className="rounded-2xl border border-purple-500/20 bg-purple-900/[0.04] p-6 transition hover:bg-purple-900/10"
          >
            <Settings className="h-8 w-8 text-purple-300" />
            <h3 className="mt-3 text-lg font-semibold">Admin Templates</h3>
            <p className="mt-1 text-sm text-purple-200/70">
              Manage report templates and branding.
            </p>
          </Link>

          <Link
            href={`/${subdomain}/admin/billing`}
            className="rounded-2xl border border-purple-500/20 bg-purple-900/[0.04] p-6 transition hover:bg-purple-900/10"
          >
            <CreditCard className="h-8 w-8 text-purple-300" />
            <h3 className="mt-3 text-lg font-semibold">
              Billing &amp; Subscription
            </h3>
            <p className="mt-1 text-sm text-purple-200/70">
              Top up credits and manage your plan.
            </p>
          </Link>
        </div>
      </section>

      {/* Section 4 — Footer */}
      <footer className="border-t border-purple-500/20 py-6 text-center text-sm text-purple-300/60">
        Powered by ResultApp.org • Academic Registry Portal
      </footer>
    </main>
  );
}
