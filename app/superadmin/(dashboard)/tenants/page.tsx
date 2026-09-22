"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Search, AlertCircle, CheckCircle2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { toTitleCase } from "@/lib/format";
import { TenantRowMenu, type TenantMenuTarget } from "@/components/superadmin/TenantRowMenu";
import { SuspendTenantModal, DeleteTenantModal } from "@/components/superadmin/TenantLifecycleModals";

interface Tenant {
  id: string;
  subdomain: string;
  school_name: string;
  subscription_status: string | null;
  is_active?: boolean;
  deleted_at?: string | null;
  student_count: number;
  created_at: string;
  email?: string | null;
}

const LIMIT = 20;
const STATUSES = ["all", "active", "unpaid", "suspended", "deleted"] as const;

function statusLabel(t: Tenant): string {
  if (t.deleted_at) return "Deleted";
  if (t.is_active === false) return "Suspended";
  const s = (t.subscription_status || "").toLowerCase();
  if (s === "active") return "Active";
  return t.subscription_status || "Unpaid";
}

/** Tenant Directory — server-side pagination, search, status filter. */
export default function TenantsDirectoryPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<TenantMenuTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TenantMenuTarget | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        status,
      });
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const res = await fetch(`/api/superadmin/tenants?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setTenants((data as { tenants?: Tenant[] }).tenants || []);
      setTotal((data as { total?: number }).total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]">
          <Building2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Tenants</h1>
          <p className="text-sm text-purple-200/60">
            {total} {total === 1 ? "school" : "schools"} • page {page} of {totalPages}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-purple-300/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, subdomain, email…"
            className="w-full rounded-xl border border-purple-500/20 bg-purple-950/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
          />
        </div>
        <div className="flex gap-2" role="group" aria-label="Status filter">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              aria-pressed={status === s}
              className={
                status === s
                  ? "rounded-full bg-purple-600 px-4 py-2 text-xs font-semibold text-white"
                  : "rounded-full border border-purple-500/20 bg-purple-900/10 px-4 py-2 text-xs font-medium text-purple-200 hover:bg-purple-900/20"
              }
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] backdrop-blur">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-purple-500/10 bg-purple-950/20 text-left text-xs font-semibold uppercase tracking-wide text-purple-300/60">
                <th className="px-4 py-3">Subdomain</th>
                <th className="px-4 py-3">School Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Students</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-purple-200/40">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-purple-200/40">
                    No tenants match this filter.
                  </td>
                </tr>
              ) : (
                tenants.map((t) => {
                  const label = statusLabel(t);
                  return (
                    <tr key={t.id || t.subdomain} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                      <td className="px-4 py-3">
                        <Link href={`/superadmin/tenants/${t.subdomain}`} className="font-mono text-sm font-medium text-white hover:text-purple-300">
                          {t.subdomain}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{toTitleCase(t.school_name)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                            label === "Active"
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                              : label === "Suspended"
                                ? "border-zinc-500/20 bg-zinc-500/10 text-zinc-300"
                                : "border-red-500/20 bg-red-500/10 text-red-300"
                          }`}
                        >
                          {label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{t.student_count ?? 0}</td>
                      <td className="px-4 py-3 text-xs text-purple-300/50">
                        {t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}
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

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-purple-300/40">
          Showing {tenants.length} of {total}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 rounded-full border border-purple-500/20 px-4 py-2 text-xs font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-full border border-purple-500/20 px-4 py-2 text-xs font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-40"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
