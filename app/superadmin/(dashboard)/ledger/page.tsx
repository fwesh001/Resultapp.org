"use client";

import { useCallback, useEffect, useState } from "react";
import { ReceiptText, Download, AlertCircle, Loader2, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { toTitleCase } from "@/lib/format";
import { formatNaira } from "@/lib/pricing";

interface LedgerEntry {
  id: number;
  subdomain: string;
  school_name?: string | null;
  token_type: string;
  amount: number;
  amount_ngn?: number;
  transaction_type: string;
  reference_id?: string | null;
  description?: string | null;
  created_at: string;
}

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  subdomain?: string | null;
  details?: Record<string, unknown>;
  created_at: string;
}

const LIMIT = 20;
const TOKEN_FILTERS = ["all", "CREDIT", "SLOT"] as const;

/** Ledger & Audit — global transactions, CSV export, admin-action trail. */
export default function LedgerPage() {
  const [tab, setTab] = useState<"ledger" | "audit">("ledger");
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [tokenType, setTokenType] = useState<(typeof TOKEN_FILTERS)[number]>("all");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (tokenType !== "all") qs.set("token_type", tokenType);
      const res = await fetch(`/api/superadmin/ledger?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setEntries((data as { entries?: LedgerEntry[] }).entries || []);
      setTotal((data as { total?: number }).total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, [offset, tokenType]);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/audit-logs?limit=50", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setAudit((data as { entries?: AuditEntry[] }).entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "ledger") void loadLedger();
    else void loadAudit();
  }, [tab, loadLedger, loadAudit]);

  async function handleExport() {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      if (tokenType !== "all") qs.set("token_type", tokenType);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      // Server streams full CSV directly — no pagination bottleneck.
      window.location.href = `/api/superadmin/ledger/export${suffix}`;
    } finally {
      setTimeout(() => setExporting(false), 2000);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]">
            <ReceiptText className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Ledger & Audit</h1>
            <p className="text-sm text-purple-200/60">Immutable platform transactions</p>
          </div>
        </div>
        {tab === "ledger" && (
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-900/10 px-4 py-2 text-xs font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Download CSV"}
          </button>
        )}
      </div>

      <div className="mt-6 grid max-w-md grid-cols-2 gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-2">
        {(["ledger", "audit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setOffset(0);
            }}
            className={
              tab === t
                ? "rounded-xl bg-purple-600 px-3 py-2 text-sm font-semibold text-white"
                : "rounded-xl px-3 py-2 text-sm font-medium text-purple-200/70 transition hover:bg-white/5 hover:text-white"
            }
          >
            {t === "ledger" ? "Transactions" : "Audit Trail"}
          </button>
        ))}
      </div>

      {tab === "ledger" && (
        <div className="mt-4 flex gap-2" role="group" aria-label="Token filter">
          {TOKEN_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTokenType(t);
                setOffset(0);
              }}
              aria-pressed={tokenType === t}
              className={
                tokenType === t
                  ? "rounded-full bg-purple-600 px-4 py-2 text-xs font-semibold text-white"
                  : "rounded-full border border-purple-500/20 bg-purple-900/10 px-4 py-2 text-xs font-medium text-purple-200 hover:bg-purple-900/20"
              }
            >
              {t === "all" ? "All" : t === "CREDIT" ? "Credits" : "Slots"}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {tab === "ledger" ? (
        <>
          <div className="mt-4 overflow-hidden rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] backdrop-blur">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-purple-500/10 bg-purple-950/20 text-left text-xs font-semibold uppercase tracking-wide text-purple-300/60">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">School</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-purple-300/60" />
                      </td>
                    </tr>
                  ) : entries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-sm text-purple-200/40">
                        No transactions yet.
                      </td>
                    </tr>
                  ) : (
                    entries.map((e) => (
                      <tr key={e.id} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-purple-300/60">
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-white">
                            {e.school_name ? toTitleCase(e.school_name) : e.subdomain}
                          </span>
                          <span className="ml-2 font-mono text-xs text-purple-300/40">{e.subdomain}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className="font-semibold text-white">
                            {e.amount > 0 ? "+" : ""}{e.amount} {e.token_type === "CREDIT" ? "cr" : "sl"}
                          </span>
                          {(e.amount_ngn ?? 0) > 0 && (
                            <span className="ml-2 text-xs text-emerald-300">{formatNaira(e.amount_ngn as number)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-0.5 text-xs text-purple-200">
                            {e.token_type}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-purple-300/60">{e.transaction_type}</td>
                        <td className="max-w-48 truncate px-4 py-3 font-mono text-xs text-purple-300/40">{e.reference_id || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-purple-300/40">Showing {entries.length} of {total}</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset <= 0 || loading}
                onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
                className="inline-flex items-center gap-1 rounded-full border border-purple-500/20 px-4 py-2 text-xs font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <button
                type="button"
                disabled={offset + LIMIT >= total || loading}
                onClick={() => setOffset((o) => o + LIMIT)}
                className="inline-flex items-center gap-1 rounded-full border border-purple-500/20 px-4 py-2 text-xs font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="mt-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-12 text-purple-200/60">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading audit trail…
            </div>
          ) : audit.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-12 text-center">
              <ScrollText className="h-6 w-6 text-purple-300/40" />
              <p className="text-sm text-purple-200/40">No recorded admin actions yet.</p>
            </div>
          ) : (
            audit.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-purple-500/10 bg-purple-900/[0.04] px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-purple-200">{a.action}</p>
                  <p className="mt-0.5 text-xs text-purple-300/50">
                    {a.actor} {a.subdomain ? `• ${a.subdomain}` : "• platform"}
                    {a.details && Object.keys(a.details).length > 0 && ` • ${JSON.stringify(a.details)}`}
                  </p>
                </div>
                <span className="whitespace-nowrap text-xs text-purple-300/40">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
