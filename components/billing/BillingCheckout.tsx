"use client";

import * as React from "react";
import { useState, useMemo, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, CreditCard, Sparkles, Users, Ticket, ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatNaira, getPublicKeyForTenant, loadFlutterwaveScript, initiateFlutterwaveInlinePayment, generateTxRef } from "@/lib/flutterwave";
import {
  getPricingTier,
  calculateTieredTotal,
  calculateCreditTotal,
  CREDIT_PRICE,
  getSliderPct,
} from "@/lib/pricing";
import type { WaiverSplit as WaiverSplitShape } from "@/lib/waiverPricing";
import { isDemoTenant } from "@/lib/tenant";

/**
 * Slot-purchase slider floor.
 *
 * The range input starts at 50, so a token with a smaller allowance is still
 * VALID but cannot be reached by dragging — the buyer has to type the number.
 * Said out loud rather than left to be discovered at checkout.
 */
const SLOT_SLIDER_FLOOR = 50;

export interface WaiverCodeState {
  token: string;
  tokenId: number | null;
  error: string | null;
}

interface BillingCheckoutProps {
  tenantId: string;
  schoolName?: string;
  customerEmail?: string;
  customerName?: string;
  /**
   * "subscription" (legacy) | "credit" (flat live rate) | "slot" (tiered).
   * Defaults to "subscription" for backwards compatibility.
   */
  mode?: "subscription" | "credit" | "slot";
  defaultCount?: string;
  /**
   * Live per-unit price for credit mode (fetched by the parent from
   * /api/admin/config/credit-price). Falls back to CREDIT_PRICE.
   */
    unitPrice?: number;
    /**
     * Whether this tenant is the demo school. Selects the dedicated TEST public
     * key; every real tenant is held to the live one.
     *
     * Derived from the registry's own demo flag by the caller rather than
     * re-derived from the hostname here, so there is exactly one definition of
     * "demo" in the codebase.
     */
    isDemo?: boolean;
  /**
   * Superadmin waiver code — OWNED BY THE PARENT.
   *
   * This component is mounted with `key={slot-${pkg}}`, so React discards it
   * and its entire local state every time the buyer clicks a different package
   * size. Holding the code here would delete it on the single most likely
   * action for someone using a waiver: enter code, then compare packages.
   */
  waiver?: WaiverCodeState;
  onWaiverChange?: (next: WaiverCodeState) => void;
}

