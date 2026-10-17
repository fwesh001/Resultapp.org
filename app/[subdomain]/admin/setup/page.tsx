import AdminSetupForm from "@/components/auth/AdminSetupForm";
import { getTenant } from "@/lib/tenant";
import { Logo } from "@/components/brand/Logo";
import { toTitleCase } from "@/lib/format";
import Link from "next/link";
import { ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";

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
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4 py-10">
      <div className="w-full max-w-md">
        <Link href={`/${subdomain}/admin/login`} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-text-2 hover:text-text-1">
          <ArrowLeft className="h-4 w-4" /> Back to Admin Sign In
        </Link>

        <div className="mt-6 rounded-[1.6rem] border border-line-1 bg-surface-1 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <Logo size="md" alt="" className="rounded-xl" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-text-1">Admin Portal</h1>
              <p className="text-xs font-mono text-text-3">{subdomain}.resultapp.org</p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
              <ShieldCheck className="h-3 w-3" /> Secure
            </span>
          </div>

          <div className="mt-6 flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
            <KeyRound className="h-4 w-4 shrink-0" />
            <span>
              Please set up your admin password using the reset link. Your school was created
              before admin sign-in existed — choose a password once for{" "}
              <span className="font-medium text-text-1">{school?.name ? toTitleCase(school.name) : subdomain}</span>,
              then sign in normally.
            </span>
          </div>

          <div className="mt-6">
            <AdminSetupForm tenantId={subdomain} loginHref={`/${subdomain}/admin/login`} />
          </div>

          <p className="mt-4 text-center text-xs text-text-3">
            ResultApp • Admin Authentication • <span className="font-mono">{subdomain}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
