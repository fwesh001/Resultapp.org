"use client";

import { useEffect, useState, useMemo } from "react";
import { Building2, CheckCircle2, DollarSign, School, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { calculateTieredTotal, formatNaira } from "@/lib/pricing";
import { toTitleCase } from "@/lib/format";

interface Tenant {
  id: string;
  subdomain: string;
  school_name: string;
  subscription_status: string | null;
  student_count: number;
  created_at: string;
  email?: string | null;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.06] p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-purple-200/60">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-600/20 text-purple-300 ring-1 ring-purple-500/20">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-purple-300/40">{sub}</p>}
    </div>
  );
}

export default function SuperAdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creditPrice, setCreditPrice] = useState<number>(200);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceMsg, setPriceMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/superadmin/tenants", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
        }
        const list = (data as { tenants?: Tenant[] }).tenants || [];
        if (!cancelled) setTenants(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load tenants");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const kpis = useMemo(() => {
    const total = tenants.length;
    const active = tenants.filter((t) => (t.subscription_status || "").toLowerCase() === "active").length;
    const revenue = tenants
      .filter((t) => (t.subscription_status || "").toLowerCase() === "active")
      .reduce((sum, t) => sum + calculateTieredTotal(t.student_count || 0), 0);
    return { total, active, revenue };
  }, [tenants]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0514] px-6 py-16">
        <div className="mx-auto flex max-w-5xl items-center justify-center gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-12 text-purple-200/60">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading tenants…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0B0514] px-6 py-16">
        <div className="mx-auto max-w-5xl rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-300">
          <div className="flex gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
          <p className="mt-3 text-xs text-red-300/60">
            Ensure FastAPI is reachable and <span className="font-mono">BACKEND_API_SECRET</span> matches{" "}
            <span className="font-mono">API_SECRET_KEY</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0514] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]">
            <School className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Super Admin — Tenants</h1>
            <p className="text-sm text-purple-200/60">Platform owner view • Live tenant registry</p>
          </div>
        </div>

        {/* Credit price tuner */}
        <div className="mt-6 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5 backdrop-blur">
          <h2 className="text-sm font-semibold text-white">Publishing Credit Price (Superadmin)</h2>
          <p className="mt-1 text-xs text-purple-200/60">Flat NGN per credit — applies to all future credit top-ups. Slots remain tiered (100/90/80).</p>
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
              onClick={async () => {
                setPriceSaving(true);
                setPriceMsg(null);
                try {
                  const res = await fetch("/api/admin/config/credit-price", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ credit_price: creditPrice }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error((data as { error?: string }).error || `Failed (${res.status})`);
                  setPriceMsg(`Saved: ${formatNaira((data as { credit_price: number }).credit_price)} per credit`);
                } catch (e) {
                  setPriceMsg(e instanceof Error ? e.message : "Failed to save");
                } finally {
                  setPriceSaving(false);
                }
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-purple-600 px-5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-60"
            >
              {priceSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Price
            </button>
            {priceMsg && <span className="text-xs text-purple-200/60">{priceMsg}</span>}
          </div>
        </div>

        {/* KPIs */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <KpiCard icon={Building2} label="Total Schools" value={kpis.total} sub="Newest first" />
          <KpiCard icon={CheckCircle2} label="Active Schools" value={kpis.active} sub="Status: active" />
          <KpiCard icon={DollarSign} label="Total Revenue" value={formatNaira(kpis.revenue)} sub="Active schools only" />
        </div>

        {/* Table */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] backdrop-blur">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-purple-500/10 bg-purple-950/20 text-left text-xs font-semibold uppercase tracking-wide text-purple-300/60">
                  <th className="px-4 py-3">Subdomain</th>
                  <th className="px-4 py-3">School Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Student Count</th>
                  <th className="px-4 py-3">Created At</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tenants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-purple-200/40">
                      No tenants yet. Provision a school via <span className="font-mono">POST /api/v1/provision</span>.
                    </td>
                  </tr>
                ) : (
                  tenants.map((t) => {
                    const isActive = (t.subscription_status || "").toLowerCase() === "active";
                    return (
                      <tr key={t.id || t.subdomain} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                        <td className="px-4 py-3 font-mono text-sm font-medium text-white">{t.subdomain}</td>
                        <td className="px-4 py-3">{toTitleCase(t.school_name)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                              isActive
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                : "border-red-500/20 bg-red-500/10 text-red-300"
                            }`}
                          >
                            {isActive ? "Active" : t.subscription_status || "Unpaid"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{t.student_count ?? 0}</td>
                        <td className="px-4 py-3 text-xs text-purple-300/50">
                          {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={`https://${t.subdomain}.resultapp.org`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-purple-300 hover:text-white"
                          >
                            Visit <ExternalLink className="h-3 w-3" />
                          </a>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-purple-300/30">
          Live data • {tenants.length} {tenants.length === 1 ? "school" : "schools"}
        </p>
      </div>
    </div>
  );
}
