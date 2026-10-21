"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  Coins,
  Layers,
  Loader2,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import { toTitleCase } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface TenantRow {
  subdomain: string;
  school_name: string;
  email?: string | null;
  is_active?: boolean;
  deleted_at?: string | null;
  credit_balance?: number | null;
  slots_balance?: number | null;
}

interface LedEntry {
  id: number;
  subdomain: string;
  token_type: "CREDIT" | "SLOT";
  transaction_type: string;
  amount: number;
  description: string | null;
  created_at: string;
}

/**
 * Credit & Slot Adjustments — the dedicated allocate/deduct surface.
 *
 * A deduction is REJECTED by the backend when it exceeds the school's
 * balance (balances never go negative), and both directions require a
 * reason (min 3 chars) that is (a) written into the billing ledger, (b)
 * audited, and (c) announced to the school's admin bell through
 * TOKEN_ADJUSTED. This view just surfaces those server decisions.
 */
export default function AdjustmentsView() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tenantId, setTenantId] = useState("");
  const [direction, setDirection] = useState<"allocate" | "deduct">("allocate");
  const [tokenType, setTokenType] = useState<"CREDIT" | "SLOT">("CREDIT");
  const [amount, setAmount] = useState("50");
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);
  const [lastResult, setLastResult] = useState<{ new_balance: number; notified: boolean } | null>(null);

  const [history, setHistory] = useState<LedEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.subdomain.toLowerCase().includes(q) ||
        String(t.school_name || "").toLowerCase().includes(q),
    );
  }, [tenants, search]);

  const selected = tenants.find((t) => t.subdomain === tenantId) ?? null;
  const balance =
    tokenType === "CREDIT" ? selected?.credit_balance ?? 0 : selected?.slots_balance ?? 0;

  const loadTenants = useCallback(async () => {
    // NOTE: no synchronous setState before the first await — the initial
    // loading states start true, and a refresh keeps the stale list on screen
    // until fresh data lands (no spinner flicker, no cascading render).
    try {
      const res = await fetch("/api/superadmin/tenants?limit=500", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setTenants(((data as { tenants?: TenantRow[] }).tenants ?? []) as TenantRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load schools");
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/superadmin/tenants/adjustments?limit=50", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setHistory(((data as { entries?: LedEntry[] }).entries ?? []) as LedEntry[]);
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Could not load history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial boot — every setState happens AFTER the awaits (the react-hooks
    // set-state-in-effect rule; also why the loaders below set no spinner at
    // effect time). The useCallback loaders remain for event-handler refresh,
    // where the stale list simply stays on screen until fresh data lands.
    let cancelled = false;
    async function boot() {
      try {
        const [tRes, hRes] = await Promise.all([
          fetch("/api/superadmin/tenants?limit=500", { cache: "no-store" }),
          fetch("/api/superadmin/tenants/adjustments?limit=50", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        const tData = await tRes.json().catch(() => ({}));
        if (!tRes.ok) {
          setError((tData as { error?: string })?.error || `Failed (${tRes.status})`);
        } else {
          setTenants(((tData as { tenants?: TenantRow[] }).tenants ?? []) as TenantRow[]);
        }
        if (cancelled) return;
        const hData = await hRes.json().catch(() => ({}));
        if (!hRes.ok) {
          setHistoryError((hData as { error?: string })?.error || `Failed (${hRes.status})`);
        } else {
          setHistory(((hData as { entries?: LedEntry[] }).entries ?? []) as LedEntry[]);
        }
      } catch {
        if (!cancelled) {
          setError("Could not load schools");
          setHistoryError("Could not load history");
        }
      } finally {
        if (!cancelled) {
          setTenantsLoading(false);
          setHistoryLoading(false);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
    const amt = parseInt(amount, 10);
    if (!tenantId) {
      setError("Choose a school first");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0 || amt > 10000) {
      setError("Amount must be 1-10000");
      return;
    }
    if (direction === "deduct" && amt > balance) {
      setError(`Insufficient balance: this school holds ${balance} to deduct from`);
      return;
    }
    if (reason.trim().length < 3) {
      setError("A reason (min 3 characters) is required — it goes to the school's admin");
      return;
    }
    setError(null);
    setActing(true);
    try {
      const res = await fetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_type: tokenType,
          direction,
          amount: amt,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      const ok = data as { new_balance?: number; notified?: boolean };
      toast.success(
        `${direction === "allocate" ? "Allocated" : "Deducted"} ${amt} ${tokenType.toLowerCase()} to ${tenantId} (new balance ${ok.new_balance}).`,
        { description: ok.notified ? "The school's admin was notified with your reason." : "No admin bell sent — the school has no admin email on record." },
      );
      setLastResult({ new_balance: ok.new_balance ?? 0, notified: !!ok.notified });
      setReason("");
      await Promise.all([loadTenants(), loadHistory()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjustment failed");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-[0_0_20px_rgba(147,51,234,0.35)]">
          <Coins className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-1">Credit &amp; Slot Adjustments</h1>
          <p className="text-sm text-text-2">
            Allocate or deduct tokens per school — with a required reason, wired to the school&apos;s admin bell.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------------------------- */}
        {/* Adjustment form                                                  */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-2xl border border-line-1 bg-surface-1 p-5">
          <h2 className="text-sm font-semibold text-text-1">New adjustment</h2>

          <label className="mt-4 block text-xs font-medium text-text-2" htmlFor={"school-picker"}>
            School
          </label>
          {tenantsLoading ? (
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-line-1 bg-surface-0 px-3 py-2.5 text-sm text-text-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading schools…
            </div>
          ) : (
            <>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-line-1 bg-surface-0 px-3">
                <Search className="h-4 w-4 shrink-0 text-text-3" />
                <input
                  id="school-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by name or subdomain…"
                  className="w-1/2 border-0 bg-transparent py-2.5 text-sm text-text-1 placeholder:text-text-3 focus:outline-none"
                />
                <select
                  id="school-picker"
                  value={tenantId}
                  onChange={(e) => {
                    setTenantId(e.target.value);
                    setLastResult(null);
                  }}
                  className="w-1/2 bg-transparent py-2.5 text-sm text-text-1 focus:outline-none"
                >
                  <option value="">— pick a school —</option>
                  {filtered.map((t) => (
                    <option key={t.subdomain} value={t.subdomain}>
                      {t.school_name || t.subdomain} ({t.subdomain})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {selected && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line-1 bg-surface-0/60 px-3 py-2 text-xs">
              <span className="text-text-2">
                {toTitleCase(selected.school_name)}{" "}
                <span className="font-mono text-text-3">· {selected.subdomain}.resultapp.org</span>
              </span>
              <span className="flex items-center gap-2 text-text-3">
                <Coins className="h-3.5 w-3.5" /> {selected.credit_balance ?? 0}
                <Layers className="h-3.5 w-3.5" /> {selected.slots_balance ?? 0}
              </span>
            </div>
          )}

          {/* Direction */}
          <div className="mt-4">
            <p className="text-xs font-medium text-text-2">Direction</p>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setDirection("allocate")}
                aria-pressed={direction === "allocate"}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
                  direction === "allocate"
                    ? "border-success/40 bg-success-soft font-semibold text-success"
                    : "border-line-1 text-text-2 hover:bg-surface-2",
                )}
              >
                <ArrowUpCircle className="h-4 w-4" /> Allocate
              </button>
              <button
                type="button"
                onClick={() => setDirection("deduct")}
                aria-pressed={direction === "deduct"}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
                  direction === "deduct"
                    ? "border-danger/40 bg-danger-soft font-semibold text-danger"
                    : "border-line-1 text-text-2 hover:bg-surface-2",
                )}
              >
                <ArrowDownCircle className="h-4 w-4" /> Deduct
              </button>
            </div>
            {direction === "deduct" && (
              <p className="mt-2 text-xs text-text-3">
                Rejected outright when it exceeds the school&apos;s balance — balances never go negative.
              </p>
            )}
          </div>

          {/* Token type */}
          <div className="mt-4">
            <p className="text-xs font-medium text-text-2">Token type</p>
            <div className="mt-1 flex gap-2">
              {(["CREDIT", "SLOT"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTokenType(t)}
                  aria-pressed={tokenType === t}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
                    tokenType === t
                      ? "border-accent bg-accent-soft font-semibold text-accent"
                      : "border-line-1 text-text-2 hover:bg-surface-2",
                  )}
                >
                  {t === "CREDIT" ? <Coins className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
                  {t === "CREDIT" ? "Credits" : "Slots"}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <label className="mt-4 block text-xs font-medium text-text-2" htmlFor="adjust-amount">
            Amount {selected ? `(current: ${balance})` : ""}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              aria-label="decrease amount"
              onClick={() => setAmount(String(Math.max(1, (parseInt(amount, 10) || 1) - 1)))}
              className="rounded-lg border border-line-1 p-2 text-text-2 hover:bg-surface-2"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              id="adjust-amount"
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              className="w-28 rounded-xl border border-line-1 bg-surface-0 px-3 py-2 text-center text-sm text-text-1 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              aria-label="increase amount"
              onClick={() => setAmount(String((parseInt(amount, 10) || 0) + 1))}
              className="rounded-lg border border-line-1 p-2 text-text-2 hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Reason — REQUIRED, announced to the school admin */}
          <label className="mt-4 block text-xs font-medium text-text-2" htmlFor="adjust-reason">
            Reason (required — shown to the school&apos;s admin)
          </label>
          <textarea
            id="adjust-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Compensation for failed publish batch on Oct 12"
            className="mt-1 w-full rounded-xl border border-line-1 bg-surface-0 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
          />

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={acting}
            className={cn(
              "mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold disabled:opacity-60",
              direction === "deduct"
                ? "bg-danger text-white hover:bg-red-600"
                : "bg-accent text-accent-fg hover:bg-accent-hover",
            )}
          >
            {acting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : direction === "deduct" ? (
              <ArrowDownCircle className="h-4 w-4" />
            ) : (
              <ArrowUpCircle className="h-4 w-4" />
            )}
            {acting
              ? "Applying…"
              : direction === "allocate"
                ? `Allocate ${amount || "—"} ${tokenType.toLowerCase()}`
                : `Deduct ${amount || "—"} ${tokenType.toLowerCase()}`}
          </button>

          {lastResult && (
            <p className="mt-3 rounded-xl border border-success/40 bg-success-soft px-3 py-2 text-xs text-success">
              Done — new balance {lastResult.new_balance}.{" "}
              {lastResult.notified
                ? "The school's admin was notified in their bell."
                : "No admin bell was sent (no admin email on record)."}
            </p>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* History                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-2xl border border-line-1 bg-surface-1 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text-1">Recent adjustments</h2>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="text-xs text-text-3 hover:text-text-1"
            >
              Refresh
            </button>
          </div>
          {historyError && (
            <div className="mt-3 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{historyError}</span>
            </div>
          )}
          {historyLoading ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-line-1 bg-surface-0 p-4 text-sm text-text-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
            </div>
          ) : history.length === 0 ? (
            <p className="mt-3 rounded-xl border border-line-1 bg-surface-0 p-4 text-xs text-text-3">
              No grants or deductions recorded yet.
            </p>
          ) : (
            <ul className="mt-3 max-h-[480px] space-y-2 overflow-y-auto pr-1">
              {history.map((h) => {
                const deducted = h.transaction_type.startsWith("DEDUCT");
                return (
                  <li key={h.id} className="rounded-xl border border-line-1 bg-surface-0/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          deducted ? "text-danger" : "text-success",
                        )}
                      >
                        {deducted ? "−" : "+"}
                        {h.amount} {h.token_type.toLowerCase()}{h.amount === 1 ? "" : "s"}
                      </span>
                      <Link
                        href={`/superadmin/tenants/${h.subdomain}`}
                        className="font-mono text-xs text-text-2 hover:text-accent"
                      >
                        {h.subdomain}
                      </Link>
                    </div>
                    {h.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-text-3">{h.description}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-text-3">
                      {new Date(h.created_at).toLocaleString()}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
