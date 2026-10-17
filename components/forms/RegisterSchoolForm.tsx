"use client";

import * as React from "react";
import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Users,
  Sparkles,
  ExternalLink,
  Eye,
  EyeOff,
  MailCheck,
  ShieldCheck,
  Clock,
  Ticket,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
  import {
    getFlutterwavePublicKey,
    loadFlutterwaveScript,
    initiateFlutterwaveInlinePayment,
    generateTxRef,
  } from "@/lib/flutterwave";
  import { holdRegistration, type WaiverSplitShape } from "@/lib/holdRegistrationClient";
  import {
    getPricingTier,
    calculateTieredTotal,
    formatNaira,
    FREE_CREDIT_MIN_STUDENTS,
    FREE_CREDIT_GRANT,
    MIN_REGISTRATION_STUDENTS,
  } from "@/lib/pricing";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/constants";
import { fireCompletionBurst, fireMilestoneBurst } from "@/lib/celebration";
import { friendlyStage, useSimulatedProgress } from "@/lib/progress";

// ---------------------------------------------------------------------------
// RegisterSchoolForm — 3-step pay-first wizard.
//
//   1. School Details  — name, subdomain, admin email + OTP verification
//   2. Account Security— admin name, passwords, student count
//   3. Review & Payment— summary, terms consent, Flutterwave checkout
//
// Validation is scoped per step (validateStep1/2) so an incomplete later step
// never blocks progress on an earlier one; Step 3 re-checks everything before
// money moves. Inbox ownership gates PAYMENT only — an unverified address may
// still reach Step 3 — so a slow or unconfigured mail path does not strand the
// user on Step 1 with no recourse.
// ---------------------------------------------------------------------------

interface FormValues {
  schoolName: string;
  subdomain: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  adminPasswordConfirm: string;
  studentCount: string; // keep string for controlled input
  // Affirmative acceptance of the Terms of Service and Privacy Policy.
  // Persisted server-side with the version strings from lib/legal/constants.ts.
  acceptTerms: boolean;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

const RESERVED_SLUGS = new Set([
  "www",
  "api",
  "admin",
  "app",
  "dashboard",
  "resultapp",
  "mail",
  "support",
  "help",
  "billing",
  "ops",
  "status",
]);

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;

/** 6-digit code, entered by the user. Mirrors the backend's pydantic pattern. */
const OTP_RE = /^[0-9]{6}$/;
/** Resend cooldown shown to the user; the backend enforces its own window. */
const OTP_RESEND_COOLDOWN_S = 60;

/**
 * sessionStorage key holding the tx_ref of an in-flight checkout.
 * Written before the Flutterwave modal opens so a callback that never
 * arrives is still recoverable after a reload.
 */
const PENDING_TX_REF_KEY = "resultapp:pending-tx-ref";

/**
 * Wizard draft, so a discarded tab does not cost the user their place.
 *
 * WHY THIS EXISTS
 * ---------------
 * Proving inbox ownership means leaving the app: the user switches to their
 * mail client to read a 6-digit code. On iOS that backgrounding is enough for
 * the OS to discard and later RELOAD the tab. Every `useState` in this wizard
 * is plain memory, so the whole thing resets to Step 1 with `otpSent = false`.
 * The user then asks for a new code, the backend's 60s cooldown rejects it, and
 * they are in a loop they cannot get out of without a full page reload — which
 * resets it again.
 *
 * sessionStorage, not localStorage: the draft is scoped to this tab and dies
 * with it. A registration abandoned on a library PC must not still be
 * resumable on that machine the next day.
 *
 * WHAT IS DELIBERATELY NOT STORED
 * ------------------------------
 * `adminPassword` and `adminPasswordConfirm` are excluded. sessionStorage is
 * origin-scoped, JavaScript-readable storage: whatever is in it is readable by
 * any XSS on resultapp.org and outlives the tab it was typed into. Re-typing a
 * password is a five-second cost; a leaked one is not. Everything persisted
 * here is either already public (school name, subdomain) or already known to
 * the backend (the email that received the code).
 *
 * The stored shape is versioned so a future change to FormValues can be
 * detected and discarded rather than half-applied.
 */
const REGISTRATION_DRAFT_KEY = "resultapp:registration-draft:v1";

type RegistrationDraft = {
  v: 1;
  step: 1 | 2 | 3;
  /** Only the non-secret half of FormValues. See the note above. */
  values: {
    schoolName: string;
    subdomain: string;
    adminEmail: string;
    adminName: string;
    studentCount: string;
    acceptTerms: boolean;
  };
  otpSent: boolean;
  /** Epoch ms the code was requested. Drives the resend cooldown across reloads. */
  otpSentAt: number | null;
  otpCode: string;
  /** See the caveat on isEmailVerified below. */
  emailVerified: boolean;
  txRef: string | null;
};

/**
 * Read the draft once, defensively.
 *
 * Every field is re-validated on the way out. sessionStorage is writable from
 * devtools and survives across deploys that change this shape, so a stored
 * value is untrusted input — a hand-edited `step: 99` must not put the wizard
 * in a state it has no renderer for.
 */
function loadRegistrationDraft(): RegistrationDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(REGISTRATION_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RegistrationDraft>;
    if (!parsed || parsed.v !== 1) return null;

    const v = (parsed.values ?? {}) as Partial<RegistrationDraft["values"]>;
    const str = (x: unknown, fallback = "") => (typeof x === "string" ? x : fallback);

    return {
      v: 1,
      step: parsed.step === 2 || parsed.step === 3 ? parsed.step : 1,
      values: {
        schoolName: str(v.schoolName),
        subdomain: str(v.subdomain),
        adminEmail: str(v.adminEmail),
        adminName: str(v.adminName),
        studentCount: str(v.studentCount),
        acceptTerms: v.acceptTerms === true,
      },
      otpSent: parsed.otpSent === true,
      otpSentAt: typeof parsed.otpSentAt === "number" ? parsed.otpSentAt : null,
      otpCode: OTP_RE.test(str(parsed.otpCode)) ? str(parsed.otpCode) : "",
      emailVerified: parsed.emailVerified === true,
      txRef: typeof parsed.txRef === "string" && parsed.txRef ? parsed.txRef : null,
    };
  } catch {
    // Private mode, storage disabled, or corrupt JSON. Starting fresh is always
    // correct here — the only cost is retyping, and nothing is half-applied.
    return null;
  }
}

