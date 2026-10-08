import { getTenantStatus } from "@/lib/tenant";
import { notFound } from "next/navigation";
import { hasAdminSession } from "@/lib/adminAuth";
import { toTitleCase } from "@/lib/format";
import ResultLookupWidget from "@/components/landing/ResultLookupWidget";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import SuspendedPortal from "@/components/tenants/SuspendedPortal";
import { ShieldCheck, GraduationCap, CloudOff } from "lucide-react";

/**
 * Tenant landing page — public-facing result checker for the school community.
 * Staff and admin entry points live in the Navbar and Footer.
 *
 * Unknown subdomains (never provisioned, or purged) return a real HTTP 404 via
 * notFound(). A backend outage does NOT: that renders a retryable page, because
 * a transient blip must never look to a crawler like a school disappeared.
 */
export default async function TenantPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: routeSubdomain } = await params;
  const lookup = await getTenantStatus(routeSubdomain);
  const school = lookup.status === "ok" ? lookup.school : null;

  // `School.slug` holds the tenant subdomain (see lib/tenant normalizeSchool).
  const subdomain = school?.slug ?? routeSubdomain;

  // Authoritative "no such school" — real 404 status, real 404 page.
  if (lookup.status === "missing") {
    notFound();
  }

  // Registry is healthy but has no row, or we could not reach it. Keep the
  // page renderable so a transient outage is not cached as a 404.
  if (!school) {
    const backendDown = lookup.status === "unavailable";
    return (
      <main className="min-h-screen bg-[#0B0514] text-white">
        <Navbar schoolName={routeSubdomain} subdomain={routeSubdomain} />
        <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
          {backendDown ? (
            <CloudOff className="h-12 w-12 text-purple-400" />
          ) : (
            <GraduationCap className="h-12 w-12 text-purple-400" />
          )}
          <h1 className="mt-4 text-3xl font-bold">
            {backendDown
              ? "Temporarily unavailable"
              : `Preparing ${toTitleCase(routeSubdomain)}`}
          </h1>
          <p className="mt-2 text-purple-200/70">
            {backendDown
              ? "We can't reach the school registry right now. Please refresh in a moment."
              : "This school's portal is still being set up. Please check back shortly."}
          </p>
        </div>
        <footer className="border-t border-purple-500/20 py-6 text-center text-sm text-purple-300/60">
          Powered by ResultApp.org • Academic Registry Portal
        </footer>
      </main>
    );
  }

  // Suspended tenants: public portal blocked, but a signed-in tenant admin
  // still gets the billing escape hatch to self-serve restoration.
  if (school.isActive === false) {
    const showBilling = await hasAdminSession(subdomain);
    return <SuspendedPortal schoolName={school.name} subdomain={subdomain} showBillingLink={showBilling} />;
  }

  // Default hero artwork until the school uploads its own background.
  const heroBg = school.heroBgUrl || "/bento-csv-accent.avif";

  return (
    <main className="min-h-screen bg-[#0B0514] text-white">
      <Navbar
        schoolName={school.name}
        subdomain={subdomain}
        logoUrl={school.logoUrl}
      />

      {/* Section 1 — Hero with dynamic background */}
      <section
        className="relative overflow-hidden border-b border-purple-500/20 bg-[#0B0514] bg-cover bg-center"
        style={{ backgroundImage: `url(${heroBg})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B0514]/95 via-[#0B0514]/80 to-transparent" />
        <div className="relative mx-auto max-w-5xl px-6 py-14">
          <div className="max-w-xl text-left">
            <div className="flex items-center gap-3">
              {school.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={school.logoUrl}
                  alt={`${toTitleCase(school.name)} logo`}
                  className="h-16 w-16 rounded-2xl border border-purple-500/20 object-cover"
                />
              ) : (
                <GraduationCap className="h-12 w-12 text-purple-400" />
              )}
              {school.isVerified && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-900/20 px-3 py-1 text-xs font-medium text-purple-200">
                  <ShieldCheck className="h-4 w-4 text-purple-300" />
                  Verified School
                </span>
              )}
            </div>

            <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
              {toTitleCase(school.name)}
            </h1>
            {school.motto && (
              <p className="mt-3 text-lg italic text-purple-300">
                &ldquo;{school.motto}&rdquo;
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-purple-200/80">
              {school.email && (
                <a href={`mailto:${school.email}`} className="transition hover:text-white">
                  {school.email}
                </a>
              )}
              {school.phone && (
                <a href={`tel:${school.phone.replace(/\s+/g, "")}`} className="transition hover:text-white">
                  {school.phone}
                </a>
              )}
            </div>
          </div>

          {/* Result lookup — centered. Carries the #result-checker anchor so a
              hard load of /#result-checker lands directly on the checker rather
              than the top of the hero. scroll-mt-24 keeps the heading clear of
              the sticky Navbar. */}
          <div
            id="result-checker"
            className="mx-auto mt-12 max-w-xl scroll-mt-24 text-center"
          >
            <h2 className="text-2xl font-semibold">Check Results Online</h2>
            <p className="mt-2 text-sm text-purple-200/70">
              Enter a Student ID and select a term to view the report card.
            </p>
            <div className="mt-6 flex w-full justify-center">
              <ResultLookupWidget subdomain={subdomain} />
            </div>
          </div>
        </div>
      </section>

      <Footer school={school} subdomain={subdomain} />
    </main>
  );
}
