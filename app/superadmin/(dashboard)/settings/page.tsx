"use client";

import { useEffect, useState } from "react";
import { Settings, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { formatNaira } from "@/lib/pricing";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface FreeCreditsConfig {
  enabled: boolean;
  min_students: number;
  grant_amount: number;
}

/** Global Settings — platform tunables (moved out of the Dashboard). */
export default function SuperadminSettingsPage() {
  const [creditPrice, setCreditPrice] = useState<number>(200);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  const [freeCredits, setFreeCredits] = useState<FreeCreditsConfig | null>(null);
  const [freeLoading, setFreeLoading] = useState(true);
  const [freeSaving, setFreeSaving] = useState(false);
  const [freeError, setFreeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPrice() {
      setPriceLoading(true);
      try {
        const res = await fetch("/api/admin/config/credit-price", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof (data as { credit_price?: number }).credit_price === "number") {
          if (!cancelled) setCreditPrice((data as { credit_price: number }).credit_price);
        }
      } catch {}
      if (!cancelled) setPriceLoading(false);
    }
    async function loadFreeCredits() {
      setFreeLoading(true);
      try {
        const res = await fetch("/api/admin/config/free-credits", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof (data as FreeCreditsConfig).enabled === "boolean") {
          if (!cancelled) setFreeCredits(data as FreeCreditsConfig);
        }
      } catch {}
      if (!cancelled) setFreeLoading(false);
    }
    void loadPrice();
    void loadFreeCredits();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setPriceSaving(true);
    setPriceError(null);
    try {
      const res = await fetch("/api/admin/config/credit-price", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credit_price: creditPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      toast.success(`Saved: ${formatNaira((data as { credit_price: number }).credit_price)} per credit`);
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setPriceSaving(false);
    }
  }

  async function handleToggleFreeCredits(next: boolean) {
    if (!freeCredits) return;
    const prev = freeCredits;
    // Optimistic — reverted if the save fails.
    setFreeCredits({ ...freeCredits, enabled: next });
    setFreeSaving(true);
    setFreeError(null);
    try {
      const res = await fetch("/api/admin/config/free-credits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      const saved = data as FreeCreditsConfig;
      setFreeCredits({
        enabled: saved.enabled,
        min_students: saved.min_students ?? prev.min_students,
        grant_amount: saved.grant_amount ?? prev.grant_amount,
      });
      toast.success(saved.enabled ? "Free registration credits enabled" : "Free registration credits disabled");
    } catch (e) {
      setFreeCredits(prev);
      setFreeError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setFreeSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]">
          <Settings className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Global Settings</h1>
          <p className="text-sm text-purple-200/60">Platform-wide tunables</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5 backdrop-blur">
        <h2 className="text-sm font-semibold text-white">Publishing Credit Price (Superadmin)</h2>
        <p className="mt-1 text-xs text-purple-200/60">
          Flat NGN per credit — applies to all future credit top-ups. Slots remain tiered (100/90/80).
        </p>
        {priceError && (
          <div className="mt-3 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{priceError}</span>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-purple-200/70">₦</span>
            <input
              type="number"
              min={1}
              max={100000}
              value={priceLoading ? "" : creditPrice}
              onChange={(e) => setCreditPrice(Math.max(1, Math.min(100000, Number(e.target.value) || 0)))}
              className="w-28 rounded-xl border border-purple-500/20 bg-[#0B0514] px-3 py-2 text-sm text-white placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              disabled={priceLoading}
            />
            <span className="text-sm text-purple-300/60">per credit</span>
          </div>
          <button
            type="button"
            disabled={priceSaving || priceLoading}
            onClick={() => void handleSave()}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-purple-600 px-5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-60"
          >
            {priceSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Price
          </button>
        </div>
      </div>

      {/* Free registration credits — toggle is only half the rule */}
      <div className="mt-4 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="h-4 w-4 text-emerald-300" />
              Free Registration Credits
            </h2>
            <p className="mt-1 text-xs text-purple-200/60">
              Grants a complimentary credit bundle to new schools at provisioning.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-purple-200/70">
              {freeLoading ? "Loading…" : freeCredits?.enabled ? "Enabled" : "Disabled"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={freeCredits?.enabled ?? false}
              aria-label="Enable free registration credits"
              disabled={freeLoading || freeSaving || !freeCredits}
              onClick={() => void handleToggleFreeCredits(!(freeCredits?.enabled ?? false))}
              className={cn(
                "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0514] disabled:cursor-not-allowed disabled:opacity-60",
                freeCredits?.enabled ? "bg-emerald-500" : "bg-purple-800/60"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                  freeCredits?.enabled ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
            {freeSaving && <Loader2 className="h-4 w-4 animate-spin text-purple-300" />}
          </div>
        </div>

        {/* The threshold is the binding constraint — say so explicitly so the
            toggle is never read as "free credits for everyone". */}
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
          <p className="text-xs font-medium text-amber-200">Volume threshold always applies</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/60">
            This toggle only <em>permits</em> the grant. The backend grants{" "}
            <strong className="font-semibold text-amber-100">
              {freeCredits?.grant_amount ?? 30} credits
            </strong>{" "}
            only when a school&apos;s initial capacity is{" "}
            <strong className="font-semibold text-amber-100">
              {freeCredits?.min_students ?? 500} students or more
            </strong>{" "}
            (inclusive — exactly {freeCredits?.min_students ?? 500} qualifies). Smaller schools receive no
            free credits regardless of this setting.
          </p>
        </div>

        <p className="mt-3 text-xs text-purple-300/40">
          The server is authoritative: the registration form&apos;s credit value is ignored, and this
          toggle never grants credits on its own. Changes apply to future registrations only.
        </p>

        {freeError && (
          <div className="mt-3 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{freeError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
