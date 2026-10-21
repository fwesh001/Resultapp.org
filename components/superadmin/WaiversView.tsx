"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ticket,
  AlertCircle,
  Loader2,
  Check,
  Copy,
  Ban,
  ShieldCheck,
  Info,
} from "lucide-react";
import { formatNaira, getPricingTier, MIN_REGISTRATION_STUDENTS } from "@/lib/pricing";
import { allowanceBounds, MAX_SLOTS } from "@/lib/waiverPricing";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Superadmin waiver tokens — generator + audit trail.
 *
 * A waiver token is a superadmin-issued bearer code that discounts a slot
 * purchase. Two properties make this page more than a CRUD form, and both are
 * built into the UI rather than left to the operator to remember:
 *
 *   1. THE CODE IS SHOWN ONCE. It is hashed at rest, so there is no way to
 *      recover it later. A page that let you "view" a token after the fact
 *      would be lying. The copy-once panel is the only moment it exists.
 *
 *   2. ISSUANCE SHOWS WHAT IT COSTS. A 50% waiver over 1000 slots is NGN
 *      40,000 of forgone revenue; over 999 it is NGN 44,955, because the
 *      volume tier boundary sits between them. That difference is invisible
 *      unless the page shows it, and a superadmin should never mint a
 *      five-figure discount without seeing the figure first.
 */

type AppliesTo = "REGISTRATION" | "TOPUP" | "BOTH";
type TokenStatus = "open" | "reserved" | "consumed" | "voided" | "expired";

interface WaiverToken {
  id: number;
  token_prefix: string;
  token_fingerprint: string;
  discount_percentage: number;
  slot_allowance: number;
  applies_to: AppliesTo;
  locked_to_tenant: string | null;
  restores_suspension: boolean;
  status: TokenStatus;
  is_used: boolean;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  note: string | null;
  slots_requested: number | null;
  slots_waived: number | null;
  slots_forfeited: number | null;
  discount_ngn: number | null;
  charged_slots: number | null;
  charged_ngn: number | null;
  used_by_tenant: string | null;
  used_at: string | null;
  transaction_ref: string | null;
}

const LIMIT = 20;

const STATUS_STYLE: Record<TokenStatus, string> = {
  open: "bg-success-soft text-success border-success/40",
  reserved: "bg-warning-soft text-warning border-warning/30",
  consumed: "bg-accent-soft text-accent border-line-1",
  voided: "bg-surface-2 text-text-2 border-line-1",
  expired: "bg-surface-2 text-text-3 border-line-1",
};

/**
 * What the top-up slider allows.
 *
 * BillingCheckout's range input starts at 50. A token with a smaller allowance
 * is still perfectly VALID — it just cannot be spent through the slider, so the
 * buyer has to type the number instead. Worth saying out loud rather than
 * letting someone discover it at checkout.
 */
const SLIDER_FLOOR = 50;

