import { getTenant } from "@/lib/tenant";
import Link from "next/link";
import { Lock, CreditCard, Sparkles, ShieldCheck, ArrowLeft, CheckCircle2 } from "lucide-react";
import { BillingCheckout } from "@/components/billing/BillingCheckout";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const tenantId = subdomain.toLowerCase().trim();
  const school = await getTenant(tenantId);

  const rawStatus =
    ((school as unknown as { subscription_status?: string } | null)?.subscription_status ??
      school?.subscription?.status ??
      "unpaid") as string;
  const lower = rawStatus.toLowerCase();
  const isActive = lower === "active";
  const isLocked = ["unpaid", "inactive", "past_due"].includes(lower);

  // Already active view (decision 6)
  if (isActive) {
    return (
      <div className="min-h-screen bg-[#0B0514] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <Link
            href={`/${tenantId}/report/STU001?term=Term%201`}
            className="inline-flex items-center gap-1.5 text-sm text-purple-300/60 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Back to report
          </Link>

          <div className="mt-6 rounded-[1.6rem] border border-emerald-500/20 bg-zinc-900 p-6 text-center shadow-2xl sm:p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Your subscription is active</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              <span className="font-mono font-medium text-white">{school?.name || tenantId}</span> is unlocked for report
              card printing. Student count: <span className="font-semibold text-white">{school?.credits?.balance ?? (school as unknown as { student_count?: number })?.student_count ?? "—"}</span>
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/${tenantId}/admin/templates`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                <Sparkles className="h-4 w-4" /> Go to Templates
              </Link>
              <Link
                href={`/${tenantId}/report/STU001?term=Term%201`}
                className="inline-flex w-full items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700"
              >
                View Report
              </Link>
            </div>

            <p className="mt-4 text-xs text-zinc-500">
              Need more slots? Use the checkout below to increase your student quota — it will overwrite your count.
            </p>

            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
              <BillingCheckout
                tenantId={tenantId}
                schoolName={school?.name || tenantId}
                customerEmail={school?.email || `${tenantId}@resultapp.org`}
                customerName={school?.proprietorName || school?.name || tenantId}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0514] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href={`/${tenantId}/report/STU001?term=Term%201`}
          className="inline-flex items-center gap-1.5 text-sm text-purple-300/60 hover:text-white print:hidden"
        >
          <ArrowLeft className="h-4 w-4" /> Back to report
        </Link>

        <div className="mt-6 rounded-[1.6rem] border border-red-500/20 bg-zinc-900 p-6 text-center shadow-2xl sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/30">
            <Lock className="h-7 w-7 text-red-400" />
          </div>

          <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Billing & Subscription</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Unlock report card printing for{" "}
            <span className="font-mono font-medium text-white">{school?.name || tenantId}</span> — currently{" "}
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isLocked ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>
              {rawStatus}
            </span>
            .
          </p>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-left">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              What you&apos;ll get when you upgrade
            </div>
            <ul className="mt-3 space-y-2 text-sm text-zinc-400">
              <li className="flex gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-purple-400" />
                <span>Unlimited report card generation & printing for all terms</span>
              </li>
              <li className="flex gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-purple-400" />
                <span>Remove watermark & unlock official signatures</span>
              </li>
              <li className="flex gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-purple-400" />
                <span>Priority support & automatic backups</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 text-left sm:p-5">
            <h3 className="text-sm font-semibold text-white">Upgrade — Choose student count</h3>
            <p className="mt-1 text-xs text-purple-300/50">Tiered: 50–499 ₦100, 500–999 ₦90, 1000+ ₦80 (same as registration)</p>
            <div className="mt-4">
              <BillingCheckout
                tenantId={tenantId}
                schoolName={school?.name || tenantId}
                customerEmail={school?.email || `${tenantId}@resultapp.org`}
                customerName={school?.proprietorName || school?.name || tenantId}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/${tenantId}/admin/templates`}
              className="inline-flex w-full items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700"
            >
              Manage Templates
            </Link>
            <Link
              href={`/${tenantId}/staff`}
              className="inline-flex w-full items-center justify-center rounded-full border border-purple-500/15 bg-purple-500/10 px-6 py-3 text-sm font-medium text-purple-200 hover:bg-purple-500/15"
            >
              Staff Portal
            </Link>
          </div>

          <p className="mt-4 text-xs text-zinc-500">
            Questions? Contact <span className="text-zinc-300">billing@resultapp.org</span> — Tenant:{" "}
            <span className="font-mono">{tenantId}</span> • Secured by Flutterwave
          </p>

          <div className="mt-6 rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3 text-left text-xs leading-5 text-amber-200/70">
            <span className="font-semibold text-amber-200">MVP Note:</span> Schools with <span className="font-mono">subscription_status = &apos;unpaid&apos; / &apos;inactive&apos; / &apos;past_due&apos;</span> see the blurred report card gate. Paying here calls <span className="font-mono">POST /api/billing/upgrade</span> → <span className="font-mono">POST /api/v1/tenant/{tenantId}/upgrade</span> and revalidates.
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-purple-300/30">
          ResultApp • Secure multi-tenant report engine • {tenantId}.resultapp.org
        </p>
      </div>
    </div>
  );
}