export function BillingCheckout({
    tenantId,
    schoolName,
    customerEmail,
    customerName,
    mode = "subscription",
    defaultCount,
    unitPrice,
    isDemo,
    waiver,
    onWaiverChange,
  }: BillingCheckoutProps) {
  const isCredit = mode === "credit";
  const isSlot = mode === "slot";
  // Single source of truth for credit pricing — parent-supplied live price.
  const price = unitPrice ?? CREDIT_PRICE;
  const unitNoun = isCredit ? "credit" : isSlot ? "slot" : "student";
  const [studentCount, setStudentCount] = useState(defaultCount ?? "150");
  const [isPaying, setIsPaying] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    studentCount: number;
    total: number;
    restoredFromSuspension?: boolean;
  } | null>(null);

  // --- Waiver (slot mode only) -------------------------------------------
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [preview, setPreview] = useState<WaiverSplitShape | null>(null);
  // Which (code, quantity) pair `preview` was computed FOR. Deriving staleness
  // from this is better than a `setPreviewing(true)` inside the effect: that is
  // a synchronous setState on every keystroke, and it only knows "am I
  // loading" — it cannot tell the difference between "loading" and "showing a
  // split priced for the number the buyer typed two seconds ago", which is the
  // case that actually matters when the charge is about to be taken.
  const [previewFor, setPreviewFor] = useState<string | null>(null);

  // Held locally rather than in the parent because it is derived from the
  // count, which the parent does not own.
  const waiverToken = waiver?.token ?? "";
  const waiverTokenId = waiver?.tokenId ?? null;

  const countNum = useMemo(() => {
    const n = parseInt(studentCount, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [studentCount]);

  const previewKey = `${waiverToken.trim()}|${countNum}`;
  const previewing = isSlot && !!waiverToken.trim() && previewFor !== previewKey;
  /**
   * The preview, ONLY if it was priced for what is currently in the form.
   *
   * Derived rather than synchronised, so clearing the code or changing the
   * quantity invalidates it by construction — there is no window in which a
   * split priced for 100 slots is on screen next to a form asking for 500, and
   * therefore no window in which the wrong number can be charged.
   */
  const activePreview = previewFor === previewKey ? preview : null;

  const { pricePerStudent, badge, badgeStyle } = useMemo(
    () => (isCredit ? { pricePerStudent: price, badge: null as string | null, badgeStyle: "" } : getPricingTier(countNum)),
    [countNum, isCredit, price],
  );
  const listTotal = useMemo(
    () => (isCredit ? calculateCreditTotal(countNum, price) : calculateTieredTotal(countNum)),
    [countNum, isCredit, price],
  );

  /**
   * The number actually charged.
   *
   * The SERVER's split when a waiver applies, otherwise the list price. The
   * preview shown to the buyer is display-only — /api/billing/slots re-quotes
   * from the backend before verifying anything, so tampering with this value
   * changes nothing but the number on screen.
   */
  const total = useMemo(
    () => (activePreview && isSlot ? activePreview.charged_ngn : listTotal),
    [activePreview, isSlot, listTotal],
  );
  const isBypass = !!(activePreview && isSlot && activePreview.bypass_gateway);

  // Re-quote whenever the code or the quantity changes. Debounced because the
  // count is a free-text field, and previewing per keystroke would burn the
  // public endpoint's rate-limit budget on a half-typed "1500".
  useEffect(() => {
    if (!isSlot || !waiverToken.trim()) return; // nothing to price, nothing to do
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/billing/waiver/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token_string: waiverToken.trim(),
            requested_slots: countNum,
            applies_to: "TOPUP",
            tenant_id: tenantId,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          token_id?: number;
          split?: WaiverSplitShape;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.split) {
          // Clear the token id too: leaving a stale id next to a rejected code
          // would let a later purchase try to reserve a code that is no longer
          // valid, and fail confusingly at checkout.
          setPreview(null);
          setPreviewFor(previewKey);
          onWaiverChange?.({ token: waiverToken, tokenId: null, error: data.error ?? "That code could not be applied" });
          return;
        }
        onWaiverChange?.({ token: waiverToken, tokenId: data.token_id ?? null, error: null });
        setPreview(data.split);
        setPreviewFor(previewKey);
      } catch {
        if (!cancelled) {
          setPreview(null);
          setPreviewFor(previewKey);
          onWaiverChange?.({ token: waiverToken, tokenId: null, error: "Could not check that code." });
        }
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // previewKey already encodes both inputs; depending on the pieces as well
    // would just re-fire the timer on identical renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, isSlot, tenantId, onWaiverChange]);

  // Slider bounds are mode-specific: credits 1–10,000, slots 50–2,000.
  const sliderMin = isCredit ? 1 : 50;
  const sliderMax = isCredit ? 10000 : 2000;
  const sliderStep = isCredit ? 1 : 10;
  const sliderPct = useMemo(() => {
    if (isCredit) {
      const pct = ((countNum - sliderMin) / (sliderMax - sliderMin)) * 100;
      return Math.max(0, Math.min(100, pct));
    }
    return getSliderPct(countNum);
  }, [countNum, isCredit, sliderMin, sliderMax]);
  const clampedSlider = Math.max(sliderMin, Math.min(sliderMax, countNum || sliderMin));

  function handleCountChange(v: string) {
    const cleaned = v.replace(/[^0-9]/g, "");
    setStudentCount(cleaned);
    if (error) setError(null);
  }

  // Validation
  function validate(): boolean {
    if (!studentCount.trim()) {
      setError(isCredit ? "Credit amount is required" : "Student count is required");
      return false;
    }
    const n = parseInt(studentCount, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Must be greater than 0");
      return false;
    }
    if (n > 10000) {
      setError(isCredit ? "Maximum 10,000 credits" : "Maximum 10,000 students");
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
    const listAmount = isCredit ? calculateCreditTotal(n, price) : calculateTieredTotal(n);
    if (listAmount <= 0) {
      setError("Invalid amount");
      return;
    }

    // A waiver that is being applied but has not finished pricing is treated as
    // "no waiver" rather than "charge full price silently". Better to ask the
    // buyer to wait than to take money for something they expected discounted.
    const applyWaiver = isSlot && !!waiverToken.trim() && !!waiverTokenId;
    if (applyWaiver && !activePreview) {
      setError("Still checking your waiver code — one moment.");
      return;
    }
    const amount = applyWaiver ? activePreview!.charged_ngn : listAmount;
    const bypass = applyWaiver && activePreview!.bypass_gateway;

    setIsPaying(true);

    /**
     * RESERVE BEFORE CHECKOUT, NOT AFTER PAYMENT.
     *
     * A token burned only at purchase time has a hole: two tabs, one code, both
     * pay, one loses and is charged for nothing. Reserving first means the
     * loser never reaches a payment page at all.
     *
     * `txRef` is minted here rather than by Flutterwave so the reservation and
     * the charge share one reference — the burn is scoped to it, and a late or
     * duplicated callback cannot redeem a token the sweeper has since handed
     * to somebody else.
     */
    const txRef = generateTxRef(tenantId);
    if (applyWaiver) {
      try {
        const res = await fetch("/api/billing/waiver/reserve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token_string: waiverToken.trim(),
            tx_ref: txRef,
            applies_to: "TOPUP",
            tenant_id: tenantId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setIsPaying(false);
          const msg = (data as { error?: string })?.error || "That waiver code is not available";
          // The code is spent or held elsewhere — stop offering it rather than
          // letting them retry into the same 409.
          onWaiverChange?.({ token: "", tokenId: null, error: msg });
          setPreview(null);
          setError(msg);
          return;
        }
      } catch {
        setIsPaying(false);
        // Hand the reservation back if we opened one and then failed. Failing
        // closed here means a stranded token for RESERVATION_TTL_SECONDS, and a
        // school whose payment failed would find their code "already in use".
        setError("Could not reserve that waiver code. Try again.");
        return;
      }
    }

    const releaseWaiver = () => {
      if (!applyWaiver) return;
      void fetch("/api/billing/waiver/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_id: waiverTokenId, tx_ref: txRef }),
      }).catch(() => null);
    };

    /**
     * THE 100% BYPASS. Flutterwave is never opened for a ₦0 charge — it would
     * reject it, and a school whose portal is being paid for by a goodwill code
     * should not be at the mercy of a payment provider being up.
     */
    if (bypass) {
      setUpgrading(true);
      try {
        const res = await fetch("/api/billing/slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId,
            slotCount: n,
            waiverTokenId,
            waiverReservationTxRef: txRef,
            // No transactionId at all. The backend rejects one here, and a
            // placeholder would put a fake reference into the ledger.
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || (data as { success?: boolean }).success === false) {
          throw new Error((data as { error?: string })?.error || `Top-up failed (${res.status})`);
        }
        setSuccess({
          studentCount: n,
          total: 0,
          restoredFromSuspension: (data as { restored_from_suspension?: boolean }).restored_from_suspension === true,
        });
        setTimeout(() => {
          window.location.href = `/${tenantId}/admin/billing`;
        }, 1500);
      } catch (e) {
        // The grant failed, so the burn rolled back with it. Release the
        // reservation so the school can simply try again.
        releaseWaiver();
        setError(
          (e instanceof Error ? e.message : "Top-up failed.") + " Your waiver code has not been used.",
        );
      } finally {
        setIsPaying(false);
        setUpgrading(false);
      }
      return;
    }

    // Resolved BEFORE any await, inside the same try/catch that surfaces errors
    // to the user. A misconfigured deployment must produce a visible "payments
    // are unavailable" message, never a checkout that looks real and takes no
    // money.
    let publicKey: string;
    try {
      publicKey = getPublicKeyForTenant({ isDemo });
    } catch (e) {
      setIsPaying(false);
      releaseWaiver();
      setError(
        e instanceof Error
          ? e.message
          : "Payments are unavailable right now. Please contact support.",
      );
      console.error("[billing] Flutterwave key resolution failed", e);
      return;
    }

    try {
      await loadFlutterwaveScript();
    } catch (e) {
      setIsPaying(false);
      releaseWaiver();
      setError("Could not load Flutterwave checkout. Check connection.");
      console.error(e);
      return;
    }

    initiateFlutterwaveInlinePayment(
      {
        publicKey,
        txRef,
        amount,
        currency: "NGN",
        customer: {
          email: (customerEmail || `${tenantId}@resultapp.org`).trim(),
          name: (customerName || schoolName || tenantId).trim() || tenantId,
        },
        customizations: {
          title: `ResultApp • ${schoolName || tenantId}`,
          description: isCredit
            ? `${n} credits × ${formatNaira(pricePerStudent)} = ${formatNaira(amount)} — Credit top-up`
            : isSlot
              ? applyWaiver
                ? `${n} slots — ${formatNaira(amount)} after waiver`
                : `${n} slots × ${formatNaira(pricePerStudent)} = ${formatNaira(amount)} — Slot purchase`
              : `${n} students × ${formatNaira(pricePerStudent)} = ${formatNaira(amount)} — Upgrade to active`,
          logo: "https://resultapp.org/logo.png",
        },
        meta: {
          tenantId,
          studentCount: n,
          pricePerStudent,
          // The waiver CODE is deliberately absent. `meta` is transmitted to
          // Flutterwave and retained in their transaction metadata, so putting a
          // live bearer credential there would disclose it to a third party the
          // school never authorised. The token was already exchanged for a
          // reservation under `txRef`, which is what this actually sends.
          source: isCredit ? "credit_topup" : isSlot ? "slot_purchase" : "billing_upgrade",
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
            // Cancelled at the gateway. The token is NOT spent, so give it
            // back rather than making a retry look like a double-spend.
            releaseWaiver();
            setError("Payment was not successful. Your waiver code has not been used.");
            return;
          }

          // Verified modal callback — now hit our payment proxy
          setUpgrading(true);
          try {
            const endpoint = isCredit ? "/api/billing/credits" : isSlot ? "/api/billing/slots" : "/api/billing/upgrade";
            const upgradeRes = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tenantId,
                studentCount: n,
                creditCount: n,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                transactionId: res.transaction_id || (res as any).id || res.tx_ref,
                ...(applyWaiver
                  ? { waiverTokenId, waiverReservationTxRef: txRef }
                  : {}),
              }),
            });
            const data = await upgradeRes.json().catch(() => ({}));
            if (!upgradeRes.ok || (data as { success?: boolean }).success === false) {
              const msg =
                (data as { error?: string })?.error ||
                (data as { detail?: string })?.detail ||
                (isCredit ? `Top-up failed (${upgradeRes.status})` : `Upgrade failed (${upgradeRes.status})`);
              throw new Error(msg);
            }
            // A verified payment lifts a NON-PAYMENT suspension inside the same
            // backend transaction as the grant. The backend reports whether it
            // did, so the admin is told plainly — otherwise they pay, land back
            // on a suspended portal, and think the top-up failed.
            const restored = (data as { restored_from_suspension?: boolean })
              .restored_from_suspension === true;
            setSuccess({
              studentCount: n,
              total: amount,
              restoredFromSuspension: restored,
            });
            // 5. On success: credit/slot top-ups stay on billing to show new balance; legacy upgrade goes to sample report.
            setTimeout(() => {
              window.location.href = isCredit || isSlot
                ? `/${tenantId}/admin/billing${restored ? "?restored=1" : ""}`
                : `/${tenantId}/report/STU001?term=Term%201`;
            }, 1500);
          } catch (e) {
            const isTopup = isCredit || isSlot;
            const msg = e instanceof Error ? e.message : (isTopup ? "Top-up failed. Contact support with transaction ID." : "Upgrade failed. Contact support with transaction ID.");
            setError(msg + ` Ref: ${res.tx_ref || txRef}`);
            console.error(isTopup ? "[billing topup] error" : "[billing upgrade] error", e);
          } finally {
            setIsPaying(false);
            setUpgrading(false);
          }
        },
        onClose: () => {
          setIsPaying(false);
          if (!upgrading && !success) {
            // Checkout abandoned. The token was reserved but never spent, so
            // hand it straight back — otherwise the school is told their code
            // "is already in use" for the next 15 minutes and blames the
            // platform for their own closed tab.
            releaseWaiver();
            setError("Payment was cancelled. Your waiver code has not been used.");
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
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft ring-1 ring-success/40">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <h3 className="mt-6 text-2xl font-bold tracking-tight text-text-1">
          {success.restoredFromSuspension
            ? "Portal Restored!"
            : isCredit
              ? "Credits Added!"
              : isSlot
                ? "Slots Added!"
                : "Subscription Active!"}
        </h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-text-2">
          Payment verified for <span className="font-semibold text-text-1">{success.studentCount}</span> {isCredit ? "credits" : isSlot ? "slots" : "students"} (
          {formatNaira(success.total)}). {success.restoredFromSuspension ? (
            <>
              Your portal is active again — public, staff, and report access have resumed.
            </>
          ) : isCredit ? (
            <>Your new credit balance will show on this page in a moment.</>
          ) : isSlot ? (
            <>Your new slot capacity will show on this page in a moment. You can now add more students.</>
          ) : (
            <>Report cards for <span className="font-mono text-text-1">{tenantId}</span> are now unlocked.</>
          )}
        </p>
        <div className="mt-6 w-full rounded-2xl border border-success/40 bg-success-soft p-4 text-left">
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <Sparkles className="h-4 w-4 text-success" /> What’s next?
          </div>
          <ul className="mt-2 space-y-1 text-sm text-success">
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
            className="w-full rounded-full border-line-1 bg-surface-3 text-text-1 hover:bg-surface-2"
            onClick={() => (window.location.href = `/${tenantId}/report/STU001?term=Term%201`)}
          >
            View Report
          </Button>
        </div>
        <p className="mt-4 text-xs text-text-3">Keep this window open — you’ll be redirected shortly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Student / credit count input */}
      <Input
        label={isCredit ? "Credit Amount" : "Estimated Student Count"}
        value={studentCount}
        onChange={(e) => handleCountChange(e.target.value)}
        placeholder="e.g. 150"
        inputMode="numeric"
        required
        disabled={isPaying || upgrading}
      />

      {isSlot && (
        <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.03] p-4">
          <button
            type="button"
            onClick={() => setWaiverOpen((v) => !v)}
            disabled={isPaying || upgrading}
            aria-expanded={waiverOpen}
            className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-cyan-200">
              <Ticket className="h-4 w-4" />
              Have a waiver code?
            </span>
            <ChevronDown
              className={`h-4 w-4 text-cyan-300/60 transition ${waiverOpen ? "rotate-180" : ""}`}
            />
          </button>

          {waiverOpen && (
            <div className="mt-3 flex flex-col gap-3">
              <Input
                label="Waiver code"
                name="waiverToken"
                type="text"
                autoComplete="off"
                // Case-SENSITIVE base64url. See the identical fix in
                // RegisterSchoolForm — uppercasing corrupted 10 of 27
                // characters and the code could never match its stored hash.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="RW-…"
                value={waiverToken}
                onChange={(e) => {
                  // Keep the value EXACTLY as typed or pasted.
                  const v = e.target.value;
                  onWaiverChange?.({ token: v, tokenId: null, error: null });
                  setPreview(null);
                  if (error) setError(null);
                }}
                error={waiver?.error ?? undefined}
                disabled={isPaying || upgrading}
              />

              {previewing && (
                <p className="flex items-center gap-2 text-xs text-cyan-200/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking code…
                </p>
              )}

              {activePreview && !previewing && (
                <div
                  className={`rounded-xl border p-3 text-xs ${
                    activePreview.bypass_gateway
                      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-100"
                      : "border-line-1 bg-accent-soft text-text-1"
                  }`}
                >
                  <p className="font-medium">
                    {activePreview.discount_percentage}% off {activePreview.slot_allowance.toLocaleString()} slot
                    {activePreview.slot_allowance === 1 ? "" : "s"}
                  </p>
                  <dl className="mt-2 space-y-1">
                    <div className="flex justify-between">
                      <dt className="text-cyan-100/60">Covered</dt>
                      <dd>
                        {activePreview.waived_slots} of {countNum} slots ({formatNaira(activePreview.waived_ngn)} off)
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-cyan-100/60">You pay</dt>
                      <dd className="font-semibold">{formatNaira(activePreview.charged_ngn)}</dd>
                    </div>
                  </dl>

                  {activePreview.bypass_gateway && (
                    <p className="mt-2 text-cyan-200/80">
                      Fully covered — no payment will be taken.
                    </p>
                  )}

                  {/*
                    THE SLIDER FLOOR COLLISION. A token covering fewer slots
                    than the slider's minimum is still perfectly valid; it just
                    cannot be reached by dragging, so the buyer has to type the
                    number. Said here rather than left to be discovered at
                    checkout.
                  */}
                  {activePreview.slot_allowance < SLOT_SLIDER_FLOOR && (
                    <p className="mt-2 flex items-start gap-1.5 text-warning">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        This code covers {activePreview.slot_allowance} slot
                        {activePreview.slot_allowance === 1 ? "" : "s"} but the slider starts at{" "}
                        {SLOT_SLIDER_FLOOR}. Type the quantity above — the code works
                        either way.
                      </span>
                    </p>
                  )}

                  {activePreview.forfeited_slots > 0 && (
                    <p className="mt-2 font-medium text-warning">
                      Use it or lose it: {activePreview.forfeited_slots} slot
                      {activePreview.forfeited_slots === 1 ? "" : "s"} of this code will be
                      permanently forfeited if you buy fewer than{" "}
                      {activePreview.slot_allowance} slots.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Slider — bounds depend on mode */}
      <div className="rounded-2xl border border-line-1 bg-surface-1 p-4 backdrop-blur">
        <div className="flex items-center justify-between text-xs font-medium text-accent">
          <span>{sliderMin.toLocaleString()}</span>
          <span className="rounded-full border border-line-1 bg-accent-soft px-2 py-0.5 text-[11px] text-text-2">
            {isCredit
              ? `Slider 1–10,000 • step 1 • flat ${formatNaira(price)}/credit`
              : "Slider 50–2000 • step 10 • 1–49 via text"}
          </span>
          <span>{sliderMax.toLocaleString()}</span>
        </div>
        <div className="relative mt-3">
          <input
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={sliderStep}
            value={clampedSlider}
            onChange={(e) => handleCountChange(e.target.value)}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            style={{
              background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(168 85 247) ${sliderPct}%, rgba(88,28,135,0.35) ${sliderPct}%, rgba(88,28,135,0.35) 100%)`,
            }}
            aria-label={isCredit ? "Credit amount slider" : "Student count slider"}
            disabled={isPaying || upgrading}
          />
          <div
            className="pointer-events-none absolute top-1/2 hidden h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-purple-400 shadow-[0_0_14px_6px_rgba(168,85,247,0.45)] sm:block"
            style={{ left: `calc(${sliderPct}% - 5px)` }}
          />
        </div>
        {!isCredit ? (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            <span className={`rounded-full border px-2.5 py-1 ${countNum < 500 ? "border-accent bg-accent text-accent-fg" : "border-line-1 bg-surface-1 text-text-2"}`}>
              50–499 → ₦100
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${countNum >= 500 && countNum < 1000 ? "border-violet-500 bg-violet-600 text-white" : "border-line-1 bg-surface-1 text-text-2"}`}>
              500–999 → ₦90
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${countNum >= 1000 ? "border-emerald-500 bg-emerald-600 text-white" : "border-line-1 bg-surface-1 text-text-2"}`}>
              1000+ → ₦80
            </span>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-text-2">
            Flat {formatNaira(price)} per credit — no tiers.
          </p>
        )}
        <style>{`input[type="range"]::-webkit-slider-thumb{appearance:none;height:26px;width:26px;border-radius:9999px;background:white;border:3px solid rgb(147 51 234);box-shadow:0 0 14px rgba(147,51,234,0.5)} input[type="range"]::-moz-range-thumb{height:26px;width:26px;border-radius:9999px;background:white;border:3px solid rgb(147 51 234);box-shadow:0 0 14px rgba(147,51,234,0.5)} @media (pointer:coarse){input[type="range"]::-webkit-slider-thumb{height:30px;width:30px} input[type="range"]::-moz-range-thumb{height:30px;width:30px}}`}</style>
      </div>

      {/* Pricing card */}
      <div className="rounded-2xl border border-line-1 bg-surface-1 p-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-[0_0_12px_rgba(147,51,234,0.35)]">
              <CreditCard className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-1">
                Total Amount{isBypass ? " — fully waived" : ""}
              </p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs">
                {preview && isSlot && listTotal !== total ? (
                  <span className="text-cyan-300/70 line-through">{formatNaira(listTotal)}</span>
                ) : (
                  <span className="text-text-2">
                    {countNum || 0} × {formatNaira(pricePerStudent)}
                  </span>
                )}
                {badge && !activePreview && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeStyle}`}>{badge}</span>}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-lg font-bold tracking-tight ${isBypass ? "text-cyan-300" : "text-text-1"}`}>
              {countNum > 0 ? (isBypass ? "Free" : formatNaira(total)) : "—"}
            </p>
            <p className="text-xs text-text-3">{isCredit ? "One-time • Adds to balance" : "One-time • Unlocks printing"}</p>
          </div>
        </div>
        {countNum > 0 && (
          <div className="mt-3 rounded-xl border border-line-1 bg-surface-0/60 p-3 text-xs leading-5 text-text-2">
            <div className="flex justify-between">
              <span>{isCredit ? "Credits" : "Students"}</span>
              <span className="font-medium text-text-1">{countNum}</span>
            </div>
            <div className="flex justify-between">
              <span>Price per {unitNoun}</span>
              <span className="text-text-2">{formatNaira(pricePerStudent)}</span>
            </div>
            {activePreview && isSlot && (
              <>
                <div className="flex justify-between text-cyan-300/80">
                  <span>Waiver ({activePreview.waived_slots} slot{activePreview.waived_slots === 1 ? "" : "s"})</span>
                  <span>−{formatNaira(activePreview.waived_ngn)}</span>
                </div>
                <div className="my-2 border-t border-line-1" />
              </>
            )}
            <div className="flex justify-between font-semibold text-text-1">
              <span>Total payable</span>
              <span>{isBypass ? formatNaira(0) : formatNaira(total)}</span>
            </div>
          </div>
        )}
        <p className="mt-2 flex items-center gap-1 text-xs text-text-3">
          <Users className="h-3 w-3" /> Secured by Flutterwave • Pay with card, transfer, or USSD
        </p>
      </div>

      {error && (
        <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>{error}</span>
        </div>
      )}

      {(isPaying || upgrading) && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-line-1 bg-accent-soft p-3 text-sm text-accent">
          <Loader2 className="h-4 w-4 animate-spin" />
          {upgrading ? "Verifying payment & unlocking…" : "Initializing Flutterwave…"}
        </div>
      )}

      {isDemoTenant({ slug: tenantId }) && (
        <div className="rounded-xl border border-amber-400/25 bg-warning-soft p-3 text-xs leading-5 text-warning">
          <p className="font-medium text-warning">Demo checkout — no real money moves.</p>
          <p className="mt-1 text-warning">
            Use test card <span className="font-mono">5531 8866 9555 5447</span> (any future
            expiry, any CVV), or pick <span className="font-medium">Bank Transfer → Mock
            Bank</span> and confirm “I have sent the money”. The same server
            verification runs as production.
          </p>
        </div>
      )}

      <Button
        onClick={handlePay}
        disabled={isPaying || upgrading || countNum <= 0 || (isSlot && !!waiverToken.trim() && !waiverTokenId)}
        size="lg"
        className={`w-full gap-2 rounded-full font-semibold text-white disabled:opacity-60 ${
          isBypass
            ? "bg-cyan-600 hover:bg-cyan-500 shadow-[0_0_28px_rgba(8,145,178,0.35)]"
            : "bg-red-600 hover:bg-red-500 shadow-[0_0_28px_rgba(239,68,68,0.35)]"
        }`}
      >
        {isPaying || upgrading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {upgrading ? "Applying…" : "Waiting for payment…"}
          </>
        ) : isBypass ? (
          <>
            <Ticket className="h-4 w-4" />
            Apply {countNum} free slots — no payment
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" />
            {countNum > 0 ? (isCredit ? `Pay ${formatNaira(total)} — Buy ${countNum} Credits` : `Pay ${formatNaira(total)} — Add ${countNum} Slots`) : "Pay with Flutterwave"}
          </>
        )}
      </Button>

      <p className="text-center text-xs leading-5 text-text-3">
        {isCredit ? (
          <>On success you’ll stay on this page with your updated credit balance and ledger entry.</>
        ) : (
          <>On success you’ll be redirected to <span className="font-mono font-medium text-accent">/{tenantId}/report/STU001?term=Term%201</span> and your report cards will be unlocked.</>
        )}
      </p>
    </div>
  );
}
