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
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  getFlutterwavePublicKey,
  loadFlutterwaveScript,
  initiateFlutterwaveInlinePayment,
  generateTxRef,
} from "@/lib/flutterwave";
import {
  getPricingTier,
  calculateTieredTotal,
  formatNaira,
  FREE_CREDIT_MIN_STUDENTS,
  FREE_CREDIT_GRANT,
} from "@/lib/pricing";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/constants";

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

export function RegisterSchoolForm() {
  const [values, setValues] = useState<FormValues>({
    schoolName: "",
    subdomain: "",
    adminEmail: "",
    adminName: "",
    adminPassword: "",
    adminPasswordConfirm: "",
    studentCount: "",
    acceptTerms: false,
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkingSubdomain, setCheckingSubdomain] = useState(false);
  const [subdomainTaken, setSubdomainTaken] = useState(false);
  // 1 = school details, 2 = account security, 3 = review & payment.
  // Step 3 also renders the post-payment provisioning/provisioned states, which
  // is why `successData` (not the step number) is the terminal condition.
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [transactionId, setTransactionId] = useState<string | null>(null);

  // --- Email OTP (inbox ownership proof, Step 1) --------------------------
  // isEmailVerified gates the Pay button, never navigation: a user with a
  // broken mail path can still reach review and see exactly what is missing.
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpResendIn, setOtpResendIn] = useState(0);

  // Password visibility toggles (Step 2). Two independent fields — revealing
  // one must not reveal the other, so they are never combined.
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [txRef, setTxRef] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [paidConflict, setPaidConflict] = useState<{ transactionId: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const provisionFired = useRef(false);
  const [successData, setSuccessData] = useState<{
    deployedUrl: string;
    domain: string;
    subdomain: string;
    schoolName: string;
  } | null>(null);

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
  // is never blocked by an error on a field they cannot see yet. Step 3 runs
  // all three so nothing invalid can reach the payment provider.
  // -------------------------------------------------------------------------
  function validateSchool(): Partial<FormValues> {
    const next: Partial<FormValues> = {};

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

  function validateSecurity(): Partial<FormValues> {
    const next: Partial<FormValues> = {};

    const name = values.adminName.trim();
    if (!name) {
      next.adminName = "Admin name is required";
    } else if (name.length < 2) {
      next.adminName = "Admin name must be at least 2 characters";
    } else if (name.length > 120) {
      next.adminName = "Admin name must be at most 120 characters";
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
    } else if (count <= 0) {
      next.studentCount = "Must be greater than 0";
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
  }

  /** Countdown ticker for the resend button. */
  useEffect(() => {
    if (otpResendIn <= 0) return;
    const t = setTimeout(() => setOtpResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [otpResendIn]);

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
      setOtpResendIn(OTP_RESEND_COOLDOWN_S);
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

  // Step 1 exit: validate, then re-check subdomain availability live.
  // Never touches the provision API — payment happens in Step 3.
  async function handleStep1Next(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError(null);

    if (!validateStep1()) return;

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
  // Copy-only mirror of the server's free-credit policy. The server remains the
  // sole authority — this just keeps the registration copy honest instead of
  // promising credits that may be withheld.
  const qualifiesFreeCredits = orderCount >= FREE_CREDIT_MIN_STUDENTS;

  function startFlutterwaveCheckout() {
    setGlobalError(null);
    const publicKey = getFlutterwavePublicKey();
    const ref = generateTxRef(values.subdomain.trim() || "school");
    const customerEmail = values.adminEmail.trim();
    // Admin Name is now collected in Step 2. The email prefix was a poor
    // fallback ("j.obi" reads as noise on a bank statement), so it is only
    // used if the field is somehow empty.
    const customerName =
      values.adminName.trim() || customerEmail.split("@")[0] || values.schoolName.trim();

    const openModal = () => {
      initiateFlutterwaveInlinePayment(
        {
          publicKey: publicKey || "FLWPUBK_TEST-dummy-key-for-demo-do-not-use-in-prod",
          txRef: ref,
          amount: orderTotal,
          currency: "NGN",
          customer: { email: customerEmail, name: customerName },
          customizations: {
            title: `ResultApp • ${values.schoolName.trim()}`,
            description: `${orderCount} slots × ${formatNaira(orderTier.pricePerStudent)} = ${formatNaira(orderTotal)}`,
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
            setTransactionId(String(res.transaction_id));
            setTxRef(res.tx_ref || ref);
            setPaidConflict(null);
            setCurrentStep(3);
            window.scrollTo({ top: 0, behavior: "smooth" });
          },
          onClose: () => {
            setGlobalError("Payment was cancelled — no charge made, nothing was created. You can retry anytime.");
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
    loadFlutterwaveScript()
      .then(openModal)
      .catch((err) => {
        console.error(err);
        setGlobalError("Could not load Flutterwave checkout. Check your connection and try again.");
      })
      .finally(() => setIsSubmitting(false));
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
    if (currentStep !== 3 || !transactionId || provisionFired.current || successData) return;
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
      transaction_id: transactionId,
      tx_ref: txRef,
    };

    setProvisioning(true);
    setGlobalError(null);

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
          transaction_id?: string;
          fieldErrors?: Record<string, string>;
          deployed_url?: string;
          deployedUrl?: string;
          domain?: string;
          subdomain?: string;
          school_name?: string;
          details?: string;
        };

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
    setRetryNonce((n) => n + 1);
  }

  function resetWizard() {
    provisionFired.current = false;
    setRetryNonce(0);
    setSuccessData(null);
    setTransactionId(null);
    setTxRef(null);
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
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/20">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>

        <h3 className="mt-6 text-2xl font-bold tracking-tight text-white">School provisioned!</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-purple-200/60">
          Your school portal is live. Please check your email at{" "}
          <span className="font-medium text-white">{values.adminEmail}</span> for login credentials and next steps.
        </p>

        <a
          href={successData.deployedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-purple-600 px-5 py-2.5 font-mono text-sm font-semibold text-white shadow-[0_0_20px_rgba(147,51,234,0.35)] transition hover:bg-purple-500"
        >
          <Globe className="h-4 w-4" />
          {successData.domain}
          <ExternalLink className="h-3.5 w-3.5 opacity-70" />
        </a>

        <div className="mt-6 w-full rounded-2xl border border-purple-500/15 bg-purple-900/10 p-4 text-left backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Sparkles className="h-4 w-4 text-purple-400" />
            What happens next?
          </div>
          <ul className="mt-3 space-y-2 text-sm text-purple-200/70">
            <li>• Portal <span className="font-mono text-purple-200">{successData.domain}</span> is deploying (30–60s)</li>
            <li>• Admin login sent to <span className="text-white">{values.adminEmail}</span></li>
            <li>• You can sign in as soon as the portal is ready</li>
          </ul>
        </div>

        <Button
          className="mt-6 w-full rounded-full bg-white font-semibold text-[#0B0514] hover:bg-zinc-100"
          size="lg"
          onClick={() => (window.location.href = successData.deployedUrl)}
        >
          Go to your portal
        </Button>

        <button
          type="button"
          onClick={resetWizard}
          className="mt-3 text-xs font-medium text-purple-300/60 underline decoration-purple-500/30 underline-offset-4 hover:text-purple-200"
        >
          Register another school
        </button>

        <p className="mt-3 text-xs text-purple-300/40">
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
              {i > 0 && <span className="h-px w-6 bg-purple-500/20 sm:w-8" />}
              <span
                className={
                  active
                    ? "flex h-7 w-7 items-center justify-center rounded-full bg-purple-600 text-white shadow-[0_0_14px_rgba(147,51,234,0.45)] ring-1 ring-purple-500/30"
                    : done
                      ? "flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white"
                      : "flex h-7 w-7 items-center justify-center rounded-full border border-purple-500/20 bg-purple-950/30 text-purple-300"
                }
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : s.n}
              </span>
              <span className={active ? "font-medium text-white" : done ? "text-emerald-300/80" : "text-purple-300/60"}>
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
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/20">
              <AlertCircle className="h-8 w-8 text-amber-400" />
            </div>
            <h3 className="mt-6 text-2xl font-bold tracking-tight text-white">Subdomain just taken</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-purple-200/60">
              Your payment went through, but <span className="font-mono font-medium text-white">{values.subdomain.trim()}.resultapp.org</span> was
              registered by someone else first. Do not pay again — contact{" "}
              <span className="font-medium text-white">support@resultapp.org</span> with reference{" "}
              <span className="font-mono font-medium text-white">{paidConflict.transactionId}</span> for
              a manual setup or refund.
            </p>
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="mt-6 w-full rounded-full bg-purple-600 py-3 font-semibold text-white hover:bg-purple-500"
            >
              Choose a different subdomain
            </button>
          </div>
        ) : provisioning ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-purple-400" />
            <h3 className="mt-6 text-2xl font-bold tracking-tight text-white">Creating your portal…</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-purple-200/60">
              Payment confirmed. Provisioning your database, site, and admin account — this may take a minute.
              Please keep this tab open.
            </p>
          </div>
        ) : globalError ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/20">
              <AlertCircle className="h-8 w-8 text-red-400" />
            </div>
            <h3 className="mt-6 text-2xl font-bold tracking-tight text-white">Provisioning failed</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-purple-200/60">{globalError}</p>
            <p className="mt-2 max-w-md text-xs leading-5 text-purple-300/50">
              Your payment is safe — retrying reuses transaction {transactionId} and never double-provisions.
            </p>
            <div className="mt-6 flex w-full flex-col gap-2">
              <Button
                className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white hover:bg-purple-500"
                size="lg"
                onClick={retryProvision}
              >
                <Loader2 className="h-4 w-4" /> Retry provisioning
              </Button>
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="text-xs font-medium text-purple-300/60 underline decoration-purple-500/30 underline-offset-4 hover:text-purple-200"
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
    const payDisabled = isSubmitting || orderCount <= 0 || payBlockedByTerms || payBlockedByEmail;
    const payHint = payBlockedByTerms
      ? "Accept the Terms of Service and Privacy Policy to continue."
      : payBlockedByEmail
        ? "Verify your admin email to unlock payment."
        : orderCount <= 0
          ? "Enter your estimated student count to see a total."
          : null;

    return (
      <div>
        {renderStepIndicator()}
        <h3 className="text-lg font-bold tracking-tight text-white">Review &amp; pay</h3>
<div className="mt-4 rounded-2xl border border-purple-500/15 bg-purple-900/10 p-4 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-purple-200/60">Admin</span>
            <span className="font-medium text-white">
              {values.adminName.trim() || "—"}
              {isEmailVerified && (
                <span className="ml-1.5 inline-flex align-middle text-emerald-300" title="Email verified">
                  <MailCheck className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">email verified</span>
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-purple-200/60">Email</span>
            <span className="font-medium text-white">{values.adminEmail.trim() || "—"}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-purple-200/60">Subdomain</span>
            <span className="font-mono font-medium text-white">{previewDomain}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-purple-200/60">Student slots</span>
            <span className="font-medium text-white">
              {orderCount} × {formatNaira(orderTier.pricePerStudent)}
              {orderTier.badge ? <span className="ml-2 text-xs text-emerald-300">{orderTier.badge}</span> : null}
            </span>
          </div>
          <div className="my-2 border-t border-purple-500/10" />
          <div className="flex justify-between py-1 text-base font-bold text-white">
            <span>Total due</span>
            <span>{formatNaira(orderTotal)}</span>
          </div>
          <p className="mt-1 text-xs text-purple-300/50">
            {qualifiesFreeCredits
              ? `Includes ${FREE_CREDIT_GRANT} free publishing credits at launch.`
              : "Publishing credits are topped up separately from your portal."}
          </p>
        </div>

        {globalError && (
          <div className="mt-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
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
        <div className="mt-4 rounded-2xl border border-purple-500/20 bg-purple-900/[0.06] p-4">
          <label htmlFor="acceptTerms" className="flex cursor-pointer items-start gap-3">
            <input
              id="acceptTerms"
              type="checkbox"
              checked={values.acceptTerms}
              onChange={(e) => handleChange("acceptTerms", e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded accent-purple-600"
              aria-describedby="acceptTerms-error"
            />
            <span className="text-xs leading-5 text-purple-200/75">
              I have read and accept the{" "}
              <Link
                href="/terms"
                className="font-medium text-purple-300 underline decoration-purple-500/40 underline-offset-4 transition hover:text-white"
              >
                Terms of Service
              </Link>{" "}
              (v{TERMS_VERSION}) and the{" "}
              <Link
                href="/privacy"
                className="font-medium text-purple-300 underline decoration-purple-500/40 underline-offset-4 transition hover:text-white"
              >
                Privacy Policy
              </Link>{" "}
              (v{PRIVACY_VERSION}) on behalf of this school, and confirm I am
              authorised to bind it. Payments are final sale — see the{" "}
              <Link
                href="/refund-policy"
                className="font-medium text-purple-300 underline decoration-purple-500/40 underline-offset-4 transition hover:text-white"
              >
                Refund Policy
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms && (
            <p id="acceptTerms-error" role="alert" className="mt-2 pl-8 text-xs text-red-300">
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
          ) : (
            <>Pay {formatNaira(orderTotal)} with Flutterwave</>
          )}
        </Button>

        {payHint && (
          <p id="pay-hint" role="status" className="mt-2 text-center text-xs leading-5 text-purple-300/60">
            {payHint}
          </p>
        )}

        {isLocalhost && (
          <Button
            variant="outline"
            className="mt-2 w-full gap-2 rounded-full"
            disabled={isSubmitting || orderCount <= 0}
            onClick={useDevMockPayment}
          >
            Dev Mock Payment (localhost only)
          </Button>
        )}

        <button
          type="button"
          onClick={() => goBack(2)}
          className="mt-3 w-full text-center text-xs font-medium text-purple-300/60 underline decoration-purple-500/30 underline-offset-4 hover:text-purple-200"
        >
          ← Back to account security
        </button>
        <p className="mt-3 text-center text-xs leading-5 text-purple-300/40">
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
        <h3 className="text-lg font-bold tracking-tight text-white">School details</h3>

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
        <label htmlFor="input-subdomain" className="text-sm font-medium text-purple-100">
          Subdomain <span className="text-red-400">*</span>
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
            className={`flex h-10 w-full rounded-l-xl border bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${
              errors.subdomain
                ? "border-red-500/60 focus-visible:ring-red-500 focus-visible:border-red-500"
                : "border-purple-800/50 focus-visible:ring-purple-500 focus-visible:border-purple-500"
            }`}
          />
          <span className="inline-flex items-center rounded-r-xl border border-l-0 border-purple-800/50 bg-purple-950/30 px-3 text-sm font-medium text-purple-300/70">
            .{baseDomain}
          </span>
        </div>
        {errors.subdomain ? (
          <p className="text-xs text-red-400">{errors.subdomain}</p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-purple-300/50">
            <Globe className="h-3 w-3" />
            Your school will be live at:{" "}
            <span
              className={`font-mono font-medium ${isPreviewCustom ? "text-emerald-300" : "text-purple-200/60"}`}
            >
              {previewDomain}
            </span>
            {checkingSubdomain && <span className="text-purple-300/40">• checking…</span>}
            {!checkingSubdomain && subdomainTaken && (
              <span className="font-medium text-amber-300">• just taken — pick another</span>
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
        <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.06] p-4">
          {isEmailVerified ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
              <MailCheck className="h-4 w-4 text-emerald-400" aria-hidden />
              Email verified — you can continue
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-purple-100">
                <ShieldCheck className="h-4 w-4 text-purple-300" aria-hidden />
                Verify this email
              </p>
              <p className="mt-1 text-xs leading-5 text-purple-200/60">
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
                        className={`h-10 w-full rounded-xl border bg-purple-950/30 px-3 py-2 font-mono text-sm tracking-[0.4em] text-purple-50 placeholder:tracking-[0.4em] placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${
                          otpError
                            ? "border-red-500/60 focus-visible:ring-red-500"
                            : "border-purple-800/50 focus-visible:ring-purple-500 focus-visible:border-purple-500"
                        }`}
                      />
                      <Button
                        className="shrink-0 gap-1.5 rounded-full font-semibold text-white"
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
                      className="self-start text-xs font-medium text-purple-300/70 underline decoration-purple-500/30 underline-offset-4 hover:text-purple-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
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
            <p id="otp-error" role="alert" className="mt-2 text-xs leading-5 text-red-300">
              {otpError}
            </p>
          )}
        </div>

        {/* Global error (handles 409 etc) */}
        {globalError && (
          <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{globalError}</span>
          </div>
        )}

        <Button
          type="submit"
          className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.40)] hover:bg-purple-500 hover:shadow-[0_0_40px_rgba(147,51,234,0.55)] disabled:opacity-60 disabled:cursor-not-allowed"
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
          <p className="text-center text-xs text-purple-300/50">
            Verifying your subdomain is still available…
          </p>
        )}

        <p className="text-center text-xs leading-5 text-purple-300/40">
          Your portal at{" "}
          <span className="font-mono font-medium text-purple-200">{previewDomain}</span> will be
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
        <h3 className="text-lg font-bold tracking-tight text-white">Account security</h3>

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
                  ? "border-purple-500 bg-purple-600 text-white shadow-[0_0_16px_rgba(147,51,234,0.4)]"
                  : "border-purple-500/15 bg-purple-900/10 text-purple-200 hover:border-purple-500/30 hover:text-white"
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

      {/* Free-credit notice — conditional: only schools at/above the volume
          threshold receive the grant, and the server decides regardless. */}
      <div
        className={
          qualifiesFreeCredits
            ? "rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3"
            : "rounded-xl border border-purple-500/10 bg-purple-950/10 p-3"
        }
      >
        <p
          className={
            qualifiesFreeCredits
              ? "flex items-center gap-2 text-xs font-medium text-emerald-200"
              : "flex items-center gap-2 text-xs font-medium text-purple-200/80"
          }
        >
          <Sparkles className={qualifiesFreeCredits ? "h-3.5 w-3.5 text-emerald-400" : "h-3.5 w-3.5 text-purple-300/60"} />
          {qualifiesFreeCredits
            ? `Includes ${FREE_CREDIT_GRANT} free publishing credits at launch`
            : "Publishing credits are not included at this size"}
        </p>
        <p
          className={
            qualifiesFreeCredits
              ? "mt-1 text-xs leading-5 text-emerald-100/60"
              : "mt-1 text-xs leading-5 text-purple-300/50"
          }
        >
          {qualifiesFreeCredits
            ? "Enough to publish a full class. You pay once for student slots now — top up publishing credits anytime from your portal."
            : `Free publishing credits start at ${FREE_CREDIT_MIN_STUDENTS} students. Top up anytime from your portal — credits never expire.`}
        </p>
      </div>

      {/* Subtle helper card */}
      <div className="rounded-xl border border-purple-500/10 bg-purple-950/10 p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-purple-200/80">
          <Users className="h-3.5 w-3.5 text-purple-400" />
          Provisioning preview
        </p>
        <p className="mt-1 text-xs leading-5 text-purple-300/50">
          School:{" "}
          <span className="font-medium text-purple-200">
            {values.schoolName.trim() || "—"}
          </span>{" "}
          • Students:{" "}
          <span className="font-medium text-purple-200">
            {values.studentCount.trim() || "—"}
          </span>
        </p>
      </div>

      {/* Global error (handles 409 etc) */}
      {globalError && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Submit — Step 1 only validates; payment happens in Step 2 */}
      <Button
        type="submit"
        className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.40)] hover:bg-purple-500 hover:shadow-[0_0_40px_rgba(147,51,234,0.55)] disabled:opacity-60 disabled:cursor-not-allowed"
        disabled={isSubmitting}
        size="lg"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking availability…
          </>
        ) : (
          <>
            Continue to Payment
          </>
        )}
      </Button>

      {/* Loading helper text */}
      {isSubmitting && (
        <p className="text-center text-xs text-purple-300/50">
          Verifying your subdomain is still available…
        </p>
      )}

      {/* Consent — a real, required checkbox, not a passive notice. The
          accepted version strings are persisted server-side alongside the
          tenant row (LEGAL_REMEDIATION.md P0 item 4). components/ui/Input
          hardcodes text-input styling, so this is a raw checkbox. */}
      <div className="rounded-2xl border border-purple-500/20 bg-purple-900/[0.06] p-4">
        <label htmlFor="acceptTerms" className="flex cursor-pointer items-start gap-3">
          <input
            id="acceptTerms"
            type="checkbox"
            checked={values.acceptTerms}
            onChange={(e) => handleChange("acceptTerms", e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded accent-purple-600"
            aria-describedby="acceptTerms-error"
          />
          <span className="text-xs leading-5 text-purple-200/75">
            I have read and accept the{" "}
            <Link
              href="/terms"
              className="font-medium text-purple-300 underline decoration-purple-500/40 underline-offset-4 transition hover:text-white"
            >
              Terms of Service
            </Link>{" "}
            (v{TERMS_VERSION}) and the{" "}
            <Link
              href="/privacy"
              className="font-medium text-purple-300 underline decoration-purple-500/40 underline-offset-4 transition hover:text-white"
            >
              Privacy Policy
            </Link>{" "}
            (v{PRIVACY_VERSION}) on behalf of this school, and confirm I am
            authorised to bind it. Payments are final sale — see the{" "}
            <Link
              href="/refund-policy"
              className="font-medium text-purple-300 underline decoration-purple-500/40 underline-offset-4 transition hover:text-white"
            >
              Refund Policy
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms && (
          <p id="acceptTerms-error" role="alert" className="mt-2 pl-8 text-xs text-red-300">
            {errors.acceptTerms}
          </p>
        )}
      </div>

      <p className="text-center text-xs leading-5 text-purple-300/40">
        Your portal at{" "}
        <span className="font-mono font-medium text-purple-200">{previewDomain}</span> will be
        created securely.
      </p>
    </form>
  );
}
