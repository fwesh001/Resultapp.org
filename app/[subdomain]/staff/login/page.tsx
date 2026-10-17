import StaffLoginForm from "@/components/staff/StaffLoginForm";
import { getTenant, isDemoTenant } from "@/lib/tenant";
import { Logo } from "@/components/brand/Logo";
import { toTitleCase } from "@/lib/format";
import Link from "next/link";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StaffLoginPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();
  const school = await getTenant(subdomain);
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
              <h1 className="text-lg font-semibold tracking-tight text-text-1">Staff Portal</h1>
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
            Sign in to access your workload for <span className="font-medium text-text-1">{school?.name ? toTitleCase(school.name) : subdomain}</span>.
          </p>

          <div className="mt-6">
            <StaffLoginForm tenantId={subdomain} staffIdPrefix={school?.staffIdPrefix ?? "STAFF/"} />
          </div>

          <p className="mt-4 rounded-xl border border-line-1 bg-surface-2 px-3 py-2 text-xs leading-5 text-text-2">
            Your login credentials were issued by your school. Please contact the Principal if you cannot log in.
          </p>
          {demoHost && (
            <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
              Demo login — Staff ID <span className="font-mono font-medium">DEMO-ADM</span> with
              PIN <span className="font-mono font-medium">123456</span>. Fictional data, resets hourly.
            </p>
          )}

          <p className="mt-4 text-center text-xs text-text-3">
            ResultApp • Staff Authentication • <span className="font-mono">{subdomain}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