function saveRegistrationDraft(draft: RegistrationDraft): void {
  try {
    window.sessionStorage.setItem(REGISTRATION_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Quota or private mode. The wizard still works in-memory; it just becomes
    // discardable again, which is the pre-fix behaviour rather than a failure.
  }
}

function clearRegistrationDraft(): void {
  try {
    window.sessionStorage.removeItem(REGISTRATION_DRAFT_KEY);
  } catch {
    /* Nothing actionable — the draft is already unreachable. */
  }
}

/** Seconds still to wait before the resend button re-enables. Never negative. */
function resendSecondsRemaining(sentAt: number | null, at: number): number {
  if (!sentAt) return 0;
  return Math.max(0, OTP_RESEND_COOLDOWN_S - Math.floor((at - sentAt) / 1000));
}

/**
 * Admin name bounds — MUST equal ProvisionRequest.admin_name in
 * backend/main.py (min_length=3, max_length=80). Enforced here as well as in
 * app/api/register-school/route.ts so an out-of-range name is caught on Step 2,
 * BEFORE Flutterwave takes the money. scripts/verify-auth-flow.mjs asserts all
 * three layers agree, because a drift here is a paid-but-unprovisioned tenant.
 */
const ADMIN_NAME_MIN = 3;
const ADMIN_NAME_MAX = 80;

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Password input with an Eye/EyeOff visibility toggle.
 *
 * components/ui/Input renders a bare <input> with no slot for a trailing
 * control, so this duplicates its class string rather than bolting an
 * absolutely-positioned button over it — an overlay would sit on top of the
 * text and swallow clicks on the last characters.
 */
function PasswordField({
  id,
  label,
  name,
  placeholder,
  value,
  onChange,
  error,
  autoComplete,
  visible,
  onToggle,
  disabled,
}: {
  id: string;
  label: string;
  name: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete?: string;
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          disabled={disabled}
          className={`flex h-10 w-full rounded-xl border bg-surface-3 py-2 pl-3 pr-11 text-sm text-text-1 ring-offset-surface-0 placeholder:text-text-3 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            error
              ? "border-danger/60 focus-visible:ring-danger focus-visible:border-danger"
              : "border-line-1 focus-visible:ring-accent focus-visible:border-accent"
          }`}
        />
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-text-3 transition hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function RegisterSchoolForm() {
  /**
   * The resumable draft, read ONCE per mount.
   *
   * A lazy initialiser rather than a mount effect, for the same reason
   * `pendingRef` below uses one: this reads an external store, which is what
   * useState initialisers are for, and it avoids the setState-in-effect
   * cascading render that react-hooks/set-state-in-effect rejects.
   */
  const [draft] = useState<RegistrationDraft | null>(loadRegistrationDraft);

  const [values, setValues] = useState<FormValues>(() => {
    const base: FormValues = {
      schoolName: "",
      subdomain: "",
      adminEmail: "",
      adminName: "",
      adminPassword: "",
      adminPasswordConfirm: "",
      studentCount: "",
      acceptTerms: false,
    };
    // Rehydrate the non-secret fields. Passwords are intentionally left blank —
    // see the draft note. `values` is a fresh object either way so nothing
    // downstream can mutate the draft we captured at mount.
    return draft
      ? { ...base, ...draft.values, adminPassword: "", adminPasswordConfirm: "" }
      : base;
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkingSubdomain, setCheckingSubdomain] = useState(false);
  const [subdomainTaken, setSubdomainTaken] = useState(false);
  // 1 = school details, 2 = account security, 3 = review & payment.
  // Step 3 also renders the post-payment provisioning/provisioned states, which
  // is why `successData` (not the step number) is the terminal condition.
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(() => draft?.step ?? 1);
  const [transactionId, setTransactionId] = useState<string | null>(null);

  // --- Email OTP (inbox ownership proof, Step 1) --------------------------
  // isEmailVerified gates the Pay button, never navigation: a user with a
  // broken mail path can still reach review and see exactly what is missing.
  //
  // All four restore from the draft. Restoring `otpSent` is the load-bearing
  // one: without it the user comes back to a "Send code" button, asks for
  // another code, and is refused by the backend cooldown — the loop this
  // hydration exists to break.
  //
  // CAVEAT on isEmailVerified: this is a CLIENT-side gate. Nothing in
  // /api/register-school re-checks the OTP (it validates only that the email
  // is well-formed), so the flag is advisory by construction and always was.
  // Persisting it adds no capability that devtools did not already offer — but
  // it is not a security control and must not be described as one.
  const [isEmailVerified, setIsEmailVerified] = useState(
    () => draft?.emailVerified === true
  );
  const [otpCode, setOtpCode] = useState(() => draft?.otpCode ?? "");
  const [otpSent, setOtpSent] = useState(() => draft?.otpSent === true);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  // Epoch ms of the last successful send. The source of truth for the cooldown;
  // `otpResendIn` below is only its on-screen projection.
  const [otpSentAt, setOtpSentAt] = useState<number | null>(
    () => draft?.otpSentAt ?? null
  );
  const [otpResendIn, setOtpResendIn] = useState(() =>
    resendSecondsRemaining(draft?.otpSentAt ?? null, Date.now())
  );

  // Password visibility toggles (Step 2). Two independent fields — revealing
  // one must not reveal the other, so they are never combined.
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [txRef, setTxRef] = useState<string | null>(() => draft?.txRef ?? null);
  const [provisioning, setProvisioning] = useState(false);

  // --- Superadmin waiver code (Step 2) ------------------------------------
  //
  // `waiverSplit` is what the SERVER computed from the token's own row, not
  // what the browser previewed. It is only ever set from a hold response, so
  // the amount the customer is charged is not something this tab can talk the
  // backend into.
  //
  // `waiverBypassApproved` replaces `transactionId` as the trigger for
  // provisioning on a fully-waived order. There is no charge to produce a
  // transaction id, so the usual "wait for a payment" gate would never open
  // and the school would be stuck on step 3 forever.
  const [waiverToken, setWaiverToken] = useState("");
  const [waiverSplit, setWaiverSplit] = useState<WaiverSplitShape | null>(null);
  const [waiverBypassApproved, setWaiverBypassApproved] = useState(false);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [waiverPreview, setWaiverPreview] = useState<WaiverSplitShape | null>(null);
  const [waiverError, setWaiverError] = useState<string | null>(null);
  // A charge that exists but has not been confirmed by the provider (bank
  // transfers sit in `success-pending-validation` until settlement clears).
  // This is a waiting state, not a failure — it gets its own panel so a
  // customer who just paid is never told to contact support.
  const [paymentPending, setPaymentPending] = useState(false);
  // A reference survives a lost callback, so the wizard can always ask the
  // provider what happened instead of stranding a customer who already paid.
  const [pendingRef] = useState<string | null>(() => {
    // Lazy initialiser rather than a mount effect: this reads an external
    // store, which is exactly what useState initialisers are for, and it avoids
    // the setState-in-effect cascading render the lint rule rejects.
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage.getItem(PENDING_TX_REF_KEY);
    } catch {
      return null;
    }
  });
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);
  const [paidConflict, setPaidConflict] = useState<{ transactionId: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const provisionFired = useRef(false);
  const [successData, setSuccessData] = useState<{
    deployedUrl: string;
    domain: string;
    subdomain: string;
    schoolName: string;
  } | null>(null);

  // Post-provisioning hand-off. A paid user who closes the tab at the
  // Flutterwave modal must not be stranded on a dead end, so the wizard sends
  // them to their new portal on its own — but only once that portal actually
  // answers. See the readiness gate below.
  const PORTAL_HANDOFF_SECONDS = 5;

  // The countdown is DERIVED from a mount timestamp rather than stored as a
  // decrementing counter. Storing it would mean setState inside the effect body,
  // which react-hooks/set-state-in-effect rejects (a cascading render for
  // something already computable), and it would also drift if the tab were
  // backgrounded and timers throttled — the user would sit on "1s" indefinitely.
  const [handoffStartedAt, setHandoffStartedAt] = useState<number | null>(null);
  const [handoffCancelled, setHandoffCancelled] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /**
   * Portal root -> admin login.
   *
   * `deployed_url` is the portal ROOT, so we append /admin/login. But the
   * backend has shipped a login URL before, and a redirect that blindly appends
   * produces /admin/login/admin/login — a URL the user sees and panics over even
   * though it happens to render. Strip a trailing /admin/login first so this is
   * correct regardless of which shape the API returned.
   */
  const adminLoginUrl = useMemo(() => {
    if (!successData) return "";
    const root = successData.deployedUrl.replace(/\/+$/, "");
    return /\/admin\/login$/.test(root) ? root : `${root}/admin/login`;
  }, [successData]);

  function cancelHandoff() {
    setHandoffCancelled(true);
  }

  /**
   * Provisioning progress.
   *
   * A subdomain is NOT usable the moment the registry row is written: Vercel
   * still has to verify the domain and issue a certificate, and until it does
   * Cloudflare serves a 525 SSL-handshake page. Redirecting into that window is
   * what made a paid registration look like a failure, so we poll the backend's
   * readiness endpoint and only hand off once the portal actually answers.
   *
   * `percent` is deliberately capped below 100 until the portal genuinely
   * responds — showing 100% and then dropping the user on a 525 is worse than
   * an honest 85%.
   */
  const [progress, setProgress] = useState<{
    percent: number;
    stage: string;
    ready: boolean;
  } | null>(null);
  const [progressTimedOut, setProgressTimedOut] = useState(false);
  // Celebration anchors and once-per-registration state. Milestone bursts are
  // tied to the progress bar so particles originate where the user is looking;
  // the finale is anchored to the portal call to action.
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const portalCtaRef = useRef<HTMLAnchorElement | null>(null);
  const celebratedMilestones = useRef<Set<number>>(new Set());
  const celebratedCompletion = useRef(false);
  // Wall-clock of the last genuine backend advance. Powers the "still
  // working" notice when the provider takes a while — the bar keeps drifting
  // on simulated ticks, but after 45s of no real movement we say so plainly.
  const lastBackendAdvanceRef = useRef<number>(Date.now());
  // Single-shot handoff timer. Navigation is armed exactly once and fires from
  // its own timeout — it never depends on the 1s countdown ticker advancing,
  // so a stalled/throttled tick loop can no longer strand a paying customer.
  const handoffTimeoutRef = useRef<number | null>(null);
  // Hold navigation briefly after readiness so the completion celebration is
  // visible instead of being cut off by an instant redirect.
  const CELEBRATION_HOLD_MS = 2800;

  function clearHandoffTimeout() {
    if (handoffTimeoutRef.current !== null) {
      window.clearTimeout(handoffTimeoutRef.current);
      handoffTimeoutRef.current = null;
    }
  }

  // Armed once per success, from the event that sets successData, rather than
  // from an effect. This is the documented React escape hatch for "reset state
  // when a prop changes" and keeps the render path free of extra passes.
  if (successData && handoffStartedAt === null) {
    setHandoffStartedAt(Date.now());
    setHandoffCancelled(false);
    setNow(Date.now());
    setProgress(null);
    setProgressTimedOut(false);
  }

  const secondsElapsed = handoffStartedAt === null ? 0 : Math.floor((now - handoffStartedAt) / 1000);
  const handoffIn =
    successData && handoffStartedAt !== null && !handoffCancelled
      ? Math.max(0, PORTAL_HANDOFF_SECONDS - secondsElapsed)
      : null;

  useEffect(() => {
    celebratedMilestones.current.clear();
    celebratedCompletion.current = false;
    clearHandoffTimeout();
  }, [successData?.subdomain]);

  // Poll readiness. 5s interval keeps it responsive without hammering the API;
  // the 6-minute ceiling is generous because certificate issuance on a cold
  // subdomain has been observed to take several minutes.
  useEffect(() => {
    if (!successData) return;
    let cancelled = false;
    const slug = successData.subdomain || "";
    const started = Date.now();
    const MAX_WAIT_MS = 6 * 60 * 1000;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/readiness`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const percent = Number(data.percent);
        const ready = data.ready === true;
        const normalized = Number.isFinite(percent) ? Math.max(5, Math.min(100, percent)) : 40;
        setProgress((p) => {
          if (!p || normalized > p.percent) lastBackendAdvanceRef.current = Date.now();
          return {
            percent: normalized,
            stage: String(data.stage || "Setting up your portal"),
            ready,
          };
        });
        for (const milestone of [60, 85]) {
          if (normalized >= milestone && !celebratedMilestones.current.has(milestone)) {
            celebratedMilestones.current.add(milestone);
            fireMilestoneBurst(progressBarRef.current, milestone / 100);
          }
        }
        if (Date.now() - started > MAX_WAIT_MS && !ready) {
          setProgressTimedOut(true);
          return;
        }
        if (ready) return;
      } catch {
        // A transient failure must not strand the wizard; keep polling.
        if (cancelled) return;
        setProgress((p) => p ?? { percent: 35, stage: "Setting up your portal", ready: false });
      }
      if (!cancelled) window.setTimeout(tick, 5000);
    }

    void tick();
    return () => {
      cancelled = true;
    };
  }, [successData]);

  const portalReady = progress?.ready === true;

  // Displayed progress is decoupled from backend truth: it drifts upward
  // smoothly while waiting but can never reach 100 until the portal answers.
  // The backend `stage` strings stay in state for debugging; users only ever
  // see the friendly copy below.
  const displayPercent = useSimulatedProgress(progress?.percent ?? null, portalReady);
  /**
   * Mirror the resumable slice of wizard state into sessionStorage.
   *
   * No setState here, so it costs nothing but a serialise — the reason the
   * whole feature can live without tripping react-hooks/set-state-in-effect.
   *
   * Guarded on `!successData` so a completed registration can never rewrite a
   * draft after the success path cleared it.
   *
   * `otpCode` is persisted on purpose. The whole reason the user leaves the tab
   * is to copy that code; restoring it is the difference between resuming and
   * retyping. It is a 6-digit value with a ~10-minute TTL that the backend
   * burns on first successful use, so it is not a durable secret.
   */
  useEffect(() => {
    if (successData) return;
    saveRegistrationDraft({
      v: 1,
      step: currentStep,
      values: {
        schoolName: values.schoolName,
        subdomain: values.subdomain,
        adminEmail: values.adminEmail,
        adminName: values.adminName,
        studentCount: values.studentCount,
        acceptTerms: values.acceptTerms,
      },
      otpSent,
      otpSentAt,
      otpCode,
      emailVerified: isEmailVerified,
      txRef,
    });
  }, [
    successData,
    currentStep,
    values.schoolName,
    values.subdomain,
    values.adminEmail,
    values.adminName,
    values.studentCount,
    values.acceptTerms,
    otpSent,
    otpSentAt,
    otpCode,
    isEmailVerified,
    txRef,
  ]);

  const displayStage = friendlyStage(displayPercent, portalReady);  const stalled =
    !portalReady && !progressTimedOut && now - lastBackendAdvanceRef.current > 45000;

  // Bulletproof handoff: a single effect arms exactly one navigation timeout
  // when the portal becomes ready (or the wait times out). The visible
  // countdown below is display-only and never gates navigation, so a stalled
  // tick loop, backgrounded tab, or stale clock state cannot trap the user.
  // The readiness gate itself is unchanged: this effect does nothing until
  // the portal genuinely answers (or the timeout fallback fires).
  useEffect(() => {
    if (!successData || handoffCancelled) {
      clearHandoffTimeout();
      return;
    }
    if (!portalReady && !progressTimedOut) return;
    if (handoffTimeoutRef.current !== null) return;
    if (portalReady && !celebratedCompletion.current) {
      celebratedCompletion.current = true;
      fireCompletionBurst(portalCtaRef.current);
    }
    console.info("[handoff] portal ready — navigating shortly", {
      subdomain: successData.subdomain,
      timedOut: progressTimedOut && !portalReady,
    });
    handoffTimeoutRef.current = window.setTimeout(
      () => {
        handoffTimeoutRef.current = null;
        // Hard navigation: a client-side push would land on a cross-origin
        // subdomain, which Next cannot route.
        window.location.href = adminLoginUrl;
      },
      portalReady ? CELEBRATION_HOLD_MS : 0,
    );
    return () => {
      clearHandoffTimeout();
    };
  }, [successData, handoffCancelled, portalReady, progressTimedOut, adminLoginUrl]);

  // Display-only countdown ticker. This advances the visible "in Xs" text and
  // NOTHING else — navigation no longer depends on it, so a throttled or
  // stalled tick can only freeze a number on screen, never the redirect.
  useEffect(() => {
    if (!successData || handoffCancelled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [successData, handoffCancelled]);

  // Base domain fallback: NEXT_PUBLIC_BASE_DOMAIN || "resultapp.org"
  const baseDomain =
    process.env.NEXT_PUBLIC_BASE_DOMAIN?.trim() || "resultapp.org";

  const previewDomain = useMemo(() => {
    const slug = values.subdomain.trim() || "yourschool";
    return `${slug}.${baseDomain}`;
  }, [values.subdomain, baseDomain]);

  const isPreviewCustom = values.subdomain.trim().length > 0;

  // Pre-payment sniping guard: live availability check (debounced). If the
  // subdomain gets taken while the user fills the form, block submit/payment
  // before any money moves.
  const checkSeq = useRef(0);
  useEffect(() => {
    const slug = values.subdomain.trim();
    setSubdomainTaken(false);
    if (slug.length < 3 || !SUBDOMAIN_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
      setCheckingSubdomain(false);
      return;
    }
    const id = ++checkSeq.current;
    setCheckingSubdomain(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}`, { cache: "no-store" });
          const data = (await res.json().catch(() => ({}))) as { available?: boolean };
          if (checkSeq.current !== id) return;
          // 200 + available:false = taken; 404/available:true = free.
          setSubdomainTaken(res.ok && (data as { available?: boolean }).available === false);
        } catch {
          // Fail open on network errors — backend 409 remains the backstop.
        } finally {
          if (checkSeq.current === id) setCheckingSubdomain(false);
        }
      })();
    }, 500);
    return () => clearTimeout(t);
  }, [values.subdomain]);

  // -------------------------------------------------------------------------
  // Validation — scoped per step
  //
  // validateStep1/2 only populate the fields belonging to that step, so a user
  // A payment whose Flutterwave callback never arrived is recovered via
  // pendingRef, seeded by the lazy initialiser above. The reference is only
  // ever surfaced to the user, never auto-applied: we cannot know whether the
  // abandoned attempt belonged to the school now being registered, so the human
  // decides. resolvePaymentByReference still verifies server-side.

  // is never blocked by an error on a field they cannot see yet. Step 3 runs
  // all three so nothing invalid can reach the payment provider.
  // -------------------------------------------------------------------------
  function validateSchool(): FormErrors {
    const next: FormErrors = {};

    if (!values.schoolName.trim() || values.schoolName.trim().length < 3) {
      next.schoolName = "School name must be at least 3 characters";
    }

    const slug = values.subdomain.trim();
    if (!slug) {
      next.subdomain = "Subdomain is required";
    } else if (slug.length < 3 || slug.length > 30) {
      next.subdomain = "Must be 3–30 characters";
    } else if (!SUBDOMAIN_RE.test(slug)) {
      next.subdomain =
        "Only lowercase letters, numbers, and hyphens allowed";
    } else if (slug.startsWith("-") || slug.endsWith("-")) {
      next.subdomain = "Cannot start or end with hyphen";
    } else if (RESERVED_SLUGS.has(slug)) {
      next.subdomain = "This subdomain is reserved";
    }

    if (!values.adminEmail.trim()) {
      next.adminEmail = "Admin email is required";
    } else if (!isValidEmail(values.adminEmail.trim())) {
      next.adminEmail = "Enter a valid email address";
    }

    return next;
  }

  function validateSecurity(): FormErrors {
    const next: FormErrors = {};

    const name = values.adminName.trim();
    // Bounds mirror ProvisionRequest.admin_name in backend/main.py exactly
    // (min 3 / max 80). Provisioning runs AFTER payment, so a looser client
    // bound here does not produce a friendlier message — it produces a 422 the
    // user only meets once they have been charged.
    if (!name) {
      next.adminName = "Admin name is required";
    } else if (name.length < ADMIN_NAME_MIN) {
      next.adminName = `Admin name must be at least ${ADMIN_NAME_MIN} characters`;
    } else if (name.length > ADMIN_NAME_MAX) {
      next.adminName = `Admin name must be at most ${ADMIN_NAME_MAX} characters`;
    }

    if (!values.adminPassword) {
      next.adminPassword = "Admin password is required";
    } else if (values.adminPassword.length < 8) {
      next.adminPassword = "Password must be at least 8 characters";
    } else if (values.adminPassword.length > 128) {
      next.adminPassword = "Password must be at most 128 characters";
    }
    if (values.adminPasswordConfirm !== values.adminPassword) {
      next.adminPasswordConfirm = "Passwords do not match";
    }

    const rawCount = values.studentCount.trim();
    const count = parseInt(rawCount, 10);
    if (!rawCount) {
      next.studentCount = "Estimated student count is required";
    } else if (!Number.isFinite(count) || !Number.isInteger(count)) {
      next.studentCount = "Must be a whole number";
    } else if (count < MIN_REGISTRATION_STUDENTS) {
      // Registration floor. This is the check that actually PREVENTS the charge —
      // startFlutterwaveCheckout calls validateAll() before opening the modal —
      // so getting this right here is what keeps a sub-minimum school from being
      // charged and then refused by the backend.
      next.studentCount = `Minimum ${MIN_REGISTRATION_STUDENTS} students`;
    } else if (count > 10000) {
      next.studentCount = "Maximum 10,000 students";
    }

    return next;
  }

  /** Step 1 exit gate. */
  function validateStep1(): boolean {
    const next = validateSchool();
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  }

  /** Step 2 exit gate. */
  function validateStep2(): boolean {
    const next = validateSecurity();
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  }

  /**
   * Step 3 gate — runs every step's rules, plus consent. Consent is a hard gate
   * enforced server-side too (register-school re-validates), so checking it here
   * is about not letting the user pay and only then fail.
   */
  function validateAll(): boolean {
    const next = { ...validateSchool(), ...validateSecurity() };
    if (!values.acceptTerms) {
      next.acceptTerms =
        "You must accept the Terms of Service and Privacy Policy to continue";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  function handleChange<K extends keyof FormValues>(field: K, value: string | boolean) {
    if (field === "subdomain") value = sanitizeSlug(String(value));
    if (field === "studentCount") value = String(value).replace(/[^0-9]/g, "");
    setValues((prev) => ({ ...prev, [field]: value }) as FormValues);
    if (errors[field]) {
      setErrors((prev) => {
        const c = { ...prev };
        delete c[field];
        return c;
      });
    }
    if (globalError) setGlobalError(null);

    // Editing the address invalidates its proof: the code was issued for the
    // old value, so keeping isEmailVerified would let an unverified mailbox
    // reach payment by typing then reverting one character.
    if (field === "adminEmail") {
      resetOtp();
    }
  }

  // --- OTP -----------------------------------------------------------------

  function resetOtp() {
    setIsEmailVerified(false);
    setOtpCode("");
    setOtpSent(false);
    setOtpError(null);
    setOtpResendIn(0);
    // The timestamp MUST clear with the rest. Leaving it behind would keep
    // charging the cooldown against a code that no longer exists — after a
    // reload the new address would open with "Resend in 40s" despite nothing
    // having been sent to it.
    setOtpSentAt(null);
  }

  /** Countdown ticker for the resend button. */
  useEffect(() => {
    if (otpResendIn <= 0) return;
    const t = setTimeout(() => setOtpResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [otpResendIn]);

  /**
   * Recompute the cooldown when the tab comes back to the foreground.
   *
   * A backgrounded tab has its timers throttled or frozen outright, so the
   * decrementing counter above stops advancing while the wall clock keeps
   * going. Without this the user returns to a button reading "Resend in 48s"
   * when the real wait was over — and, worse, if they somehow reach it early
   * the backend refuses them, which is the same dead end this whole feature
   * exists to remove.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const remaining = resendSecondsRemaining(otpSentAt, Date.now());
      if (remaining !== otpResendIn) setOtpResendIn(remaining);
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [otpSentAt, otpResendIn]);

  async function sendOtp() {
    const email = values.adminEmail.trim();
    if (!isValidEmail(email)) {
      setOtpError("Enter a valid email address first.");
      return;
    }

    setOtpSending(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/auth/request-email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        // The backend returns an honest 502/503 when Brevo actually failed to
        // deliver, rather than the neutral 200 it uses to avoid enumeration.
        // Surfacing it here means a broken mail config is visible instead of
        // looking like "code sent, but it never arrived".
        setOtpError(
          data.error ||
            "We could not send a verification code. Please try again in a moment."
        );
        return;
      }

      setOtpSent(true);
      setOtpCode("");
      setOtpSentAt(Date.now());
      setOtpResendIn(OTP_RESEND_COOLDOWN_S);
      // The cooldown is the backend's, not ours — see `_cooldown_ok` in
      // auth_flow.request_email_otp. Seeding the timer from a local timestamp
      // keeps the button honest across a reload, and the backend still has the
      // final say if the two ever disagree.
    } catch {
      setOtpError("Could not reach the verification service. Check your connection.");
    } finally {
      setOtpSending(false);
    }
  }

  async function verifyOtp() {
    const email = values.adminEmail.trim();
    const code = otpCode.trim();
    if (!OTP_RE.test(code)) {
      setOtpError("Enter the 6-digit code from your email.");
      return;
    }

    setOtpVerifying(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/auth/verify-email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        verified?: boolean;
        message?: string;
        error?: string;
      };

      // A wrong/expired/replayed code comes back 200 with verified:false and one
      // uniform message. A 429 means the throttle tripped.
      if (!res.ok) {
        setOtpError(data.error || "Too many attempts. Request a new code.");
        return;
      }
      if (!data.verified) {
        setOtpError(data.message || "That code is incorrect or has expired.");
        return;
      }

      setIsEmailVerified(true);
      setOtpError(null);
    } catch {
      setOtpError("Could not reach the verification service. Try again.");
    } finally {
      setOtpVerifying(false);
    }
  }

  // Step 1 exit: validate, then prove the inbox, then re-check subdomain
  // availability live. Never touches the provision API — payment is Step 3.
  async function handleStep1Next(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError(null);

    if (!validateStep1()) return;

    // STRICT GATE — proven inbox ownership is required to leave Step 1.
    // Revised from the earlier "block payment only" decision: a registration
    // wizard that collects an admin email should not let an unproven address
    // advance into account security at all.
    //
    // Trade-off, stated plainly: if Brevo breaks (key missing, sender
    // unverified, 502), the user is stranded on Step 1 with no path forward.
    // That is the accepted cost of the strict gate. The failure is at least
    // self-explaining — sendOtp surfaces the backend's real reason rather than
    // the neutral "sent" response.
    if (!isEmailVerified) {
      setOtpError(
        otpSent
          ? "Enter the 6-digit code from your email to continue."
          : "Verify your admin email to continue — send a code first."
      );
      return;
    }

    // Sniped since the last keystroke: re-verify live before advancing.
    if (subdomainTaken) {
      setErrors((prev) => ({ ...prev, subdomain: "This subdomain was just taken — please choose another." }));
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/tenant/${encodeURIComponent(values.subdomain.trim())}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { available?: boolean };
      if (res.ok && data.available === false) {
        setSubdomainTaken(true);
        setErrors((prev) => ({ ...prev, subdomain: "This subdomain was just taken — please choose another." }));
        return;
      }
    } catch {
      // Fail open — backend 409 remains the backstop.
    } finally {
      setIsSubmitting(false);
    }

    setCurrentStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleStep2Next(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError(null);
    if (!validateStep2()) return;
    setCurrentStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack(target: 1 | 2) {
    setGlobalError(null);
    setCurrentStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Live order total for Step 2 summary (tiered slots).
  const orderCount = useMemo(() => {
    const n = parseInt(values.studentCount.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [values.studentCount]);
  const orderTier = useMemo(() => getPricingTier(orderCount), [orderCount]);
  const orderTotal = useMemo(() => calculateTieredTotal(orderCount), [orderCount]);

  /**
   * True when a waiver code already covers the WHOLE order.
   *
    * Derived from the last SERVER response, never from a locally predicted
    * split, so the decision to skip the payment provider is made on the same
    * number the backend will charge against.
    *
    * Falls back to the step-2 preview because `waiverSplit` is only set once
    * the hold POST returns — which happens on the button click. Reading
    * `waiverSplit` alone meant step 3's FIRST render still showed "Pay ₦45,000
    * with Flutterwave", since nothing had been held yet.
    *
    * A stale preview can only mislabel the button, never divert a payment: the
    * branch that actually skips Flutterwave reads the hold's own response.
    */
  const waiverBypass = (waiverSplit ?? waiverPreview)?.bypass_gateway === true;

  /**
   * Re-price the waiver whenever the code or the slot count changes.
   *
   * Debounced because the count is a free-text field: previewing on every
   * keystroke would spend the public endpoint's rate-limit budget on a
   * half-typed "1500".
   *
   * A cleared or invalid code clears the preview rather than leaving a stale
   * one on screen — showing a discount that no longer applies is how a school
   * reaches checkout expecting ₦0 and is asked for ₦7,000.
   */
  useEffect(() => {
    const code = waiverToken.trim();
    if (!code || orderCount < MIN_REGISTRATION_STUDENTS) {
      setWaiverPreview(null);
      setWaiverError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/billing/waiver/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token_string: code,
            requested_slots: orderCount,
            applies_to: "REGISTRATION",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          split?: WaiverSplitShape;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.split) {
          setWaiverPreview(null);
          setWaiverError(data.error ?? "That waiver code could not be applied");
          return;
        }
        setWaiverError(null);
        setWaiverPreview(data.split);
      } catch {
        if (!cancelled) {
          setWaiverPreview(null);
          setWaiverError("Could not check that code. Try again.");
        }
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waiverToken, orderCount]);
  // Is the "Free 30 credits" offer currently switched on platform-wide?
  //
  // Defaults to TRUE, so a failed or slow fetch leaves registration behaving
  // exactly as it does today rather than silently withdrawing a live promotion.
  // Failing open is the right direction here: hiding a real offer is a worse
  // error for a school than briefly showing one the superadmin has paused, and
  // the backend remains the sole authority either way — it simply withholds the
  // grant, so the worst outcome is copy we should not have shown.
  const [freeCreditsEnabled, setFreeCreditsEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/config/free-credits", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        // Only an explicit `false` hides the offer. A malformed or partial
        // response must not be read as "disabled".
        if (typeof d.enabled === "boolean") setFreeCreditsEnabled(d.enabled);
      })
      .catch(() => {
        // Deliberately silent: the default of true already applies, and a
        // console warning about a policy fetch would be noise on every visit.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Copy-only mirror of the server's free-credit policy. The server remains the
  // sole authority — this just keeps the registration copy honest instead of
  // promising credits that may be withheld.
  const qualifiesFreeCredits =
    freeCreditsEnabled && orderCount >= FREE_CREDIT_MIN_STUDENTS;

  async function startFlutterwaveCheckout() {
    setGlobalError(null);

    // Final gate before money moves. The Pay button already blocks on consent
    // and email verification, but this re-checks every step's rules — a value
    // could have been edited in another tab, and /api/register-school
    // re-validates server-side anyway, so failing here beats failing after a
    // successful charge.
    if (!validateAll()) return;

    // Registration is ALWAYS a real tenant — there is no demo path here, so
    // this is the live key or nothing. Resolving it before any await, inside
    // the caller's error handling, means a misconfigured deployment shows the
    // visitor "payments are unavailable" instead of a checkout that accepts
    // their details and takes no money.
    //
    // SKIPPED ENTIRELY ON A 100% WAIVER, which is the point of that path: a
    // school whose portal is being paid for by a superadmin goodwill code must
    // still be able to register if Flutterwave is down. Gating the bypass on a
    // payment provider's key being present would make free access the least
    // reliable access.
    let publicKey: string | null = null;
    if (!waiverBypass) {
      try {
        publicKey = getFlutterwavePublicKey();
      } catch (e) {
        setGlobalError(
          e instanceof Error
            ? e.message
            : "Payments are unavailable right now. Please contact support.",
        );
        console.error("[register] Flutterwave key resolution failed", e);
        return;
      }
    }

    // Park the registration server-side BEFORE opening checkout.
    //
    // Once the modal takes over, the browser callback is the only thing that
    // can finish provisioning — and a closed tab, a crash, or a dead connection
    // loses it. The hold gives the webhook everything it needs to finish the
    // job independently. The admin password is encrypted before it is sent
    // (lib/pendingRegistrationCrypto.ts) and is deliberately still absent from
    // the checkout `meta` below.
    //
    // With a waiver code the hold route ALSO reserves that code under this same
    // tx_ref, so one reference ties the token, the hold and (if there is one)
    // the charge together.
    let ref: string;
    let waiverSplit: WaiverSplitShape | null = null;
    try {
      const held = await holdRegistration({
        school_name: values.schoolName.trim(),
        subdomain: values.subdomain.trim().toLowerCase(),
        admin_name: values.adminName.trim() || undefined,
        admin_email: values.adminEmail.trim(),
        admin_password: values.adminPassword,
        student_count: orderCount,
        accepted_terms: true,
        ...(waiverToken ? { waiver_token: waiverToken } : {}),
      });
      ref = held.tx_ref;
      // The SERVER's split, not the preview the browser showed. The backend
      // recomputes from the token's own row, and this is that answer — so a
      // tampered preview cannot lower what the customer is asked to pay.
      waiverSplit = held.waiver && held.waiver.charged_ngn !== undefined
        ? (held.waiver as unknown as WaiverSplitShape)
        : null;
      // Persist the server's answer into state. The local shadow is gone by the
      // time the next render happens, so without this the split existed only
      // inside this function and every consumer had to guess at it.
      setWaiverSplit(waiverSplit);
    } catch (e) {
      setGlobalError(
        e instanceof Error
          ? `Could not start checkout: ${e.message}`
          : "Could not start checkout. Please try again.",
      );
      console.error("[register] failed to hold registration", e);
      return;
    }

    // A fully-waived order has nothing to charge. Go straight to provisioning
    // instead of opening a modal Flutterwave will reject for ₦0 — and there is
    // no callback to wait on, so we seed the same state the payment path does.
    if (waiverSplit?.bypass_gateway) {
      try {
        window.sessionStorage.setItem(PENDING_TX_REF_KEY, ref);
      } catch {
        /* private mode */
      }
      setIsSubmitting(true);
      setTransactionId("");
      setTxRef(ref);
      setWaiverBypassApproved(true);
      setPaidConflict(null);
      setCurrentStep(3);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const customerEmail = values.adminEmail.trim();
    // Admin Name is now collected in Step 2. The email prefix was a poor
    // fallback ("j.obi" reads as noise on a bank statement), so it is only
    // used if the field is somehow empty.
    const customerName =
      values.adminName.trim() || customerEmail.split("@")[0] || values.schoolName.trim();

    // Charged total. With a waiver this is the DISCOUNTED figure, charged at
    // the tier of the FULL slot count — the same rule the backend applies.
    const checkoutTotal = waiverSplit
      ? Number(waiverSplit.charged_ngn ?? orderTotal)
      : orderTotal;
    const checkoutCount = waiverSplit ? Number(waiverSplit.charged_slots ?? orderCount) : orderCount;

    const openModal = () => {
      const checkout = initiateFlutterwaveInlinePayment(
        {
            publicKey: publicKey!,
          txRef: ref,
          amount: checkoutTotal,
          currency: "NGN",
           customer: { email: customerEmail, name: customerName },
          customizations: {
            title: `ResultApp • ${values.schoolName.trim()}`,
            description: waiverSplit
              ? `${checkoutCount} of ${orderCount} slots — ${formatNaira(checkoutTotal)} after waiver`
              : `${orderCount} slots × ${formatNaira(orderTier.pricePerStudent)} = ${formatNaira(orderTotal)}`,
            logo: "https://resultapp.org/logo.png",
          },
          // Transactional identifiers only. The admin password is
          // deliberately NOT here: `meta` is transmitted to Flutterwave and
          // retained in their transaction metadata, so anything placed in it
          // is disclosed to a third-party payment provider and the school
          // never authorised that disclosure.
          //
          // The password reaches the backend on the server-to-server
          // provisioning call instead — it is sent to /api/register-school in
          // the POST body, forwarded as admin_password, and stored as a
          // pgcrypto bcrypt hash. See LEGAL_REMEDIATION.md P0 item 3.
          //
          // The WAIVER CODE is excluded for the same reason and for a more
          // specific one: it is a bearer credential with cash value. It has
          // already been exchanged for a reservation under `ref`, which is
          // what Flutterwave is told about and what the burn is scoped to.
          meta: {
            schoolName: values.schoolName.trim(),
            subdomain: values.subdomain.trim(),
            adminEmail: customerEmail,
            studentCount: orderCount,
            source: "registration_wizard",
          },
        },
        {
          onSuccess: (res) => {
            const ok =
              res.status === "successful" ||
              res.status === "completed" ||
              res.status === "success" ||
              !!res.transaction_id;
            if (!ok || !res.transaction_id) {
              setGlobalError("Payment was not successful. Please try again — nothing was created.");
              return;
            }
            // Flutterwave intentionally leaves its success screen visible after
            // invoking callback. Dismiss it immediately so the paid customer
            // sees the live provisioning progress underneath. This is only UI
            // dismissal: provisioning still waits for server-side verification.
            try {
              checkout?.close();
            } catch (err) {
              console.warn("[RegisterSchoolForm] checkout dismissal failed", err);
            }
            setTransactionId(String(res.transaction_id));
            setTxRef(res.tx_ref || ref);
            setPaidConflict(null);
            setCurrentStep(3);
            window.scrollTo({ top: 0, behavior: "smooth" });
          },
          onClose: () => {
            // A closed modal is NOT proof of a cancelled payment. Flutterwave
            // leaves its own success screen up and only calls onclose when the
            // user dismisses it, so the common case here is "paid, modal
            // dismissed" — telling that customer nothing was created strands
            // them with a charge and no portal. Always ask the provider what
            // actually happened to the reference we generated.
            void resolvePaymentByReference(ref, true);
          },
          onError: () => {
            setGlobalError("Payment checkout failed to start. Check your connection and retry.");
          },
        },
      );
    };

    if (!publicKey) {
      console.warn("NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY not set — using dummy key");
    }
    setIsSubmitting(true);
    // Persist the reference BEFORE checkout opens. If the modal never hands
    // control back, this is the only surviving link to the payment.
    try {
      window.sessionStorage.setItem(PENDING_TX_REF_KEY, ref);
    } catch {
      /* private mode — the in-memory ref still works for this tab */
    }
    loadFlutterwaveScript()
      .then(openModal)
      .catch((err) => {
        console.error(err);
        setGlobalError("Could not load Flutterwave checkout. Check your connection and try again.");
      })
      .finally(() => setIsSubmitting(false));
  }

  /**
   * Recovery path for a payment whose inline callback never resolved.
   *
   * Asks the server what happened to `ref`. On a confirmed success it seeds
   * `transactionId`, which is all the provisioning effect needs — the server
   * re-verifies the charge independently, so this cannot provision a payment
   * that did not happen.
   */
  async function resolvePaymentByReference(ref: string, fromModalClose: boolean) {
    setIsCheckingPayment(true);
    try {
      const res = await fetch(
        `/api/register-school/status?tx_ref=${encodeURIComponent(ref)}`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        paid?: boolean;
        pending?: boolean;
        transaction_id?: number | string;
      };

      if (data.paid && data.transaction_id) {
        setGlobalError(null);
        setPaymentPending(false);
        setTransactionId(String(data.transaction_id));
        setTxRef(ref);
        setPaidConflict(null);
        setCurrentStep(3);
        try {
          window.sessionStorage.removeItem(PENDING_TX_REF_KEY);
        } catch {
          /* ignore */
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // Charge exists but is unconfirmed. Do NOT claim "no payment found" —
      // the money is with the provider, awaiting settlement.
      if (data.pending) {
        setCurrentStep(3);
        setPaymentPending(true);
        setGlobalError(
          "Your payment is still processing. Bank transfers stay unconfirmed until the provider clears them — nothing has been created yet, and you will not be charged twice."
        );
        return;
      }

      if (fromModalClose) {
        setGlobalError(
          "No completed payment was found for this attempt — nothing was created. You can retry anytime."
        );
      }
    } catch {
      if (fromModalClose) {
        setGlobalError(
          "We could not confirm your payment status. If you were charged, contact support@resultapp.org with your reference and we will sort it out."
        );
      }
    } finally {
      setIsCheckingPayment(false);
    }
  }

  /** Manual escape hatch for a customer who believes they were charged. */
  function checkPaymentStatus() {
    const ref = txRef || pendingRef || "";
    if (!ref) {
      setGlobalError("No payment attempt to check yet.");
      return;
    }
    void resolvePaymentByReference(ref, true);
  }

  function useDevMockPayment() {
    setGlobalError(null);
    setPaidConflict(null);
    setTransactionId("DEV_MOCK_TX");
    setTxRef(generateTxRef(values.subdomain.trim() || "school"));
    setCurrentStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Step 3: fire the provision request exactly once (StrictMode-safe ref guard).
  // retryNonce re-arms the effect for manual retries with the same tx.
  useEffect(() => {
    // The 100% bypass has no transaction id, so the trigger is "either a
    // payment landed" OR "the waiver was confirmed to cover everything". The
    // old `!transactionId` guard alone would strand a fully-waived school on
    // step 3 with a spinner and nothing to wait for.
    const ready = !!transactionId || waiverBypassApproved;
    if (currentStep !== 3 || !ready || provisionFired.current || successData) return;
    provisionFired.current = true;

    const payload = {
      schoolName: values.schoolName.trim(),
      subdomain: values.subdomain.trim().toLowerCase(),
      adminEmail: values.adminEmail.trim().toLowerCase(),
      adminName: values.adminName.trim(),
      adminPassword: values.adminPassword,
      studentCount: parseInt(values.studentCount.trim(), 10),
      // No initial_credits: the backend is strictly authoritative. It grants the
      // free credits only when the superadmin toggle is ON *and* the initial
      // capacity is >= 500 (inclusive). Sending a value here would be ignored.
      // Consent — the server re-validates this and refuses to provision
      // without it, then persists the versions from lib/legal/constants.ts.
      acceptTerms: values.acceptTerms,
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      // Null on a 100% waiver bypass — there is no Flutterwave transaction to
      // name. The server's own split decides that, and inventing a placeholder
      // here would put a fake reference into the ledger's anti-replay column.
      transaction_id: transactionId || null,
      tx_ref: txRef,
    };

    setProvisioning(true);
    setGlobalError(null);
    setPaymentPending(false);

    void (async () => {
      try {
        const res = await fetch("/api/register-school", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          code?: string;
          pending?: boolean;
          transaction_id?: string;
          fieldErrors?: Record<string, string>;
          deployed_url?: string;
          deployedUrl?: string;
          domain?: string;
          subdomain?: string;
          school_name?: string;
          details?: string;
        };

        // Provider has the charge but has not confirmed it yet. Not an error —
        // surface it as "still processing" and let the user re-check.
        if (data.pending) {
          setPaymentPending(true);
          setGlobalError(data.error || null);
          return;
        }

        if (!res.ok || !data.success) {
          if (data.fieldErrors) {
            const mapped: FormErrors = {};
            if (data.fieldErrors.subdomain) mapped.subdomain = data.fieldErrors.subdomain;
            if (data.fieldErrors.schoolName) mapped.schoolName = data.fieldErrors.schoolName;
            if (data.fieldErrors.adminEmail) mapped.adminEmail = data.fieldErrors.adminEmail;
            if (data.fieldErrors.adminName) mapped.adminName = data.fieldErrors.adminName;
            if (data.fieldErrors.adminPassword) mapped.adminPassword = data.fieldErrors.adminPassword;
            if (data.fieldErrors.studentCount) mapped.studentCount = data.fieldErrors.studentCount;
            if (data.fieldErrors.acceptTerms) mapped.acceptTerms = data.fieldErrors.acceptTerms;
            if (Object.keys(mapped).length > 0) setErrors((prev) => ({ ...prev, ...mapped }));
          }

          // Paid-but-sniped: no auto-retry (same tx would 400) — support ticket.
          if (data.code === "PAID_SUBDOMAIN_TAKEN") {
            setPaidConflict({ transactionId: String(data.transaction_id || transactionId) });
            setGlobalError(null);
            return;
          }

          if (res.status === 409) {
            throw new Error(data.error || "Subdomain already exists — please choose another.");
          }

          throw new Error(
            data.error || data.details || `Provisioning failed (${res.status}). Please try again or contact support@resultapp.org.`
          );
        }

        const deployedUrl =
          data.deployed_url || data.deployedUrl || `https://${payload.subdomain}.${baseDomain}`;
        const domain = data.domain || `${payload.subdomain}.${baseDomain}`;

        setSuccessData({
          deployedUrl,
          domain,
          subdomain: data.subdomain || payload.subdomain,
          schoolName: data.school_name || payload.schoolName,
        });
        // The tenant exists now, so a resumable draft is worse than useless: it
        // would drop the user back onto a Step 1 for a school that is already
        // live. Success is terminal.
        clearRegistrationDraft();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
        setGlobalError(message);
        console.error("[RegisterSchoolForm] provision error:", err);
      } finally {
        setProvisioning(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, transactionId, retryNonce]);

  function retryProvision() {
    provisionFired.current = false;
    setGlobalError(null);
    setPaidConflict(null);
    setPaymentPending(false);
    setRetryNonce((n) => n + 1);
  }

  function resetWizard() {
    provisionFired.current = false;
    setRetryNonce(0);
    setSuccessData(null);
    setTransactionId(null);
    setTxRef(null);
    setHandoffStartedAt(null);
    setHandoffCancelled(false);
    setPaidConflict(null);
    setProvisioning(false);
    setValues({ schoolName: "", subdomain: "", adminEmail: "", adminName: "", adminPassword: "", adminPasswordConfirm: "", studentCount: "", acceptTerms: false });
    setErrors({});
    resetOtp();
    setShowPassword(false);
    setShowConfirmPassword(false);
    setCurrentStep(1);
  }

  // -------------------------------------------------------------------------
  // Success state
  // -------------------------------------------------------------------------
  if (successData) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft ring-1 ring-success/30">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>

        <h3 className="mt-6 text-2xl font-bold tracking-tight text-text-1">School provisioned!</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-text-3">
          {portalReady
            ? "Your school portal is live. Please check your email at "
            : "Your payment is confirmed and your school is registered. Please check your email at "}
          <span className="font-medium text-text-1">{values.adminEmail}</span> for login credentials and next steps.
        </p>

        {portalReady ? (
          <a
            ref={portalCtaRef}
            href={adminLoginUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-mono text-sm font-semibold text-accent-fg shadow-[0_0_20px_rgba(147,51,234,0.35)] transition hover:bg-accent-hover"
          >
            <Globe className="h-4 w-4" />
            {successData.domain}
            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          </a>
        ) : (
          <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-surface-3 px-5 py-2.5 font-mono text-sm font-semibold text-text-2 ring-1 ring-accent/30">
            <Globe className="h-4 w-4" />
            {successData.domain}
          </p>
        )}

        <div className="mt-6 w-full rounded-2xl border border-line-2 bg-surface-2 p-4 text-left backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-medium text-text-1">
            <Sparkles className="h-4 w-4 text-accent" />
            What happens next?
          </div>
          <ul className="mt-3 space-y-2 text-sm text-text-2">
            <li>• Portal <span className="font-mono text-text-2">{successData.domain}</span> {portalReady ? "is live over HTTPS" : "is being issued its SSL certificate"}</li>
            <li>• Admin login sent to <span className="text-text-1">{values.adminEmail}</span></li>
            <li>• Signing in at <span className="font-mono text-text-2">{successData.domain}/admin/login</span> {portalReady ? "now" : "as soon as it is ready"}</li>
          </ul>
        </div>

        <div aria-live="polite" className="mt-6 w-full">
          {!portalReady ? (
            /* Readiness gate: this is the whole point of the screen. The
               subdomain exists in the registry but Vercel has not finished
               issuing its certificate, and until it has, Cloudflare serves a 525
               SSL-handshake page. Showing the bar here — instead of bouncing
               the customer into that error — is what stops a successful
               registration from looking like a failure. */
            <div className="rounded-2xl border border-line-2 bg-surface-2 p-5 text-left">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-medium text-text-1">
                  {!progressTimedOut && (
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  )}
                  {displayStage}
                </p>
                <span className="font-mono text-sm tabular-nums text-text-2">
                  {displayPercent}%
                </span>
              </div>

              <div
                ref={progressBarRef}
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-valuenow={displayPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Portal setup progress"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-400 transition-[width] duration-700 ease-out"
                  style={{ width: `${displayPercent}%` }}
                />
              </div>

              <p className="mt-3 text-xs leading-5 text-text-3">
                {progressTimedOut
                  ? "This is taking longer than usual — your subdomain is registered and your payment is safe. You can wait a little longer or open it now and refresh shortly."
                  : stalled
                    ? "Still working — this step sometimes takes a few minutes. Your payment is safe and your school is registered."
                    : "Your payment is confirmed and your school is registered. We are issuing the SSL certificate for your subdomain — this normally takes under a minute. You will be taken to your admin login automatically."}
              </p>

              {progressTimedOut && (
                <a
                  href={adminLoginUrl}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 font-semibold text-accent-fg hover:bg-accent-hover"
                >
                  <Globe className="h-4 w-4" />
                  Open my portal now
                </a>
              )}

              {!progressTimedOut && (
                <button
                  type="button"
                  onClick={cancelHandoff}
                  className="mt-3 w-full text-center text-xs font-medium text-text-3 underline decoration-accent/30 underline-offset-4 hover:text-text-2"
                >
                  Stay on this page
                </button>
              )}
            </div>
          ) : handoffIn !== null ? (
            <div className="rounded-2xl border border-line-1 bg-surface-2 p-4">
              <p className="flex items-center justify-center gap-2 text-sm font-medium text-text-1">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                Taking you to your admin login in {handoffIn}s…
              </p>
              <button
                type="button"
                onClick={() => (window.location.href = adminLoginUrl)}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 font-semibold text-accent-fg hover:bg-accent-hover"
              >
                Open admin login now
              </button>
              <button
                type="button"
                onClick={cancelHandoff}
                className="mt-2 w-full text-center text-xs font-medium text-text-3 underline decoration-accent/30 underline-offset-4 hover:text-text-2"
              >
                Stay on this page
              </button>
            </div>
          ) : (
            <>
              <Button
                className="w-full rounded-full bg-accent font-semibold text-accent-fg hover:bg-accent-hover"
                size="lg"
                onClick={() => (window.location.href = adminLoginUrl)}
              >
                Go to your admin login
              </Button>
              <button
                type="button"
                onClick={resetWizard}
                className="mt-3 text-xs font-medium text-text-3 underline decoration-accent/30 underline-offset-4 hover:text-text-2"
              >
                Register another school
              </button>
            </>
          )}
        </div>

        <p className="mt-3 text-xs text-text-3">
          Need help? Contact support@resultapp.org • {successData.domain}
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Form UI
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Form UI
  // -------------------------------------------------------------------------
  const steps = [
    { n: 1, label: "School details" },
    { n: 2, label: "Account security" },
    { n: 3, label: "Review & pay" },
  ] as const;

  function renderStepIndicator() {
    return (
      <div className="mx-auto mb-8 flex items-center justify-center gap-2 text-sm" aria-label="Registration steps">
        {steps.map((s, i) => {
          const done = currentStep > s.n;
          const active = currentStep === s.n;
          return (
            <span key={s.n} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-6 bg-line-1 sm:w-8" />}
              <span
                className={
                  active
                    ? "flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_0_14px_rgba(147,51,234,0.45)] ring-1 ring-accent/30"
                    : done
                      ? "flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white"
                      : "flex h-7 w-7 items-center justify-center rounded-full border border-line-1 bg-surface-3 text-text-3"
                }
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : s.n}
              </span>
              <span className={active ? "font-medium text-text-1" : done ? "text-success/80" : "text-text-3"}>
                {s.label}
              </span>
            </span>
          );
        })}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Post-payment: provisioning / paid-conflict / failure. Distinguished from
  // Step 3 (review & pay) by having a transactionId — before payment there is
  // nothing to provision.
  // -------------------------------------------------------------------------
  if (currentStep === 3 && transactionId && !successData) {
    return (
      <div>
        {renderStepIndicator()}
        {paidConflict ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning-soft ring-1 ring-warning/30">
              <AlertCircle className="h-8 w-8 text-warning" />
            </div>
            <h3 className="mt-6 text-2xl font-bold tracking-tight text-text-1">Subdomain just taken</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-3">
              Your payment went through, but <span className="font-mono font-medium text-text-1">{values.subdomain.trim()}.resultapp.org</span> was
              registered by someone else first. Do not pay again — contact{" "}
              <span className="font-medium text-text-1">support@resultapp.org</span> with reference{" "}
              <span className="font-mono font-medium text-text-1">{paidConflict.transactionId}</span> for
              a manual setup or refund.
            </p>
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="mt-6 w-full rounded-full bg-accent py-3 font-semibold text-accent-fg hover:bg-accent-hover"
            >
              Choose a different subdomain
            </button>
          </div>
        ) : provisioning ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-accent" />
            <h3 className="mt-6 text-2xl font-bold tracking-tight text-text-1">Creating your portal…</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-3">
              Payment confirmed. Provisioning your database, site, and admin account — this may take a minute.
              Please keep this tab open.
            </p>
          </div>
        ) : paymentPending ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning-soft ring-1 ring-warning/30">
              <Clock className="h-8 w-8 text-warning" />
            </div>
            <h3 className="mt-6 text-2xl font-bold tracking-tight text-text-1">
              Payment still processing
            </h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-3">
              {globalError ||
                "Your payment has been received but the provider has not confirmed it yet. Bank transfers can take a few minutes to clear."}
            </p>
            <p className="mt-2 max-w-md text-xs leading-5 text-text-3">
              Your money is safe and your portal will be built automatically once the payment
              clears. Nothing has been created yet, and you will not be charged twice.
            </p>
            <div className="mt-6 flex w-full flex-col gap-2">
              <Button
                className="w-full gap-2 rounded-full bg-accent font-semibold text-accent-fg hover:bg-accent-hover"
                size="lg"
                onClick={retryProvision}
              >
                <Loader2 className="h-4 w-4" /> Check again
              </Button>
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="text-xs font-medium text-text-3 underline decoration-accent/30 underline-offset-4 hover:text-text-2"
              >
                Back to checkout
              </button>
            </div>
          </div>
        ) : globalError ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-soft ring-1 ring-danger/30">
              <AlertCircle className="h-8 w-8 text-danger" />
            </div>
            <h3 className="mt-6 text-2xl font-bold tracking-tight text-text-1">Provisioning failed</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-3">{globalError}</p>
            <p className="mt-2 max-w-md text-xs leading-5 text-text-3">
              Your payment is safe — retrying reuses transaction {transactionId} and never double-provisions.
            </p>
            <div className="mt-6 flex w-full flex-col gap-2">
              <Button
                className="w-full gap-2 rounded-full bg-accent font-semibold text-accent-fg hover:bg-accent-hover"
                size="lg"
                onClick={retryProvision}
              >
                <Loader2 className="h-4 w-4" /> Retry provisioning
              </Button>
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="text-xs font-medium text-text-3 underline decoration-accent/30 underline-offset-4 hover:text-text-2"
              >
                Back to checkout
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Step 3 — review & payment
  // -------------------------------------------------------------------------
  if (currentStep === 3) {
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname.includes("localhost") || window.location.hostname.includes("127.0.0.1"));

    // Single source of truth for why the Pay button is unavailable, rendered as
    // a hint rather than leaving a dead button with no explanation.
    const payBlockedByTerms = !values.acceptTerms;
    const payBlockedByEmail = !isEmailVerified;
    // Disabled on the REGISTRATION floor, not just "empty". With only an
    // `orderCount <= 0` check the Pay button stayed live for a typed-in 5, so
    // the visitor paid for five slots and was then refused by the backend. The
    // hint below explains the same threshold, so the button's state and its
    // explanation can never disagree.
    const payDisabled = isSubmitting || orderCount < MIN_REGISTRATION_STUDENTS || payBlockedByTerms || payBlockedByEmail;
    const payHint = payBlockedByTerms
      ? "Accept the Terms of Service and Privacy Policy to continue."
      : payBlockedByEmail
        ? "Verify your admin email to unlock payment."
        : orderCount < MIN_REGISTRATION_STUDENTS
          ? orderCount <= 0
            ? "Enter your estimated student count to see a total."
            : `Minimum ${MIN_REGISTRATION_STUDENTS} students.`
          : null;

    return (
      <div>
        {renderStepIndicator()}
        <h3 className="text-lg font-bold tracking-tight text-text-1">Review &amp; pay</h3>
<div className="mt-4 rounded-2xl border border-line-2 bg-surface-2 p-4 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-text-3">Admin</span>
            <span className="font-medium text-text-1">
              {values.adminName.trim() || "—"}
              {isEmailVerified && (
                <span className="ml-1.5 inline-flex align-middle text-success" title="Email verified">
                  <MailCheck className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">email verified</span>
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-text-3">Email</span>
            <span className="font-medium text-text-1">{values.adminEmail.trim() || "—"}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-text-3">Subdomain</span>
            <span className="font-mono font-medium text-text-1">{previewDomain}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-text-3">Student slots</span>
            <span className="font-medium text-text-1">
              {orderCount} × {formatNaira(orderTier.pricePerStudent)}
              {orderTier.badge ? <span className="ml-2 text-xs text-success">{orderTier.badge}</span> : null}
            </span>
          </div>
          <div className="my-2 border-t border-line-2" />
          {/* The bill is the SERVER's split, not the list price. Showing
              orderTotal here told a fully-waived buyer they still owed
              ₦45,000 one screen before a portal appeared for free, which reads
              as a bait-and-switch even when the checkout does honour the waiver.
              Strikethrough list price carries the discount; the waived part is
              named so the entitlement is visible rather than implied. */}
          {waiverPreview ? (
            <>
              <div className="flex justify-between py-1">
                <span className="text-text-3">Waived</span>
                <span className="font-medium text-success">
                  −{formatNaira(waiverPreview.waived_ngn ?? 0)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-text-3">
                  {waiverPreview.waived_slots} of {orderCount} slots covered
                </span>
                <span className="font-medium text-success">
                  {waiverPreview.discount_percentage}% off
                </span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between py-1 text-base font-bold text-text-1">
            <span>{waiverBypass ? "Total due — fully covered" : "Total due"}</span>
            <span className={waiverBypass ? "text-success" : undefined}>
              {formatNaira(waiverPreview ? Number(waiverPreview.charged_ngn ?? orderTotal) : orderTotal)}
              {waiverPreview ? (
                <span className="ml-2 text-xs font-normal text-text-3 line-through">
                  {formatNaira(orderTotal)}
                </span>
              ) : null}
            </span>
          </div>
          {/* Step 3 footnote. Unmounts entirely when the offer is paused —
              including the negative branch, which said "Publishing credits are
              topped up separately". That sentence is fine on its own, but it
              only ever appeared as the OTHER half of an offer we are choosing
              not to advertise, so keeping it while removing its counterpart
              would leave a trace of the promotion with none of the substance. */}
          {freeCreditsEnabled ? (
            <p className="mt-1 text-xs text-text-3">
              {qualifiesFreeCredits
                ? `Includes ${FREE_CREDIT_GRANT} free publishing credits at launch.`
                : "Publishing credits are topped up separately from your portal."}
            </p>
          ) : null}
        </div>

        {globalError && (
          <div className="mt-4 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span>{globalError}</span>
          </div>
        )}

        {/* Consent — a real, required checkbox, not a passive notice. The
            accepted version strings are persisted server-side alongside the
            tenant row (LEGAL_REMEDIATION.md P0 item 4). components/ui/Input
            hardcodes text-input styling, so this is a raw checkbox.

            Placed directly above the Pay button: consent is a precondition of
            paying, and burying it under a long summary made it easy to miss
            while still leaving the button visible. */}
        <div className="mt-4 rounded-2xl border border-line-2 bg-surface-2 p-4">
          <label htmlFor="acceptTerms" className="flex cursor-pointer items-start gap-3">
            <input
              id="acceptTerms"
              type="checkbox"
              checked={values.acceptTerms}
              onChange={(e) => handleChange("acceptTerms", e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded accent-purple-600"
              aria-describedby="acceptTerms-error"
            />
            <span className="text-xs leading-5 text-text-3">
              I have read and accept the{" "}
              <Link
                href="/terms"
                className="font-medium text-accent underline decoration-accent/40 underline-offset-4 transition hover:text-text-1"
              >
                Terms of Service
              </Link>{" "}
              (v{TERMS_VERSION}) and the{" "}
              <Link
                href="/privacy"
                className="font-medium text-accent underline decoration-accent/40 underline-offset-4 transition hover:text-text-1"
              >
                Privacy Policy
              </Link>{" "}
              (v{PRIVACY_VERSION}) on behalf of this school, and confirm I am
              authorised to bind it. Payments are final sale — see the{" "}
              <Link
                href="/refund-policy"
                className="font-medium text-accent underline decoration-accent/40 underline-offset-4 transition hover:text-text-1"
              >
                Refund Policy
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms && (
            <p id="acceptTerms-error" role="alert" className="mt-2 pl-8 text-xs text-danger">
              {errors.acceptTerms}
            </p>
          )}
        </div>

        <Button
          className="mt-4 w-full gap-2 rounded-full bg-red-600 font-semibold text-white shadow-[0_0_28px_rgba(239,68,68,0.35)] hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={payDisabled}
          aria-describedby={payHint ? "pay-hint" : undefined}
          size="lg"
          onClick={startFlutterwaveCheckout}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Opening secure checkout…
            </>
          ) : waiverBypass ? (
            // No charge, so no Flutterwave modal to open. Saying "Pay with
            // Flutterwave" on a ₦0 bill invited a payment attempt the gateway
            // cannot accept.
            <>Create portal — fully covered</>
          ) : (
            <>Pay {formatNaira(orderTotal)} with Flutterwave</>
          )}
        </Button>

        {payHint && (
          <p id="pay-hint" role="status" className="mt-2 text-center text-xs leading-5 text-text-3">
            {payHint}
          </p>
        )}

        {isLocalhost && (
          <Button
            variant="outline"
            className="mt-2 w-full gap-2 rounded-full"
              disabled={isSubmitting || orderCount < MIN_REGISTRATION_STUDENTS}
            onClick={useDevMockPayment}
          >
            Dev Mock Payment (localhost only)
          </Button>
        )}

        {/* Recovery affordance. A customer whose Flutterwave modal hung must
            never be told "nothing was created" and left with no way forward —
            they may already have been charged. */}
        {(pendingRef || txRef) && (
          <div className="mt-3 rounded-2xl border border-warning/30 bg-warning-soft p-3 text-xs leading-5 text-warning">
            <p className="font-medium text-warning">Already paid?</p>
            <p className="mt-1 text-warning/70">
              Reference{" "}
              <span className="font-mono">
                {(pendingRef || txRef || "").slice(0, 34)}
              </span>
              . If you completed a payment but did not get a portal, check its
              status — this never charges you again.
            </p>
            <Button
              variant="outline"
              className="mt-2 w-full gap-2 rounded-full"
              disabled={isCheckingPayment}
              onClick={checkPaymentStatus}
            >
              {isCheckingPayment ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                </>
              ) : (
                "Check payment status"
              )}
            </Button>
          </div>
        )}

        <button
          type="button"
          onClick={() => goBack(2)}
          className="mt-3 w-full text-center text-xs font-medium text-text-3 underline decoration-accent/30 underline-offset-4 hover:text-text-2"
        >
          ← Back to account security
        </button>
        <p className="mt-3 text-center text-xs leading-5 text-text-3">
          No database or portal is created until payment succeeds.
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Step 1 — school details
  // -------------------------------------------------------------------------
  if (currentStep === 1) {
    return (
      <form onSubmit={handleStep1Next} noValidate className="space-y-5">
        {renderStepIndicator()}
        <h3 className="text-lg font-bold tracking-tight text-text-1">School details</h3>

        {/* School Name */}
        <Input
          label="School Name"
        name="schoolName"
        placeholder="Victory High School"
        value={values.schoolName}
        onChange={(e) => handleChange("schoolName", e.target.value)}
        error={errors.schoolName}
        required
        autoComplete="organization"
        disabled={isSubmitting}
      />

      {/* Subdomain */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="input-subdomain" className="text-sm font-medium text-text-2">
          Subdomain <span className="text-danger">*</span>
        </label>
        <div className="flex">
          <input
            id="input-subdomain"
            name="subdomain"
            value={values.subdomain}
            onChange={(e) => handleChange("subdomain", e.target.value)}
            placeholder="vhs"
            required
            disabled={isSubmitting}
            className={`flex h-10 w-full rounded-l-xl border bg-surface-3 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${
              errors.subdomain
                ? "border-danger/60 focus-visible:ring-danger focus-visible:border-danger"
                : "border-line-1 focus-visible:ring-accent focus-visible:border-accent"
            }`}
          />
          <span className="inline-flex items-center rounded-r-xl border border-l-0 border-line-1 bg-surface-3 px-3 text-sm font-medium text-text-3">
            .{baseDomain}
          </span>
        </div>
        {errors.subdomain ? (
          <p className="text-xs text-danger">{errors.subdomain}</p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-text-3">
            <Globe className="h-3 w-3" />
            Your school will be live at:{" "}
            <span
              className={`font-mono font-medium ${isPreviewCustom ? "text-success" : "text-text-3"}`}
            >
              {previewDomain}
            </span>
            {checkingSubdomain && <span className="text-text-3">• checking…</span>}
            {!checkingSubdomain && subdomainTaken && (
              <span className="font-medium text-warning">• just taken — pick another</span>
            )}
          </p>
        )}
      </div>

      {/* Admin Email */}
        <Input
          label="Admin Email"
          name="adminEmail"
          type="email"
          placeholder="admin@victoryhigh.edu.ng"
          value={values.adminEmail}
          onChange={(e) => handleChange("adminEmail", e.target.value)}
          error={errors.adminEmail}
          required
          autoComplete="email"
          disabled={isSubmitting}
        />

        {/* Email verification — proves inbox ownership before payment.
            Deliberately NOT a gate on leaving Step 1: if Brevo is
            misconfigured the user would be stranded with no recourse, so
            this only disables the Pay button in Step 3 (with an explanation). */}
        <div className="rounded-2xl border border-line-2 bg-surface-2 p-4">
          {isEmailVerified ? (
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <MailCheck className="h-4 w-4 text-success" aria-hidden />
              Email verified — you can continue
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-text-2">
                <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
                Verify this email
              </p>
              <p className="mt-1 text-xs leading-5 text-text-3">
                We&apos;ll email a 6-digit code. Required before you can pay.
              </p>

              <div className="mt-3 flex flex-col gap-2">
                {otpSent ? (
                  <>
                    <div className="flex gap-2">
                      <input
                        id="input-otp"
                        name="otp"
                        value={otpCode}
                        onChange={(e) => {
                          // Digits only, capped at 6 — matches the backend's
                          // ^[0-9]{6}$ so a typo is caught before a round trip.
                          const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
                          setOtpCode(digits);
                          if (errors.adminEmail) setOtpError(null);
                        }}
                        placeholder="000000"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        aria-label="6-digit verification code"
                        aria-describedby={otpError ? "otp-error" : undefined}
                        disabled={otpVerifying}
                        className={`h-10 w-full rounded-xl border bg-surface-3 px-3 py-2 font-mono text-sm tracking-[0.4em] text-text-1 placeholder:tracking-[0.4em] placeholder:text-text-3 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${
                          otpError
                            ? "border-danger/60 focus-visible:ring-danger"
                            : "border-line-1 focus-visible:ring-accent focus-visible:border-accent"
                        }`}
                      />
                      <Button
                        className="shrink-0 gap-1.5 rounded-full font-semibold text-text-1"
                        disabled={otpVerifying}
                        onClick={verifyOtp}
                      >
                        {otpVerifying ? <Loader2 className="animate-spin" /> : null}
                        Verify
                      </Button>
                    </div>

                    <button
                      type="button"
                      onClick={sendOtp}
                      disabled={otpSending || otpResendIn > 0}
                      className="self-start text-xs font-medium text-text-3 underline decoration-accent/30 underline-offset-4 hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                    >
                      {otpSending
                        ? "Sending…"
                        : otpResendIn > 0
                          ? `Resend code in ${otpResendIn}s`
                          : "Send a new code"}
                    </button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full gap-2 rounded-full"
                    disabled={otpSending}
                    onClick={sendOtp}
                  >
                    {otpSending ? <Loader2 className="animate-spin" /> : null}
                    Send verification code
                  </Button>
                )}
              </div>
            </>
          )}

          {otpError && (
            <p id="otp-error" role="alert" className="mt-2 text-xs leading-5 text-danger">
              {otpError}
            </p>
          )}
        </div>

        {/* Global error (handles 409 etc) */}
        {globalError && (
          <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span>{globalError}</span>
          </div>
        )}

        <Button
          type="submit"
          className="w-full gap-2 rounded-full bg-accent font-semibold text-accent-fg shadow-[0_0_28px_rgba(147,51,234,0.40)] hover:bg-accent-hover hover:shadow-[0_0_40px_rgba(147,51,234,0.55)] disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={isSubmitting}
          size="lg"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking availability…
            </>
          ) : (
            <>Continue to account security</>
          )}
        </Button>

        {isSubmitting && (
          <p className="text-center text-xs text-text-3">
            Verifying your subdomain is still available…
          </p>
        )}

        <p className="text-center text-xs leading-5 text-text-3">
          Your portal at{" "}
          <span className="font-mono font-medium text-text-2">{previewDomain}</span> will be
          created securely.
        </p>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Step 2 — account security
  // -------------------------------------------------------------------------
  if (currentStep === 2) {
    return (
      <form onSubmit={handleStep2Next} noValidate className="space-y-5">
        {renderStepIndicator()}
        <h3 className="text-lg font-bold tracking-tight text-text-1">Account security</h3>

        {/* Admin Name — used for the Flutterwave customer name and the welcome
            email. Previously derived from the email prefix, which read as
            noise on a bank statement. */}
        <Input
          label="Admin Name"
          name="adminName"
          placeholder="Dr. Jane Obi"
          value={values.adminName}
          onChange={(e) => handleChange("adminName", e.target.value)}
          error={errors.adminName}
          required
          autoComplete="name"
          disabled={isSubmitting}
        />

        {/* Password fields with visibility toggles. Two independent flags —
            revealing one must not reveal the other. */}
        <PasswordField
          id="input-adminPassword"
          label="Admin Password"
          name="adminPassword"
          placeholder="Minimum 8 characters"
          value={values.adminPassword}
          onChange={(v) => handleChange("adminPassword", v)}
          error={errors.adminPassword}
          autoComplete="new-password"
          visible={showPassword}
          onToggle={() => setShowPassword((v) => !v)}
          disabled={isSubmitting}
        />
        <PasswordField
          id="input-adminPasswordConfirm"
          label="Confirm Admin Password"
          name="adminPasswordConfirm"
          placeholder="Repeat your password"
          value={values.adminPasswordConfirm}
          onChange={(v) => handleChange("adminPasswordConfirm", v)}
          error={errors.adminPasswordConfirm}
          autoComplete="new-password"
          visible={showConfirmPassword}
          onToggle={() => setShowConfirmPassword((v) => !v)}
          disabled={isSubmitting}
        />

        {/* Student Count — capacity estimate + quick packages */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick capacity packages">
          {[100, 250, 500, 1000].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleChange("studentCount", String(n))}
              aria-pressed={values.studentCount.trim() === String(n)}
              disabled={isSubmitting}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-xs font-medium transition disabled:opacity-50 ${
                values.studentCount.trim() === String(n)
                  ? "border-accent bg-accent text-accent-fg shadow-[0_0_16px_rgba(147,51,234,0.4)]"
                  : "border-line-2 bg-surface-2 text-text-2 hover:border-line-1 hover:text-text-1"
              }`}
            >
              {n} students
            </button>
          ))}
        </div>
      </div>
      <Input
        label="Estimated Student Count"
        name="studentCount"
        type="text"
        inputMode="numeric"
        placeholder="e.g. 150"
        value={values.studentCount}
        onChange={(e) => handleChange("studentCount", e.target.value)}
        error={errors.studentCount}
        required
        disabled={isSubmitting}
      />

      {/* ── Superadmin waiver code ──────────────────────────────────────
          Optional and collapsed by default: almost every school registering
          has no code, and a required-looking field for an uncommon thing
          reads as a mistake.

          The preview here is DISPLAY ONLY. The hold route re-validates against
          the token's own row and returns the authoritative split, and the
          backend recomputes that again when it burns the token. Nothing this
          component displays can change what anyone is charged. */}
      <div className="mt-2 rounded-2xl border border-success/30 bg-success-soft p-4">
        <button
          type="button"
          onClick={() => setWaiverOpen((v) => !v)}
          disabled={isSubmitting}
          aria-expanded={waiverOpen}
          className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-success">
            <Ticket className="h-4 w-4" />
            Have a waiver code?
          </span>
          <ChevronDown
            className={`h-4 w-4 text-success transition ${waiverOpen ? "rotate-180" : ""}`}
          />
        </button>

        {waiverOpen && (
          <div className="mt-3 flex flex-col gap-3">
            <Input
              label="Waiver code"
              name="waiverToken"
              type="text"
              autoComplete="off"
              // A waiver code is base64url: case-SIGNIFICANT. Verified against
              // the stored SHA-256 — uppercasing this input altered 10 of the
              // token's 27 characters, so the school was told their code was
              // invalid for one they had been given correctly and pasted intact.
              //
              // autoCapitalize/autoCorrect are the mobile half of the same bug
              // and are easy to miss: iOS Safari auto-capitalises the first
              // letter of a text input by default, which would turn "...qjy..."
              // into "...Qjy..." with the user doing nothing at all. These are
              // also the attributes that stop the browser's password manager
              // offering to "save" what it thinks is a login.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="RW-…"
              value={waiverToken}
              // Keep the value EXACTLY as typed or pasted.
              onChange={(e) => setWaiverToken(e.target.value)}
              error={waiverError ?? undefined}
              disabled={isSubmitting}
            />

            {waiverPreview && (
              <div
                className={`rounded-xl border p-3 text-xs ${
                  waiverPreview.bypass_gateway
                    ? "border-success/30 bg-success-soft text-success"
                    : "border-line-1 bg-surface-2 text-text-2"
                }`}
              >
                <p className="font-medium">
                  {waiverPreview.discount_percentage}% off{" "}
                  {waiverPreview.slot_allowance} slot
                  {waiverPreview.slot_allowance === 1 ? "" : "s"}
                </p>
                <dl className="mt-2 space-y-1">
                  <div className="flex justify-between">
                    <dt className="text-success/60">Covered</dt>
                    <dd>
                      {waiverPreview.waived_slots} of {orderCount} slots (
                      {formatNaira(waiverPreview.waived_ngn)} off)
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-success/60">You pay</dt>
                    <dd className="font-semibold">{formatNaira(waiverPreview.charged_ngn)}</dd>
                  </div>
                </dl>
                {waiverPreview.bypass_gateway && (
                  <p className="mt-2 text-success">
                    Fully covered — no payment will be taken.
                  </p>
                )}
                {waiverPreview.forfeited_slots > 0 && (
                  <p className="mt-2 font-medium text-warning">
                    Use it or lose it: {waiverPreview.forfeited_slots} slot
                    {waiverPreview.forfeited_slots === 1 ? "" : "s"} of this code will be
                    permanently forfeited and cannot be recovered.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Free-credit notice.
          Gated on the platform toggle FIRST, then the volume threshold — and it
          UNMOUNTS rather than swapping copy. That matters: the negative branch
          reads "Free publishing credits start at 500 students", which
          advertises the offer just as effectively as the positive one does.
          Hiding only the qualifying branch would leave every sub-500 school
          being told about an offer the superadmin has switched off. */}
      {freeCreditsEnabled ? (
        <div
          className={
            qualifiesFreeCredits
              ? "rounded-xl border border-success/30 bg-success-soft p-3"
              : "rounded-xl border border-line-2 bg-surface-2 p-3"
          }
        >
          <p
            className={
              qualifiesFreeCredits
                ? "flex items-center gap-2 text-xs font-medium text-success"
                : "flex items-center gap-2 text-xs font-medium text-text-2"
            }
          >
            <Sparkles className={qualifiesFreeCredits ? "h-3.5 w-3.5 text-success" : "h-3.5 w-3.5 text-text-3"} />
            {qualifiesFreeCredits
              ? `Includes ${FREE_CREDIT_GRANT} free publishing credits at launch`
              : "Publishing credits are not included at this size"}
          </p>
          <p
            className={
              qualifiesFreeCredits
                ? "mt-1 text-xs leading-5 text-success/60"
                : "mt-1 text-xs leading-5 text-text-3"
            }
          >
            {qualifiesFreeCredits
              ? "Enough to publish a full class. You pay once for student slots now — top up publishing credits anytime from your portal."
              : `Free publishing credits start at ${FREE_CREDIT_MIN_STUDENTS} students. Top up anytime from your portal — credits never expire.`}
          </p>
        </div>
      ) : null}

      {/* Subtle helper card */}
      <div className="rounded-xl border border-line-2 bg-surface-2 p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-text-2">
          <Users className="h-3.5 w-3.5 text-accent" />
          Provisioning preview
        </p>
        <p className="mt-1 text-xs leading-5 text-text-3">
          School:{" "}
          <span className="font-medium text-text-2">
            {values.schoolName.trim() || "—"}
          </span>{" "}
          • Students:{" "}
          <span className="font-medium text-text-2">
            {values.studentCount.trim() || "—"}
          </span>
        </p>
      </div>

      {/* Global error (handles 409 etc) */}
        {globalError && (
          <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span>{globalError}</span>
          </div>
        )}

        {/* Submit — Step 2 validates only; payment happens in Step 3. Not
            gated on email verification: the user should be able to review
            their order even if mail is broken. */}
        <Button
          type="submit"
          className="w-full gap-2 rounded-full bg-accent font-semibold text-accent-fg shadow-[0_0_28px_rgba(147,51,234,0.40)] hover:bg-accent-hover hover:shadow-[0_0_40px_rgba(147,51,234,0.55)] disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={isSubmitting}
          size="lg"
        >
          Review &amp; continue to payment
        </Button>

        <button
          type="button"
          onClick={() => goBack(1)}
          className="w-full text-center text-xs font-medium text-text-3 underline decoration-accent/30 underline-offset-4 hover:text-text-2"
        >
          ← Back to school details
        </button>
      </form>
    );
  }

  // Unreachable: currentStep is 1, 2, or 3, and all three return above.
  return null;
}
