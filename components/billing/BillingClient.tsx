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
import InfoTooltip from "@/components/ui/InfoTooltip";
import {
  calculateTieredTotal,
  calculateCreditTotal,
  CREDIT_PRICE,
  formatNaira,
  getPricingTier,
} from "@/lib/pricing";

const CREDIT_PACKAGES = [50, 100, 250, 500] as const;
const SLOT_PACKAGES = [100, 250, 500, 1000] as const;

type LedgerFilter = "all" | "PURCHASE" | "PUBLICATION_DEDUCTION" | "INITIAL_GRANT" | "INITIAL_SLOTS" | "REFUND" | "SLOT_PURCHASE" | "SLOT_CONSUMPTION" | "SLOT_REFUND" | "SLOT_WAIVER" | "CREDIT_PURCHASE";

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

/**
 * Waiver state lives HERE, not in BillingCheckout.
 *
 * `BillingCheckout` is rendered with `key={slot-${pkg}}` so that switching
 * package pills resets its internal count input. React treats a changed key as
 * a different component and throws the old instance away — so a waiver code
 * typed into the child would VANISH every time the buyer clicked a different
 * package size.
 *
 * That is not a hypothetical: the natural flow for someone with a waiver is to
 * enter the code and then compare package sizes, which is exactly the sequence
 * that would silently eat it. The token therefore lives in the parent and is
 * passed down; only the split (which depends on the slot count the child owns)
 * stays local to the child.
 */
export interface WaiverCodeState {
  token: string;
  tokenId: number | null;
  error: string | null;
}

const TYPE_STYLES: Record<string, string> = {
  PURCHASE: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  CREDIT_PURCHASE: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  PUBLICATION_DEDUCTION: "border-red-500/20 bg-red-500/10 text-red-300",
  INITIAL_GRANT: "border-violet-500/20 bg-violet-500/10 text-violet-300",
  INITIAL_SLOTS: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  SLOT_PURCHASE: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  SLOT_CONSUMPTION: "border-red-500/20 bg-red-500/10 text-red-300",
  SLOT_REFUND: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  // A waiver is money NOT taken. Cyan, matching INITIAL_SLOTS, because that is
  // exactly what it is: capacity granted without a charge. Green would read
  // as "purchased", which would overstate what was paid.
  SLOT_WAIVER: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  REFUND: "border-amber-500/20 bg-amber-500/10 text-amber-300",
};

