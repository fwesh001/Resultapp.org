import SignInForm from "@/components/auth/SignInForm";
import { getTenant, isDemoTenant } from "@/lib/tenant";
import { Logo } from "@/components/brand/Logo";
import { toTitleCase } from "@/lib/format";
import Link from "next/link";
import { ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Admin portal sign-in (public — no AdminShell sidebar).
 * Legacy schools with NULL `admin_password_hash` get a friendly setup
 * banner (via ?setup=required or the PASSWORD_NOT_SET error state) linking
 * to the one-time password setup page instead of a bare 401.
 */
export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ subdomain: string }>;
  searchParams?: Promise<{ setup?: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();
  const school = await getTenant(subdomain);
  const showSetupBanner = (await searchParams)?.setup === "required";
  const demoHost = isDemoTenant(school);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4 py-10">
      <div className="w-full max-w-md">
        <Link href={`/${subdomain}`} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-text-2 hover:text-text-1">
          <ArrowLeft className="h-4 w-4" /> Back to {school?.name ? toTitleCase(school.name) : subdomain}
        </Link>

        <div className="mt-6 rounded-[1.6rem] border border-line-1 bg-surface-1 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <Logo size="md" alt="" className="rounded-xl" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-text-1">Admin Portal</h1>
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
            Sign in to manage <span className="font-medium text-text-1">{school?.name ? toTitleCase(school.name) : subdomain}</span>.
          </p>

          {showSetupBanner && (
            <div className="mt-4 flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
              <KeyRound className="h-4 w-4 shrink-0" />
              <span>
                Please set up your admin password using the reset link below — no password
                is registered for this school yet.
              </span>
            </div>
          )}

          <div className="mt-6">
            <SignInForm
              tenantId={subdomain}
              endpoint="/api/admin/login"
              redirectTo={`/${subdomain}/admin`}
              identifierLabel="Admin ID or Email"
              identifierPlaceholder="e.g., admin@school.edu"
              footerHint="Admin sign-in: Admin ID or Email + Password"
              setupHref={`/${subdomain}/admin/setup`}
              setupLinkLabel="Set up your admin password"
              showVerifyWall
            />
          </div>

          {demoHost && (
            <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
              Demo — sign in with{" "}
              <span className="font-mono font-medium">{subdomain}@demo.resultapp.org</span> and
              password <span className="font-mono font-medium">123456</span>. Fictional data, resets
              hourly; the full persona list is in the demo guide.
            </p>
          )}

          <p className="mt-4 text-center text-xs text-text-3">
            ResultApp • Admin Authentication • <span className="font-mono">{subdomain}</span> •{" "}
            {/* prefetch={false}: demo-host escape-hatch redirect trips CORS
                preflight noise when Next prefetches the RSC payload. */}
            <Link href="/forgot-password" prefetch={false} className="underline underline-offset-4 hover:text-text-1">
              Forgot password?
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