export default function SuperadminWaiversPage() {
  // --- generator -----------------------------------------------------------
  const [pct, setPct] = useState(50);
  const [allowance, setAllowance] = useState(100);
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("BOTH");
  const [lockedTo, setLockedTo] = useState("");
  const [restores, setRestores] = useState(false);
  const [ttlDays, setTtlDays] = useState(30);
  const [note, setNote] = useState("");
  const [minting, setMinting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The one and only time the plaintext exists in a browser.
  const [issued, setIssued] = useState<{ token_string: string; notional_ngn: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // --- audit list ----------------------------------------------------------
  const [tokens, setTokens] = useState<WaiverToken[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"all" | TokenStatus>("all");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<number | null>(null);

  // Manual bypass-recovery run.
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<{
    scanned: number;
    recovered: number;
    already_done: number;
    orphans: { tx_ref: string; subdomain: string; outcome: string; detail?: string }[];
  } | null>(null);

  async function runSweep() {
    setSweeping(true);
    try {
      const res = await fetch("/api/waiver/sweep", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Sweep failed (${res.status})`);
      }
      setSweepResult({
        scanned: data.scanned ?? 0,
        recovered: data.recovered ?? 0,
        already_done: data.already_done ?? 0,
        orphans: Array.isArray(data.orphans) ? data.orphans : [],
      });
      toast.success(`Swept ${data.scanned ?? 0} orphaned registration(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setSweeping(false);
    }
  }

  /** Floor/ceiling for the allowance, narrowed by scope. See allowanceBounds. */
  const bounds = useMemo(() => {
    try {
      return allowanceBounds(appliesTo);
    } catch {
      return { min: MIN_REGISTRATION_STUDENTS, max: MAX_SLOTS };
    }
  }, [appliesTo]);

  // Switching scope can strand the current allowance below the new floor.
  // Clamp rather than show an error, so the field never sits in a state the
  // backend will reject.
  useEffect(() => {
    setAllowance((a) => Math.min(Math.max(a, bounds.min), bounds.max));
  }, [bounds.min, bounds.max]);

  /**
   * Live valuation at the tier the allowance lands in.
   *
   * Mirrors `_notional_value()` in services/waivers.py. It is display-only —
   * the backend recomputes it — but a wrong figure here would still mislead the
   * person deciding whether to press the button.
   */
  const valuation = useMemo(() => {
    const unit = getPricingTier(allowance).pricePerStudent;
    const worth = Math.floor((allowance * unit * pct) / 100);
    const tier = getPricingTier(allowance);
    const nextBoundary = allowance < 500 ? 500 : allowance < 1000 ? 1000 : null;
    return { unit, worth, tier, nextBoundary };
  }, [allowance, pct]);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const qs = new URLSearchParams({ limit: String(LIMIT), offset: String((page - 1) * LIMIT) });
      if (status !== "all") qs.set("status", status);
      const res = await fetch(`/api/superadmin/waivers?${qs}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
      setTotal(Number(data.total ?? 0));
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load");
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleMint() {
    setMinting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/superadmin/waivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discount_percentage: pct,
          slot_allowance: allowance,
          applies_to: appliesTo,
          locked_to_tenant: lockedTo.trim() || null,
          restores_suspension: restores,
          ttl_days: ttlDays,
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw new Error(data.error || `Failed (${res.status})`);
      setIssued({
        token_string: data.token.token_string,
        notional_ngn: Number(data.token.notional_ngn ?? 0),
      });
      setCopied(false);
      toast.success("Waiver token created");
      setNote("");
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to create token");
    } finally {
      setMinting(false);
    }
  }

  async function handleCopy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token_string);
      setCopied(true);
      toast.success("Copied to clipboard");
    } catch {
      // Clipboard is blocked in some browsers over plain HTTP. Say so instead
      // of leaving the operator thinking they have a copy they do not.
      toast.warning("Copy blocked by the browser — select and copy manually");
    }
  }

  async function handleVoid(id: number) {
    setVoiding(id);
    try {
      const res = await fetch(`/api/superadmin/waivers/${id}/void`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      toast.success(`Token #${id} cancelled`);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the token");
    } finally {
      setVoiding(null);
    }
  }

  const canMint = pct >= 1 && pct <= 100 && allowance >= bounds.min && allowance <= bounds.max;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-[0_0_20px_rgba(147,51,234,0.35)]">
          <Ticket className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-1">Waiver Tokens</h1>
          <p className="text-sm text-text-2">
            Single-use discount codes for slot purchases
          </p>
        </div>
      </div>

      {/* ================================================================= */}
      {/* COPY ONCE — rendered before anything else so it cannot be missed */}
      {/* ================================================================= */}
      {issued && (
        <div className="mt-6 rounded-2xl border border-success/40 bg-success-soft p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-success">
            <ShieldCheck className="h-4 w-4" />
            Copy this code now — it cannot be shown again
          </h2>
          <p className="mt-1 text-xs text-success">
            Only a SHA-256 hash is stored. Nobody, including you, can recover this code later.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="select-all rounded-xl border border-success/40 bg-black/30 px-4 py-3 font-mono text-sm text-success">
              {issued.token_string}
            </code>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={copied}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-xs text-success">
            Worth up to {formatNaira(issued.notional_ngn)} when fully redeemed.
          </p>
          <button
            type="button"
            onClick={() => setIssued(null)}
            disabled={!copied}
            title={copied ? undefined : "Copy the code before dismissing"}
            className="mt-4 inline-flex min-h-[44px] items-center rounded-full border border-success/40 px-5 text-sm text-success hover:bg-success-soft disabled:opacity-40"
          >
            {copied ? "Done — create another" : "Copy the code first"}
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* GENERATOR                                                          */}
      {/* ================================================================= */}
      <div className="mt-4 rounded-2xl border border-line-1 bg-surface-1 p-5 backdrop-blur">
        <h2 className="text-sm font-semibold text-text-1">Generate a token</h2>

        {formError && (
          <div className="mt-3 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-1">Applies to</span>
            <select
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value as AppliesTo)}
              className="h-10 rounded-xl border border-line-1 bg-surface-3 px-3 text-sm text-text-1 focus:border-accent focus:outline-none"
            >
              <option value="BOTH">Registration and top-ups</option>
              <option value="REGISTRATION">Registration only</option>
              <option value="TOPUP">Top-ups only</option>
            </select>
            <p className="text-xs text-text-3">
              {appliesTo === "TOPUP"
                ? "Top-ups have no minimum, so any allowance from 1 is valid."
                : `Registration has a ${MIN_REGISTRATION_STUDENTS}-slot floor, so the allowance must be at least ${bounds.min} — below that the code would fail validation at checkout, after the buyer entered their card details.`}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="waiver-pct" className="text-sm font-medium text-text-1">
              Discount
            </label>
            <div className="flex items-center gap-2">
              {[50, 75, 100].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPct(p)}
                  aria-pressed={pct === p}
                  className={cn(
                    "min-h-[44px] rounded-full border px-4 text-xs font-medium transition",
                    pct === p
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-line-1 bg-surface-1 text-text-2 hover:border-line-1",
                  )}
                >
                  {p}%
                </button>
              ))}
              <input
                id="waiver-pct"
                type="number"
                min={1}
                max={100}
                value={pct}
                onChange={(e) => setPct(Math.min(100, Math.max(1, Number(e.target.value) || 0)))}
                className="w-24 rounded-xl border border-line-1 bg-surface-3 px-3 py-2 text-sm text-text-1 focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="waiver-allowance" className="text-sm font-medium text-text-1">
              Slot allowance
            </label>
            <input
              id="waiver-allowance"
              type="number"
              min={bounds.min}
              max={bounds.max}
              value={allowance}
              onChange={(e) => setAllowance(Number(e.target.value) || 0)}
              className="h-10 rounded-xl border border-line-1 bg-surface-3 px-3 text-sm text-text-1 focus:border-accent focus:outline-none"
            />
            <p className="text-xs text-text-3">
              Between {bounds.min} and {bounds.max.toLocaleString()} slots.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="waiver-ttl" className="text-sm font-medium text-text-1">
              Valid for (days)
            </label>
            <input
              id="waiver-ttl"
              type="number"
              min={1}
              max={365}
              value={ttlDays}
              onChange={(e) => setTtlDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
              className="h-10 rounded-xl border border-line-1 bg-surface-3 px-3 text-sm text-text-1 focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="waiver-locked" className="text-sm font-medium text-text-1">
              Lock to a school (optional)
            </label>
            <input
              id="waiver-locked"
              type="text"
              placeholder="e.g. victoryhigh"
              value={lockedTo}
              onChange={(e) => setLockedTo(e.target.value.toLowerCase())}
              className="h-10 rounded-xl border border-line-1 bg-surface-3 px-3 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
            />
            <p className="text-xs text-text-3">
              Leave blank to let any school redeem it.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="waiver-note" className="text-sm font-medium text-text-1">
              Note (optional)
            </label>
            <input
              id="waiver-note"
              type="text"
              placeholder="Why was this issued?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-10 rounded-xl border border-line-1 bg-surface-3 px-3 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* --- Suspension restore: off by default, and it must be. -------- */}
        <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-line-1 bg-surface-1 p-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-text-1">
              Lift a non-payment suspension when redeemed
            </p>
            <p className="mt-0.5 text-xs text-text-2">
              Off by default. A waiver is not a payment, so redeeming one should not
              restore a school that was cut off for not paying. An &ldquo;abuse&rdquo;
              or &ldquo;legal&rdquo; suspension can never be lifted by this, or by paying.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={restores}
            aria-label="Lift a non-payment suspension when redeemed"
            onClick={() => setRestores((v) => !v)}
            className={cn(
              "relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
              restores ? "bg-amber-500" : "bg-surface-3",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                restores ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>

        {/* --- Valuation ---------------------------------------------------- */}
        <div className="mt-4 rounded-xl border border-line-1 bg-surface-1 p-4">
          <p className="flex items-center gap-2 text-xs font-medium text-text-2">
            <Info className="h-3.5 w-3.5" />
            What this gives away
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text-1">
            {formatNaira(valuation.worth)}
          </p>
          <p className="mt-1 text-xs text-text-2">
            {pct}% of {allowance.toLocaleString()} slots at{" "}
            {formatNaira(valuation.unit)} per slot
            {valuation.tier.badge ? ` — ${valuation.tier.badge}` : ""}.
          </p>

          {valuation.nextBoundary && (
            <p className="mt-2 text-xs text-warning">
              Heads up: {valuation.nextBoundary.toLocaleString()} slots crosses into the next
              volume tier. A code for {valuation.nextBoundary.toLocaleString()} slots is worth
              less than this one at the same percentage — the price per slot drops.
            </p>
          )}

          {allowance < SLIDER_FLOOR && appliesTo !== "REGISTRATION" && (
            <p className="mt-2 text-xs text-warning">
              Below {SLIDER_FLOOR} slots the top-up slider cannot reach this allowance, so a
              buyer will have to type the number instead of dragging it. The code is still
              valid.
            </p>
          )}

          <p className="mt-3 text-xs text-text-3">
            If the buyer takes fewer slots than the allowance, the token is consumed anyway and
            the remainder is permanently forfeited.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleMint()}
          disabled={minting || !canMint}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          {minting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Generate token
        </button>
      </div>

      {/* ================================================================= */}
      {/* BYPASS RECOVERY                                                 */}
      {/* ================================================================= */}
      {/*
        A 100% waiver produces no Flutterwave charge, so `charge.completed`
        never fires and the webhook safety net does not exist for it. The cron
        at /api/waiver/sweep is what recovers a school whose tab closed during
        a fully-waived registration — the people most likely to use these codes
        are the least technical buyers on the platform.

        This button is the manual equivalent: useful when an operator is told a
        school "paid nothing and got no portal", and useful as a smoke test that
        the cron is actually working after a deploy.
      */}
      <div className="mt-4 rounded-2xl border border-line-1 bg-surface-1 p-5 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-text-1">
              <ShieldCheck className="h-4 w-4 text-cyan-300" />
              Abandoned waiver registrations
            </h2>
            <p className="mt-1 text-xs text-text-2">
              Fully-waived registrations whose browser never finished. The cron
              recovers these automatically after {3} minutes; this runs it now.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runSweep()}
            disabled={sweeping}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-line-1 px-5 text-sm text-text-2 hover:bg-surface-2 disabled:opacity-50"
          >
            {sweeping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Recover now
          </button>
        </div>

        {sweepResult && (
          <div
            className={`mt-4 rounded-xl border p-3 text-xs ${
              sweepResult.recovered > 0
                ? "border-success/40 bg-success-soft text-success"
                : "border-line-1 bg-surface-1 text-text-2"
            }`}
          >
            <p className="font-medium">
              Scanned {sweepResult.scanned} · recovered {sweepResult.recovered}
              {sweepResult.already_done > 0 && ` · ${sweepResult.already_done} already completed`}
            </p>
            {sweepResult.orphans.length > 0 && (
              <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-text-2">
                {sweepResult.orphans.map((o) => (
                  <li key={o.tx_ref}>
                    {o.subdomain} — {o.outcome}
                    {o.detail ? ` (${o.detail.slice(0, 80)})` : ""}
                  </li>
                ))}
              </ul>
            )}
            {sweepResult.scanned === 0 && (
              <p className="mt-1 text-text-3">
                Nothing to recover — every fully-waived registration completed normally.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* AUDIT                                                              */}
      {/* ================================================================= */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-1">
          Issued tokens <span className="text-text-3">({total})</span>
        </h2>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "all" | TokenStatus);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="h-9 rounded-xl border border-line-1 bg-surface-3 px-3 text-sm text-text-1 focus:border-accent focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="reserved">Reserved</option>
          <option value="consumed">Consumed</option>
          <option value="voided">Voided</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {listError && (
        <div className="mt-3 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{listError}</span>
        </div>
      )}

      <div className="mt-3 overflow-hidden rounded-2xl border border-line-1 bg-surface-1 backdrop-blur">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-1 text-left text-xs text-text-2">
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Terms</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Redeemed by</th>
              <th className="px-4 py-3 font-medium">Outcome</th>
              <th className="px-4 py-3 font-medium">Issued</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-2">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && tokens.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-2">
                  No waiver tokens yet.
                </td>
              </tr>
            )}
            {tokens.map((t) => (
              <tr key={t.id} className="border-b border-line-1 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-text-2">
                  {t.token_prefix}…{t.token_fingerprint}
                </td>
                <td className="px-4 py-3 text-text-1">
                  {t.discount_percentage}% · {t.slot_allowance.toLocaleString()} slots
                  <span className="ml-1.5 text-xs text-text-3">{t.applies_to}</span>
                  {t.locked_to_tenant && (
                    <span className="ml-1.5 text-xs text-warning">
                      → {t.locked_to_tenant}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium",
                      STATUS_STYLE[t.status] ?? STATUS_STYLE.expired,
                    )}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-2">
                  {t.used_by_tenant ?? <span className="text-text-3">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-text-2">
                  {t.status === "consumed" ? (
                    <>
                      <span className="text-success">
                        {t.slots_waived} waived · {formatNaira(t.discount_ngn ?? 0)} off
                      </span>
                      {(t.slots_forfeited ?? 0) > 0 && (
                        <span className="ml-1 text-warning">
                          · {t.slots_forfeited} forfeited
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-text-3">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-text-2">
                  <div>{t.created_by}</div>
                  <div>{new Date(t.created_at).toLocaleDateString()}</div>
                </td>
                <td className="px-4 py-3 text-right">
                  {t.status === "open" && (
                    <button
                      type="button"
                      onClick={() => void handleVoid(t.id)}
                      disabled={voiding === t.id}
                      aria-label={`Cancel token ${t.id}`}
                      title="Cancel this unspent token"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-danger/30 px-3 text-xs text-danger hover:bg-danger-soft disabled:opacity-50"
                    >
                      {voiding === t.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" />
                      )}
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > LIMIT && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="min-h-[44px] rounded-full border border-line-1 px-4 text-sm text-text-2 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-text-2">
            Page {page} of {Math.ceil(total / LIMIT)}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / LIMIT)}
            className="min-h-[44px] rounded-full border border-line-1 px-4 text-sm text-text-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
