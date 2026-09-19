"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Coins,
  History,
  Layers,
  Loader2,
  Plus,
} from "lucide-react";
import { BillingCheckout } from "@/components/billing/BillingCheckout";
import {
  calculateTieredTotal,
  calculateCreditTotal,
  CREDIT_PRICE,
  formatNaira,
  getPricingTier,
} from "@/lib/pricing";

const CREDIT_PACKAGES = [50, 100, 250, 500] as const;
const SLOT_PACKAGES = [100, 250, 500, 1000] as const;

type LedgerFilter = "all" | "PURCHASE" | "PUBLICATION_DEDUCTION" | "INITIAL_GRANT" | "REFUND" | "SLOT_PURCHASE" | "SLOT_CONSUMPTION" | "SLOT_REFUND" | "CREDIT_PURCHASE";

interface LedgerEntry {
  id: number;
  amount: number;
  transaction_type: string;
  reference_id?: string | null;
  description?: string | null;
  created_at: string;
}

interface BillingClientProps {
  tenantId: string;
  schoolName: string;
  customerEmail: string;
  customerName: string;
}

const TYPE_STYLES: Record<string, string> = {
  PURCHASE: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  PUBLICATION_DEDUCTION: "border-red-500/20 bg-red-500/10 text-red-300",
  INITIAL_GRANT: "border-violet-500/20 bg-violet-500/10 text-violet-300",
  REFUND: "border-amber-500/20 bg-amber-500/10 text-amber-300",
};

export default function BillingClient({ tenantId, schoolName, customerEmail, customerName }: BillingClientProps) {
  const [activeTab, setActiveTab] = useState<"slots" | "credits">("slots");
  const [balance, setBalance] = useState<number | null>(null);
  const [slotsBalance, setSlotsBalance] = useState<number | null>(null);
  const [slotsUsed, setSlotsUsed] = useState<number | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [pkg, setPkg] = useState<number>(250);
  const [creditPkg, setCreditPkg] = useState<number>(100);
  const [creditPrice, setCreditPrice] = useState<number>(CREDIT_PRICE);

  const fetchCredits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/credits?tenant_id=${encodeURIComponent(tenantId)}&limit=50`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data as { success?: boolean }).success === false) {
        throw new Error((data as { error?: string }).error || `Failed to load billing (${res.status})`);
      }
      const d = data as { credit_balance?: number; entries?: LedgerEntry[] };
      setBalance(d.credit_balance ?? 0);
      setEntries(Array.isArray(d.entries) ? d.entries : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchCredits();
  }, [fetchCredits]);

  const filtered = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.transaction_type === filter)),
    [entries, filter],
  );

  const pkgTotal = useMemo(() => calculateTieredTotal(pkg), [pkg]);
  const pkgTier = useMemo(() => getPricingTier(pkg), [pkg]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <Link
          href={`/${tenantId}/admin`}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-purple-300/60 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Billing & Credits</h1>
        <p className="mt-1 text-sm text-purple-200/60">
          1 credit = 1 published report card for {schoolName}. Previews and drafts are always free.
        </p>
      </div>

      {/* Balance card */}
      <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-purple-200/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading balance…
          </div>
        ) : error ? (
          <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <div className="flex-1">
              <span>{error}</span>
              <button type="button" onClick={() => void fetchCredits()} className="ml-2 font-medium underline underline-offset-4">
                Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600/20 ring-1 ring-purple-500/20">
                <Coins className="h-6 w-6 text-purple-300" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-purple-300/60">Available credits</p>
                <p className="text-3xl font-bold tracking-tight text-white">{(balance ?? 0).toLocaleString()}</p>
              </div>
            </div>
            {(balance ?? 0) < 20 && (
              <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
                Low balance — top up to keep publishing
              </span>
            )}
            <Link
              href={`/${tenantId}/admin/results`}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-purple-500/20 bg-purple-600/10 px-5 text-sm font-medium text-purple-200 transition hover:bg-purple-600/20 hover:text-white"
            >
              <Plus className="h-4 w-4" /> Go to Command Center
            </Link>
          </div>
        )}
      </div>

      {/* Packages + top-up */}
      <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
        <h2 className="text-base font-semibold text-white">Buy credit package</h2>
        <p className="mt-1 text-sm text-purple-200/60">
          {formatNaira(pkgTier.pricePerStudent)} per credit
          {pkgTier.badge ? ` • ${pkgTier.badge}` : " • Standard rate"} — credits never expire.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {PACKAGES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPkg(n)}
              aria-pressed={pkg === n}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-5 text-sm font-medium transition ${
                pkg === n
                  ? "border-purple-500 bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]"
                  : "border-purple-500/15 bg-purple-900/10 text-purple-200 hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-white"
              }`}
            >
              {n.toLocaleString()} credits
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-purple-200/70">
          Package total: <span className="font-semibold text-white">{formatNaira(pkgTotal)}</span>
        </p>
        <div className="mt-5 rounded-2xl border border-purple-500/10 bg-[#0B0514]/60 p-4 sm:p-5">
          <BillingCheckout
            key={pkg}
            mode="credit"
            defaultCount={String(pkg)}
            tenantId={tenantId}
            schoolName={schoolName}
            customerEmail={customerEmail}
            customerName={customerName}
          />
        </div>
        <p className="mt-3 text-center text-xs text-purple-300/40">
          Secured by Flutterwave • Pay with card, transfer, or USSD • Tenant: <span className="font-mono">{tenantId}</span>
        </p>
      </div>

      {/* Ledger history */}
      <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <History className="h-4 w-4 text-purple-300" /> Transaction history
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "PURCHASE", "PUBLICATION_DEDUCTION", "INITIAL_GRANT"] as LedgerFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`inline-flex min-h-[44px] items-center rounded-full border px-3 text-xs font-medium transition ${
                  filter === f
                    ? "border-purple-500 bg-purple-600 text-white"
                    : "border-purple-500/15 bg-purple-900/10 text-purple-200/70 hover:text-white"
                }`}
              >
                {f === "all" ? "All" : f === "PUBLICATION_DEDUCTION" ? "Publications" : f === "INITIAL_GRANT" ? "Grants" : "Purchases"}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-purple-200/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </p>
        ) : filtered.length === 0 ? (
          <p className="mt-4 rounded-xl border border-purple-500/10 bg-purple-950/10 p-4 text-center text-sm text-purple-200/50">
            No transactions yet. Your trial grant and top-ups will appear here.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-purple-500/10 text-xs uppercase tracking-wide text-purple-300/60">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-500/10">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-purple-900/10">
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-purple-200/60">
                      {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TYPE_STYLES[e.transaction_type] ?? "border-purple-500/15 bg-purple-900/10 text-purple-200/70"}`}>
                        {e.transaction_type === "PUBLICATION_DEDUCTION" ? "Publication" : e.transaction_type === "INITIAL_GRANT" ? "Trial grant" : e.transaction_type === "PURCHASE" ? "Purchase" : e.transaction_type}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold ${e.amount < 0 ? "text-red-300" : "text-emerald-300"}`}>
                      {e.amount > 0 ? `+${e.amount}` : e.amount}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-purple-200/60" title={e.description || e.reference_id || ""}>
                      {e.description || e.reference_id || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-purple-300/30">
        ResultApp • Credit billing • {tenantId}.resultapp.org
      </p>
    </div>
  );
}
