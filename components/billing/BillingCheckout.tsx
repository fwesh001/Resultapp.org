"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import { Loader2, CheckCircle2, AlertCircle, CreditCard, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  formatNaira,
  getFlutterwavePublicKey,
  loadFlutterwaveScript,
  initiateFlutterwaveInlinePayment,
  generateTxRef,
} from "@/lib/flutterwave";
import { getPricingTier, calculateTieredTotal, getSliderPct } from "@/lib/pricing";

interface BillingCheckoutProps {
  tenantId: string;
  schoolName?: string;
  customerEmail?: string;
  customerName?: string;
}

export function BillingCheckout({ tenantId, schoolName, customerEmail, customerName }: BillingCheckoutProps) {
  const [studentCount, setStudentCount] = useState("150");
  const [isPaying, setIsPaying] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ studentCount: number; total: number } | null>(null);

  const countNum = useMemo(() => {
    const n = parseInt(studentCount, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [studentCount]);

  const { pricePerStudent, badge, badgeStyle } = useMemo(() => getPricingTier(countNum), [countNum]);
  const total = useMemo(() => calculateTieredTotal(countNum), [countNum]);
  const sliderPct = useMemo(() => getSliderPct(countNum), [countNum]);
  const clampedSlider = Math.max(50, Math.min(2000, countNum || 50));

  function handleCountChange(v: string) {
    const cleaned = v.replace(/[^0-9]/g, "");
    setStudentCount(cleaned);
    if (error) setError(null);
  }

  // Validation
  function validate(): boolean {
    if (!studentCount.trim()) {
      setError("Student count is required");
      return false;
    }
    const n = parseInt(studentCount, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Must be greater than 0");
      return false;
    }
    if (n > 10000) {
      setError("Maximum 10,000 students");
      return false;
    }
    if (!Number.isInteger(n)) {
      setError("Must be a whole number");
      return false;
    }
    if (countNum < 50) {
      // allow 1-49 via text but warn; billing page prefers 50-2000. Keep permissive.
    }
    return true;
  }

  async function handlePay() {
    setError(null);
    if (!validate()) return;

    const n = parseInt(studentCount, 10);
    const amount = calculateTieredTotal(n);
    if (amount <= 0) {
      setError("Invalid amount");
      return;
    }

    setIsPaying(true);
    const publicKey = getFlutterwavePublicKey();
    const effectiveKey = publicKey || "FLWPUBK_TEST-dummy-key-for-demo-do-not-use-in-prod";
    const txRef = generateTxRef(tenantId);

    try {
      await loadFlutterwaveScript();
    } catch (e) {
      setIsPaying(false);
      setError("Could not load Flutterwave checkout. Check connection.");
      console.error(e);
      return;
    }

    if (!publicKey) {
      console.warn("NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY not set — using dummy key");
    }

    initiateFlutterwaveInlinePayment(
      {
        publicKey: effectiveKey,
        txRef,
        amount,
        currency: "NGN",
        customer: {
          email: (customerEmail || `${tenantId}@resultapp.org`).trim(),
          name: (customerName || schoolName || tenantId).trim() || tenantId,
        },
        customizations: {
          title: `ResultApp • ${schoolName || tenantId}`,
          description: `${n} students × ${formatNaira(pricePerStudent)} = ${formatNaira(amount)} — Upgrade to active`,
          logo: "https://resultapp.org/logo.png",
        },
        meta: {
          tenantId,
          studentCount: n,
          pricePerStudent,
          source: "billing_upgrade",
        },
      },
      {
        onSuccess: async (res) => {
          // 1. Immediately force the Flutterwave modal to close at the very top of the onSuccess block.
          // 2. If using flutterwave-react-v3, invoke closePaymentModal().
          // 3. Include a fallback for the raw JS script by manually removing the iframe from the DOM
          try {
            const w = window as unknown as Record<string, unknown>;
            const maybeClose = w["closePaymentModal"] as unknown as (() => void) | undefined;
            if (typeof maybeClose === "function") {
              maybeClose();
            }
          } catch {}
          try {
            const flwIframe = document.querySelector('iframe[name="checkout"]');
            if (flwIframe) flwIframe.remove();
          } catch {}

          // 4. After closing the modal, evaluate the res.status, set the submitting state, and make the POST to /api/billing/upgrade.
          const isSuccess =
            res.status === "successful" ||
            res.status === "completed" ||
            res.status === "success" ||
            !!res.transaction_id;

          if (!isSuccess) {
            setIsPaying(false);
            setError("Payment was not successful. Please try again.");
            return;
          }

          // Verified modal callback — now hit our upgrade proxy
          setUpgrading(true);
          try {
            const upgradeRes = await fetch("/api/billing/upgrade", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tenantId,
                studentCount: n,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                transactionId: res.transaction_id || (res as any).id || res.tx_ref,
              }),
            });
            const data = await upgradeRes.json().catch(() => ({}));
            if (!upgradeRes.ok || (data as { success?: boolean }).success === false) {
              const msg =
                (data as { error?: string })?.error ||
                (data as { detail?: string })?.detail ||
                `Upgrade failed (${upgradeRes.status})`;
              throw new Error(msg);
            }
            setSuccess({ studentCount: n, total: amount });
            // 5. Upon a successful upgrade response, redirect the user directly to /{tenantId}/report/STU001?term=Term%201 after a brief 1.5-second timeout
            setTimeout(() => {
              window.location.href = `/${tenantId}/report/STU001?term=Term%201`;
            }, 1500);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Upgrade failed. Contact support with transaction ID.";
            setError(msg + ` Ref: ${res.tx_ref || txRef}`);
            console.error("[billing upgrade] error", e);
          } finally {
            setIsPaying(false);
            setUpgrading(false);
          }
        },
        onClose: () => {
          setIsPaying(false);
          if (!upgrading && !success) {
            setError("Payment was cancelled. You can try again when ready.");
          }
        },
        onError: (err) => {
          setIsPaying(false);
          setError(err.message || "Payment initialization failed");
        },
      }
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/20">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <h3 className="mt-6 text-2xl font-bold tracking-tight text-white">Subscription Active!</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-purple-200/60">
          Payment verified for <span className="font-semibold text-white">{success.studentCount}</span> students (
          {formatNaira(success.total)}). Report cards for <span className="font-mono text-white">{tenantId}</span> are now unlocked.
        </p>
        <div className="mt-6 w-full rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-left">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-100">
            <Sparkles className="h-4 w-4 text-emerald-400" /> What’s next?
          </div>
          <ul className="mt-2 space-y-1 text-sm text-emerald-100/70">
            <li>• Print any report card from <span className="font-mono">/report/STU001</span></li>
            <li>• Create grading templates at <span className="font-mono">/admin/templates</span></li>
          </ul>
        </div>
        <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            className="w-full rounded-full bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
            onClick={() => (window.location.href = `/${tenantId}/admin/templates`)}
          >
            Go to Templates
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full rounded-full border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
            onClick={() => (window.location.href = `/${tenantId}/report/STU001?term=Term%201`)}
          >
            View Report
          </Button>
        </div>
        <p className="mt-4 text-xs text-zinc-500">Keep this window open — you’ll be redirected shortly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Student count input */}
      <Input
        label="Estimated Student Count"
        value={studentCount}
        onChange={(e) => handleCountChange(e.target.value)}
        placeholder="e.g. 150"
        inputMode="numeric"
        required
        disabled={isPaying || upgrading}
      />

      {/* Slider 50-2000 */}
      <div className="rounded-2xl border border-purple-500/10 bg-purple-950/15 p-4 backdrop-blur">
        <div className="flex items-center justify-between text-xs font-medium text-purple-300">
          <span>50</span>
          <span className="rounded-full border border-purple-500/15 bg-purple-500/5 px-2 py-0.5 text-[11px] text-purple-200/60">
            Slider 50–2000 • step 10 • 1–49 via text
          </span>
          <span>2,000</span>
        </div>
        <div className="relative mt-3">
          <input
            type="range"
            min={50}
            max={2000}
            step={10}
            value={clampedSlider}
            onChange={(e) => handleCountChange(e.target.value)}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-purple-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
            style={{
              background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(168 85 247) ${sliderPct}%, rgba(88,28,135,0.35) ${sliderPct}%, rgba(88,28,135,0.35) 100%)`,
            }}
            aria-label="Student count slider"
            disabled={isPaying || upgrading}
          />
          <div
            className="pointer-events-none absolute top-1/2 hidden h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-purple-400 shadow-[0_0_14px_6px_rgba(168,85,247,0.45)] sm:block"
            style={{ left: `calc(${sliderPct}% - 5px)` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className={`rounded-full border px-2.5 py-1 ${countNum < 500 ? "border-purple-500 bg-purple-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
            50–499 → ₦100
          </span>
          <span className={`rounded-full border px-2.5 py-1 ${countNum >= 500 && countNum < 1000 ? "border-violet-500 bg-violet-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
            500–999 → ₦90
          </span>
          <span className={`rounded-full border px-2.5 py-1 ${countNum >= 1000 ? "border-emerald-500 bg-emerald-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
            1000+ → ₦80
          </span>
        </div>
        <style>{`input[type="range"]::-webkit-slider-thumb{appearance:none;height:26px;width:26px;border-radius:9999px;background:white;border:3px solid rgb(147 51 234);box-shadow:0 0 14px rgba(147,51,234,0.5)} input[type="range"]::-moz-range-thumb{height:26px;width:26px;border-radius:9999px;background:white;border:3px solid rgb(147 51 234);box-shadow:0 0 14px rgba(147,51,234,0.5)} @media (pointer:coarse){input[type="range"]::-webkit-slider-thumb{height:30px;width:30px} input[type="range"]::-moz-range-thumb{height:30px;width:30px}}`}</style>
      </div>

      {/* Pricing card */}
      <div className="rounded-2xl border border-purple-500/15 bg-purple-900/15 p-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.35)]">
              <CreditCard className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Total Amount</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-purple-300/60">
                  {countNum || 0} × {formatNaira(pricePerStudent)}
                </span>
                {badge && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeStyle}`}>{badge}</span>}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tracking-tight text-white">{countNum > 0 ? formatNaira(total) : "—"}</p>
            <p className="text-xs text-purple-300/50">One-time • Unlocks printing</p>
          </div>
        </div>
        {countNum > 0 && (
          <div className="mt-3 rounded-xl border border-purple-500/10 bg-[#0B0514]/60 p-3 text-xs leading-5 text-purple-200/70">
            <div className="flex justify-between">
              <span>Students</span>
              <span className="font-medium text-white">{countNum}</span>
            </div>
            <div className="flex justify-between">
              <span>Price per student</span>
              <span className="text-purple-200">{formatNaira(pricePerStudent)}</span>
            </div>
            <div className="my-2 border-t border-purple-500/10" />
            <div className="flex justify-between font-semibold text-white">
              <span>Total payable</span>
              <span>{formatNaira(total)}</span>
            </div>
          </div>
        )}
        <p className="mt-2 flex items-center gap-1 text-xs text-purple-300/50">
          <Users className="h-3 w-3" /> Secured by Flutterwave • Pay with card, transfer, or USSD
        </p>
      </div>

      {error && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {(isPaying || upgrading) && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/15 bg-purple-500/10 p-3 text-sm text-purple-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          {upgrading ? "Verifying payment & unlocking…" : "Initializing Flutterwave…"}
        </div>
      )}

      <Button
        onClick={handlePay}
        disabled={isPaying || upgrading || countNum <= 0}
        size="lg"
        className="w-full gap-2 rounded-full bg-red-600 font-semibold text-white shadow-[0_0_28px_rgba(239,68,68,0.35)] hover:bg-red-500 disabled:opacity-60"
      >
        {isPaying || upgrading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {upgrading ? "Upgrading…" : "Waiting for payment…"}
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" />
            {countNum > 0 ? `Pay ${formatNaira(total)} — Upgrade to Active` : "Pay with Flutterwave"}
          </>
        )}
      </Button>

      <p className="text-center text-xs leading-5 text-zinc-500">
        On success you’ll be redirected to <span className="font-mono font-medium text-purple-300">/{tenantId}/report/STU001?term=Term%201</span> and your report cards will be unlocked.
      </p>
    </div>
  );
}
