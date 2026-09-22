"use client";

import { useEffect, useState } from "react";
import { Building2, CheckCircle2, DollarSign, Coins, AlertCircle, Loader2, School } from "lucide-react";
import { formatNaira } from "@/lib/pricing";
import { KpiCard } from "@/components/superadmin/KpiCard";

interface Stats {
  mrr_this_month_ngn: number;
  mrr_last_month_ngn: number;
  mrr_delta_ngn: number;
  total_credits_consumed: number;
  total_schools: number;
  active_schools: number;
}

/** Platform Dashboard — advanced KPIs from immutable ledger records. */
export default function SuperadminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/superadmin/stats", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
        if (!cancelled) setStats(data as Stats);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-12 text-purple-200/60">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading platform stats…
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-300">
          <div className="flex gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error || "No stats available"}</span>
          </div>
        </div>
      </div>
    );
  }

  const deltaUp = stats.mrr_delta_ngn >= 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]">
          <School className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Platform Dashboard</h1>
          <p className="text-sm text-purple-200/60">Revenue and usage from immutable ledger records</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard icon={DollarSign} label="MRR — This Month" value={formatNaira(stats.mrr_this_month_ngn)} sub={`Last month ${formatNaira(stats.mrr_last_month_ngn)}`} />
        <KpiCard
          icon={deltaUp ? CheckCircle2 : AlertCircle}
          label="MRR Delta (MoM)"
          value={`${deltaUp ? "+" : ""}${formatNaira(stats.mrr_delta_ngn)}`}
          sub="Verified purchases only — grants excluded"
        />
        <KpiCard icon={Coins} label="Credits Consumed" value={stats.total_credits_consumed.toLocaleString()} sub="Global publication spend" />
        <KpiCard icon={Building2} label="Total Schools" value={stats.total_schools} sub="All tenants in registry" />
        <KpiCard icon={CheckCircle2} label="Active Schools" value={stats.active_schools} sub="Status: active" />
      </div>
    </div>
  );
}
