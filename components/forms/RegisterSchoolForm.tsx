"use client";

import * as React from "react";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Users,
  Sparkles,
  ExternalLink,
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
} from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Phase 1 – RegisterSchoolForm (4 fields, direct provision, no Flutterwave)
// ---------------------------------------------------------------------------

interface FormValues {
  schoolName: string;
  subdomain: string;
  adminEmail: string;
  adminPassword: string;
  adminPasswordConfirm: string;
  studentCount: string; // keep string for controlled input
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
    adminPassword: "",
    adminPasswordConfirm: "",
    studentCount: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkingSubdomain, setCheckingSubdomain] = useState(false);
  const [subdomainTaken, setSubdomainTaken] = useState(false);
  // Pay-first 3-step wizard: 1 = details, 2 = checkout, 3 = provisioning.
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [transactionId, setTransactionId] = useState<string | null>(null);
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
  // Validation
  // -------------------------------------------------------------------------
  function validate(): boolean {
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

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  function handleChange<K extends keyof FormValues>(field: K, value: string) {
    if (field === "subdomain") value = sanitizeSlug(value);
    if (field === "studentCount") value = value.replace(/[^0-9]/g, "");
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const c = { ...prev };
        delete c[field];
        return c;
      });
    }
    if (globalError) setGlobalError(null);
  }

  // Step 1 submit: local validation + availability ONLY. Never touches
  // the provision API — payment happens in Step 2.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError(null);

    if (!validate()) return;

    // Sniped since the last keystroke: re-verify live before advancing to payment.
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

  // Live order total for Step 2 summary (tiered slots).
  const orderCount = useMemo(() => {
    const n = parseInt(values.studentCount.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [values.studentCount]);
  const orderTier = useMemo(() => getPricingTier(orderCount), [orderCount]);
  const orderTotal = useMemo(() => calculateTieredTotal(orderCount), [orderCount]);

  function startFlutterwaveCheckout() {
    setGlobalError(null);
    const publicKey = getFlutterwavePublicKey();
    const ref = generateTxRef(values.subdomain.trim() || "school");
    const customerEmail = values.adminEmail.trim();
    const customerName = customerEmail.split("@")[0] || values.schoolName.trim();

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
          meta: {
            schoolName: values.schoolName.trim(),
            subdomain: values.subdomain.trim(),
            adminEmail: customerEmail,
            adminPassword: values.adminPassword,
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
      adminPassword: values.adminPassword,
      studentCount: parseInt(values.studentCount.trim(), 10),
      initial_credits: 30,
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
            if (data.fieldErrors.adminPassword) mapped.adminPassword = data.fieldErrors.adminPassword;
            if (data.fieldErrors.studentCount) mapped.studentCount = data.fieldErrors.studentCount;
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
    setValues({ schoolName: "", subdomain: "", adminEmail: "", adminPassword: "", adminPasswordConfirm: "", studentCount: "" });
    setErrors({});
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
    { n: 2, label: "Checkout" },
    { n: 3, label: "Portal ready" },
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
  // Step 3 — provisioning / paid-conflict (before the step-1 form)
  // -------------------------------------------------------------------------
  if (currentStep === 3 && !successData) {
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
  // Step 2 — checkout summary
  // -------------------------------------------------------------------------
  if (currentStep === 2) {
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname.includes("localhost") || window.location.hostname.includes("127.0.0.1"));
    return (
      <div>
        {renderStepIndicator()}
        <h3 className="text-lg font-bold tracking-tight text-white">Order summary</h3>
        <div className="mt-4 rounded-2xl border border-purple-500/15 bg-purple-900/10 p-4 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-purple-200/60">School</span>
            <span className="font-medium text-white">{values.schoolName.trim() || "—"}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-purple-200/60">Subdomain</span>
            <span className="font-mono font-medium text-white">{previewDomain}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-purple-200/60">Admin</span>
            <span className="font-medium text-white">{values.adminEmail.trim() || "—"}</span>
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
          <p className="mt-1 text-xs text-purple-300/50">Includes 30 free publishing credits at launch.</p>
        </div>

        {globalError && (
          <div className="mt-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{globalError}</span>
          </div>
        )}

        <Button
          className="mt-4 w-full gap-2 rounded-full bg-red-600 font-semibold text-white shadow-[0_0_28px_rgba(239,68,68,0.35)] hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={isSubmitting || orderCount <= 0}
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
          onClick={() => {
            setGlobalError(null);
            setCurrentStep(1);
          }}
          className="mt-3 w-full text-center text-xs font-medium text-purple-300/60 underline decoration-purple-500/30 underline-offset-4 hover:text-purple-200"
        >
          ← Back to school details
        </button>
        <p className="mt-3 text-center text-xs leading-5 text-purple-300/40">
          No database or portal is created until payment succeeds.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {renderStepIndicator()}
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

      {/* Admin Password — Phase 2 admin portal credential */}
      <Input
        label="Admin Password"
        name="adminPassword"
        type="password"
        placeholder="Minimum 8 characters"
        value={values.adminPassword}
        onChange={(e) => handleChange("adminPassword", e.target.value)}
        error={errors.adminPassword}
        required
        autoComplete="new-password"
        disabled={isSubmitting}
      />
      <Input
        label="Confirm Admin Password"
        name="adminPasswordConfirm"
        type="password"
        placeholder="Repeat your password"
        value={values.adminPasswordConfirm}
        onChange={(e) => handleChange("adminPasswordConfirm", e.target.value)}
        error={errors.adminPasswordConfirm}
        required
        autoComplete="new-password"
        disabled={isSubmitting}
      />

      {/* Student Count — Step 2: capacity estimate + quick packages */}
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

      {/* Trial grant notice — 30 free credits included with every paid portal */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-emerald-200">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          Includes 30 free trial credits at launch
        </p>
        <p className="mt-1 text-xs leading-5 text-emerald-100/60">
          Enough to publish a full class. You pay once for student slots now — top up publishing credits anytime from your portal.
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

      <p className="text-center text-xs leading-5 text-purple-300/40">
        By continuing, you agree to our Terms and Privacy Policy. Your portal at{" "}
        <span className="font-mono font-medium text-purple-200">{previewDomain}</span> will be created securely.
      </p>
    </form>
  );
}
