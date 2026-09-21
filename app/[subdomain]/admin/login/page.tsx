import SignInForm from "@/components/auth/SignInForm";
import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import Link from "next/link";
import { GraduationCap, ShieldCheck, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Admin portal sign-in — reuses the shared SignInForm template.
 * Backend wiring (`/api/admin/login`) is a follow-up; UI matches staff login.
 */
export default async function AdminLoginPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();
  const school = await getTenant(subdomain);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0514] px-4 py-10">
      <div className="w-full max-w-md">
        <Link href={`/${subdomain}`} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-purple-300/60 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to {school?.name ? toTitleCase(school.name) : subdomain}
        </Link>

        <div className="mt-6 rounded-[1.6rem] border border-purple-500/20 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">Admin Portal</h1>
              <p className="text-xs font-mono text-purple-300/60">{subdomain}.resultapp.org</p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-500/15 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <ShieldCheck className="h-3 w-3" /> Secure
            </span>
          </div>

          <h2 className="mt-6 text-xl font-bold tracking-tight text-white">Welcome back</h2>
          <p className="mt-1 text-sm text-purple-200/60">
            Sign in to manage <span className="font-medium text-white">{school?.name ? toTitleCase(school.name) : subdomain}</span>.
          </p>

          <div className="mt-6">
            <SignInForm
              tenantId={subdomain}
              endpoint="/api/admin/login"
              redirectTo={`/${subdomain}/admin`}
              identifierLabel="Admin ID or Email"
              identifierPlaceholder="e.g., admin@school.edu"
              footerHint="Admin sign-in: Admin ID or Email + Password"
            />
          </div>

          <p className="mt-4 text-center text-xs text-purple-300/30">
            ResultApp • Admin Authentication • <span className="font-mono">{subdomain}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
