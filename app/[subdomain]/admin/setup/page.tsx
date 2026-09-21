import AdminSetupForm from "@/components/auth/AdminSetupForm";
import { getTenant } from "@/lib/tenant";
import { toTitleCase } from "@/lib/format";
import Link from "next/link";
import { GraduationCap, ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Public one-time admin password setup (no AdminShell sidebar).
 * For legacy schools whose `admin_password_hash` is NULL — the login
 * flow links here with a friendly banner instead of failing silently.
 */
export default async function AdminSetupPage({
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
        <Link href={`/${subdomain}/admin/login`} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-purple-300/60 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to Admin Sign In
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

          <div className="mt-6 flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
            <KeyRound className="h-4 w-4 shrink-0" />
            <span>
              Please set up your admin password using the reset link. Your school was created
              before admin sign-in existed — choose a password once for{" "}
              <span className="font-medium text-white">{school?.name ? toTitleCase(school.name) : subdomain}</span>,
              then sign in normally.
            </span>
          </div>

          <div className="mt-6">
            <AdminSetupForm tenantId={subdomain} loginHref={`/${subdomain}/admin/login`} />
          </div>

          <p className="mt-4 text-center text-xs text-purple-300/30">
            ResultApp • Admin Authentication • <span className="font-mono">{subdomain}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
