"use client";

import { useEffect, useState } from "react";
import { Settings, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import { formatNaira } from "@/lib/pricing";

/** Global Settings — platform tunables (moved out of the Dashboard). */
export default function SuperadminSettingsPage() {
  const [creditPrice, setCreditPrice] = useState<number>(200);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceMsg, setPriceMsg] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

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
    void loadPrice();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setPriceSaving(true);
    setPriceMsg(null);
    setPriceError(null);
    try {
      const res = await fetch("/api/admin/config/credit-price", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credit_price: creditPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setPriceMsg(`Saved: ${formatNaira((data as { credit_price: number }).credit_price)} per credit`);
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setPriceSaving(false);
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
          {priceMsg && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> {priceMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
