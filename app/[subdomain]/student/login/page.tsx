import StudentLoginForm from "@/components/student/StudentLoginForm";
import { getTenant, isDemoTenant } from "@/lib/tenant";
import { Logo } from "@/components/brand/Logo";
import { toTitleCase } from "@/lib/format";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, GraduationCap } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Student portal sign-in at /{subdomain}/student/login.
 *
 * Reached from the landing page's Result Checker and from the locked-preview
 * CTA on a shared report link. The latter appends ?next= so that after
 * signing in the student lands back on the card they were trying to open,
 * rather than being dumped on the dashboard with no idea why they came here.
 */
export default async function StudentLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ subdomain: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();
  const sp = await searchParams;
  const nextRaw = typeof sp.next === "string" ? sp.next : "";

  // Only accept a same-origin, path-style return target. An absolute URL here
  // would turn the login page into an open redirect: ?next=https://evil.example
  // would bounce a real family away from the site right after they trusted it
  // with their child's credentials.
  let nextPath = "";
  if (nextRaw.startsWith("/") && !nextRaw.startsWith("//")) {
    nextPath = nextRaw;
  }

  const school = await getTenant(subdomain);
  const demoHost = isDemoTenant(school);
  const schoolName = school?.name ? toTitleCase(school.name) : subdomain;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          href={`/${subdomain}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-text-2 hover:text-text-1"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {schoolName}
        </Link>

        <div className="mt-6 rounded-[1.6rem] border border-line-1 bg-surface-1 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <Logo size="md" alt="" className="rounded-xl" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-text-1">Student Portal</h1>
              <p className="text-xs font-mono text-text-3">
                {demoHost ? `demo.resultapp.org/${subdomain}` : `${subdomain}.resultapp.org`}
              </p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
              <ShieldCheck className="h-3 w-3" /> Secure
            </span>
          </div>

          <h2 className="mt-6 text-xl font-bold tracking-tight text-text-1">Welcome back</h2>
          <p className="mt-1 text-sm text-text-3">
            Sign in to see your results for{" "}
            <span className="font-medium text-text-1">{schoolName}</span>.
          </p>

          <div className="mt-6">
            <StudentLoginForm
              tenantId={subdomain}
              studentIdPrefix={school?.idPrefix ?? subdomain}
              redirectTo={nextPath || `/${subdomain}/student`}
            />
          </div>

          <p className="mt-4 rounded-xl border border-line-1 bg-surface-2 px-3 py-2 text-xs leading-5 text-text-2">
            First time here? Use your admission number with the default password{" "}
            <span className="font-mono font-medium text-text-1">123456</span>, then change it.
          </p>

          {demoHost && (
            <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
              Demo — try{" "}
              <span className="font-mono font-medium">STD001</span> with password{" "}
              <span className="font-mono font-medium">123456</span>. Fictional data, resets hourly.
            </p>
          )}

          <p className="mt-4 text-center text-xs text-text-3">
            ResultApp • Student Portal • <span className="font-mono">{subdomain}</span>
          </p>
        </div>

        <p className="mt-6 flex items-start gap-2 px-2 text-center text-[0.7rem] leading-5 text-text-3">
          <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Result cards are private. Signing in confirms you are this student so we can show your
            grades.
          </span>
        </p>
      </div>
    </div>
  );
}