/** Human labels for the ledger's type badges. */
const TYPE_LABELS: Record<string, string> = {
  PUBLICATION_DEDUCTION: "Publication",
  INITIAL_GRANT: "Trial grant",
  INITIAL_SLOTS: "Initial slots",
  SLOT_PURCHASE: "Slot purchase",
  SLOT_WAIVER: "Waiver applied",
  SLOT_CONSUMPTION: "Slot used",
  SLOT_REFUND: "Slot refund",
  CREDIT_PURCHASE: "Credit purchase",
  PURCHASE: "Credit purchase",
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

  // Waiver code — HOISTED so it survives the child's remount-on-package-change.
  // See the note on WaiverCodeState.
  const [waiver, setWaiver] = useState<WaiverCodeState>({ token: "", tokenId: null, error: null });

  function handleWaiverChange(next: WaiverCodeState) {
    setWaiver(next);
  }

  const fetchCredits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [creditRes, slotRes, ledgerRes] = await Promise.all([
        fetch(`/api/billing/credits?tenant_id=${encodeURIComponent(tenantId)}&limit=50`, { cache: "no-store" }),
        fetch(`/api/billing/slots?tenant_id=${encodeURIComponent(tenantId)}`, { cache: "no-store" }).catch(() => null as unknown as Response),
        fetch(`/api/billing/ledger?tenant_id=${encodeURIComponent(tenantId)}&limit=50`, { cache: "no-store" }).catch(() => null as unknown as Response),
      ]);
      const data = await creditRes.json().catch(() => ({}));
      if (!creditRes.ok || (data as { success?: boolean }).success === false) {
        throw new Error((data as { error?: string }).error || `Failed to load billing (${creditRes.status})`);
      }
      const d = data as { credit_balance?: number; entries?: LedgerEntry[] };
      setBalance(d.credit_balance ?? 0);
      // Prefer unified ledger (has token_type for both SLOT/CREDIT) if available
      if (ledgerRes && ledgerRes.ok) {
        const lData = await ledgerRes.json().catch(() => ({}));
        const unified = (lData as { entries?: LedgerEntry[] }).entries;
        if (Array.isArray(unified) && unified.length > 0) {
          setEntries(unified);
        } else {
          setEntries(Array.isArray(d.entries) ? d.entries : []);
        }
      } else {
        setEntries(Array.isArray(d.entries) ? d.entries : []);
      }
      if (slotRes && slotRes.ok) {
        const sData = await slotRes.json().catch(() => ({}));
        const sb = (sData as { slots_balance?: number }).slots_balance;
        if (typeof sb === "number") setSlotsBalance(sb);
        const used = (sData as { slots_used?: number }).slots_used;
        if (typeof used === "number") setSlotsUsed(used);
      }
      try {
        const cfg = await fetch(`/api/admin/config/credit-price`, { cache: "no-store" }).catch(() => null as unknown as Response);
        if (cfg && cfg.ok) {
          const c = await cfg.json().catch(() => ({}));
          const p = Number((c as { credit_price?: number }).credit_price);
          if (Number.isFinite(p) && p > 0) setCreditPrice(p);
        }
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchCredits();
  }, [fetchCredits]);

  const tabEntries = useMemo(() => {
    return entries.filter((e) => {
      const isSlot = e.transaction_type.includes("SLOT") || (e as unknown as { token_type?: string }).token_type === "SLOT";
      return activeTab === "slots" ? isSlot : !isSlot;
    });
  }, [entries, activeTab]);

  const filtered = useMemo(
    () => (filter === "all" ? tabEntries : tabEntries.filter((e) => e.transaction_type === filter)),
    [tabEntries, filter],
  );

  const pkgTotal = useMemo(() => calculateTieredTotal(pkg), [pkg]);
  const pkgTier = useMemo(() => getPricingTier(pkg), [pkg]);
  const creditTotal = useMemo(() => calculateCreditTotal(creditPkg, creditPrice), [creditPkg, creditPrice]);

  return (
    // Layout lives in billing/page.tsx, which owns the single max-width and
    // horizontal gutter for this surface. This component only spaces its own
    // sections — adding px-4/py-8 here as well doubled the mobile inset and
    // stacked two vertical paddings inside an already-padded shell.
    <div className="space-y-6">
      <div>
        <Link
          href={`/${tenantId}/admin`}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-purple-300/60 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Billing — Slots &amp; Credits</h1>
            <p className="mt-1 text-sm text-purple-200/60">
              <span className="font-medium text-white">Slots</span> = student capacity (one-time, tiered) •{" "}
              <span className="font-medium text-white">Credits</span> = publishing tokens (flat {formatNaira(creditPrice)}/credit) for {schoolName}.
            </p>
          </div>
          <InfoTooltip
            label="Difference between slots and credits"
            placement="bottom"
            className="mt-1 shrink-0"
          >
            <span className="block font-semibold text-white">Slots are capacity.</span>
            <span className="mt-1 block">
              One slot is one seat for one student, bought once and never spent. Buy
              more seats than you need students; the extra stays available until you
              add a pupil.
            </span>
            <span className="mt-2 block font-semibold text-white">Credits are spending tokens.</span>
            <span className="mt-1 block">
              A credit is consumed each time a report card is first published for a
              student in a term. Reprints of an already-published card are free.
              Credits do not expire.
            </span>
            <span className="mt-2 block">
              So: slots decide <em className="not-italic text-purple-200">how many</em>{" "}
              students you can onboard; credits decide{" "}
              <em className="not-italic text-purple-200">how often</em> you can
              publish their results.
            </span>
          </InfoTooltip>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-full border border-purple-500/15 bg-purple-900/10 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("slots")}
          aria-pressed={activeTab === "slots"}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
            activeTab === "slots"
              ? "bg-purple-600 text-white shadow"
              : "text-purple-200/70 hover:text-white"
          }`}
        >
          <Layers className="h-4 w-4" /> Slots (Capacity)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("credits")}
          aria-pressed={activeTab === "credits"}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
            activeTab === "credits"
              ? "bg-purple-600 text-white shadow"
              : "text-purple-200/70 hover:text-white"
          }`}
        >
          <Coins className="h-4 w-4" /> Credits (Publishing)
        </button>
      </div>

      {activeTab === "slots" ? (
        <>
          {/* Slots balance card */}
          <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-purple-200/60">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading slots…
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
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600/20 ring-1 ring-emerald-500/20">
                    <Layers className="h-6 w-6 text-emerald-300" />
                  </span>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-purple-300/60">Slots remaining (capacity)</p>
                    <p className="text-3xl font-bold tracking-tight text-white">
                      {(slotsBalance ?? 0).toLocaleString()}
                      {slotsUsed !== null && <span className="text-sm font-normal text-purple-300/50"> • {slotsUsed} used</span>}
                    </p>
                  </div>
                </div>
                {(slotsBalance ?? 0) < 10 && (
                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
                    Low slots — top up to add more students
                  </span>
                )}
                <Link
                  href={`/${tenantId}/admin/allocations`}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-purple-500/20 bg-purple-600/10 px-5 text-sm font-medium text-purple-200 transition hover:bg-purple-600/20 hover:text-white"
                >
                  <Plus className="h-4 w-4" /> Manage Roster
                </Link>
              </div>
            )}
          </div>

          {/* Slots packages + top-up (tiered) */}
          <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
            <h2 className="text-base font-semibold text-white">Buy slot package</h2>
            <p className="mt-1 text-sm text-purple-200/60">
              {formatNaira(pkgTier.pricePerStudent)} per slot
              {pkgTier.badge ? ` • ${pkgTier.badge}` : " • Standard rate"} — tiered: 50-499 ₦100, 500-999 ₦90, 1000+ ₦80.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SLOT_PACKAGES.map((n) => (
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
                  {n.toLocaleString()} slots
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-purple-200/70">
              Package total: <span className="font-semibold text-white">{formatNaira(pkgTotal)}</span>
            </p>
            <div className="mt-5 rounded-2xl border border-purple-500/10 bg-[#0B0514]/60 p-4 sm:p-5">
              <BillingCheckout
                key={`slot-${pkg}`}
                mode="slot"
                defaultCount={String(pkg)}
                tenantId={tenantId}
                schoolName={schoolName}
                customerEmail={customerEmail}
                customerName={customerName}
                waiver={waiver}
                onWaiverChange={handleWaiverChange}
              />
            </div>
            <p className="mt-3 text-center text-xs text-purple-300/40">
              Secured by Flutterwave • Tiered pricing • Tenant: <span className="font-mono">{tenantId}</span>
            </p>
          </div>
        </>
      ) : (
        <>
          {/* Credits balance card */}
          <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-purple-200/60">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading credits…
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

            {/* Credits packages + top-up (flat live rate) */}
          <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-white">Buy credit package</h2>
                <p className="mt-1 text-sm text-purple-200/60">
                  {formatNaira(creditPrice)} per credit — flat rate, no tiers. Credits never expire.
                </p>
              </div>
              <InfoTooltip
                label="How credits work"
                placement="bottom"
                className="-mr-2 -mt-1 shrink-0"
              >
                One credit is spent each time a report card is first published for a
                student in a term. Reprinting an already-published card is free, so
                you are never charged twice for the same result. Credits do not
                expire, and a credit you do not spend stays on the account.
              </InfoTooltip>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {CREDIT_PACKAGES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCreditPkg(n)}
                  aria-pressed={creditPkg === n}
                  className={`inline-flex min-h-[44px] items-center rounded-full border px-5 text-sm font-medium transition ${
                    creditPkg === n
                      ? "border-purple-500 bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]"
                      : "border-purple-500/15 bg-purple-900/10 text-purple-200 hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-white"
                  }`}
                >
                  {n.toLocaleString()} credits
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-purple-200/70">
              Package total: <span className="font-semibold text-white">{formatNaira(creditTotal)}</span>
            </p>
            <div className="mt-5 rounded-2xl border border-purple-500/10 bg-[#0B0514]/60 p-4 sm:p-5">
              <BillingCheckout
                key={`credit-${creditPkg}`}
                mode="credit"
                defaultCount={String(creditPkg)}
                tenantId={tenantId}
                schoolName={schoolName}
                customerEmail={customerEmail}
                customerName={customerName}
                unitPrice={creditPrice}
              />
            </div>
            <p className="mt-3 text-center text-xs text-purple-300/40">
              Secured by Flutterwave • Flat {formatNaira(creditPrice)}/credit • Tenant: <span className="font-mono">{tenantId}</span>
            </p>
          </div>
        </>
      )}

      {/* Ledger history */}
      <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <History className="h-4 w-4 text-purple-300" /> Transaction history
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {(
              activeTab === "slots"
                ? (["all", "SLOT_PURCHASE", "SLOT_WAIVER", "SLOT_CONSUMPTION", "SLOT_REFUND", "INITIAL_SLOTS"] as LedgerFilter[])
                : (["all", "CREDIT_PURCHASE", "PURCHASE", "PUBLICATION_DEDUCTION", "INITIAL_GRANT"] as LedgerFilter[])
            ).map((f) => (
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
                {f === "all"
                  ? "All"
                  : f === "PUBLICATION_DEDUCTION"
                    ? "Publications"
                    : f === "INITIAL_GRANT" || f === "INITIAL_SLOTS"
                      ? "Grants"
                      : f === "SLOT_WAIVER"
                        ? "Waivers"
                        : f.includes("SLOT")
                          ? f.replace("SLOT_", "").replace("_", " ")
                          : "Purchases"}
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
                        {TYPE_LABELS[e.transaction_type] ?? e.transaction_type}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold ${
                      // A waiver ADDS capacity that was never paid for, so it is
                      // not money and must not read like a green revenue figure.
                      e.transaction_type === "SLOT_WAIVER"
                        ? "text-cyan-300"
                        : e.amount < 0
                          ? "text-red-300"
                          : "text-emerald-300"
                    }`}>
                      {e.transaction_type === "SLOT_WAIVER"
                        ? `+${e.amount} (free)`
                        : e.amount > 0
                          ? `+${e.amount}`
                          : e.amount}
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
