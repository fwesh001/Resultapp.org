"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  CreditCard,
  Building2,
  Sparkles,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import LoadingOverlay from "@/components/ui/LoadingOverlay";
import {
  formatNaira,
  PRICE_PER_STUDENT,
  getFlutterwavePublicKey,
  loadFlutterwaveScript,
  initiateFlutterwaveInlinePayment,
  generateTxRef,
} from "@/lib/flutterwave";
import { getPricingTier, calculateTieredTotal, getSliderPct } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface FormValues {
  schoolName: string;
  subdomain: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  adminPasswordConfirm: string;
  phone: string;
  studentCount: string; // keep as string for controlled input
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
]);

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

function isValidPhone(phone: string): boolean {
  // Accept +234..., 0..., 11 digits Nigeria, or generic 10-15 digits
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SchoolRegistrationForm() {
  const [values, setValues] = useState<FormValues>({
    schoolName: "",
    subdomain: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
    adminPasswordConfirm: "",
    phone: "",
    studentCount: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [successData, setSuccessData] = useState<{
    subdomain: string;
    txRef: string;
    amount: number;
    studentCount: number;
    deployedUrl?: string;
    domain?: string;
  } | null>(null);

  // Derived pricing — tiered (shared with PricingCalculator)
  const studentCountNum = useMemo(() => {
    const n = parseInt(values.studentCount, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [values.studentCount]);

  const { pricePerStudent: unitPrice, badge, badgeStyle } = useMemo(() => getPricingTier(studentCountNum), [studentCountNum]);
  const totalAmount = useMemo(() => calculateTieredTotal(studentCountNum), [studentCountNum]);
  const sliderPct = useMemo(() => getSliderPct(studentCountNum), [studentCountNum]);
  const clampedSliderValue = Math.max(50, Math.min(2000, studentCountNum || 50));

  const subdomainPreview = values.subdomain
    ? `${values.subdomain}.resultapp.org`
    : "yourschool.resultapp.org";

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!values.schoolName.trim() || values.schoolName.trim().length < 3) {
      nextErrors.schoolName = "School name must be at least 3 characters";
    }

    const slug = values.subdomain.trim();
    if (!slug) {
      nextErrors.subdomain = "Subdomain is required";
    } else if (slug.length < 3) {
      nextErrors.subdomain = "At least 3 characters";
    } else if (!/^[a-z0-9-]+$/.test(slug)) {
      nextErrors.subdomain = "Only lowercase letters, numbers, and hyphens";
    } else if (slug.startsWith("-") || slug.endsWith("-")) {
      nextErrors.subdomain = "Cannot start or end with hyphen";
    } else if (RESERVED_SLUGS.has(slug)) {
      nextErrors.subdomain = "This subdomain is reserved";
    }

    if (!values.adminName.trim() || values.adminName.trim().split(/\s+/).length < 2) {
      // require at least first + last name
      if (!values.adminName.trim()) nextErrors.adminName = "Administrator name is required";
      else if (values.adminName.trim().length < 3) nextErrors.adminName = "Enter full name";
    }

    if (!values.adminEmail.trim()) {
      nextErrors.adminEmail = "Email is required";
    } else if (!isValidEmail(values.adminEmail.trim())) {
      nextErrors.adminEmail = "Enter a valid email address";
    }

    if (!values.adminPassword) {
      nextErrors.adminPassword = "Admin password is required";
    } else if (values.adminPassword.length < 8) {
      nextErrors.adminPassword = "Password must be at least 8 characters";
    } else if (values.adminPassword.length > 128) {
      nextErrors.adminPassword = "Password must be at most 128 characters";
    }
    if (values.adminPasswordConfirm !== values.adminPassword) {
      nextErrors.adminPasswordConfirm = "Passwords do not match";
    }

    if (!values.phone.trim()) {
      nextErrors.phone = "Phone number is required";
    } else if (!isValidPhone(values.phone.trim())) {
      nextErrors.phone = "Enter a valid phone (10–15 digits)";
    }

    const count = parseInt(values.studentCount, 10);
    if (!values.studentCount.trim()) {
      nextErrors.studentCount = "Required";
    } else if (!Number.isFinite(count) || count <= 0) {
      nextErrors.studentCount = "Must be at least 1";
    } else if (count > 10000) {
      nextErrors.studentCount = "Maximum 10,000 students";
    } else if (!Number.isInteger(count)) {
      nextErrors.studentCount = "Must be a whole number";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  function handleChange<K extends keyof FormValues>(field: K, value: string) {
    // Special handling for subdomain: sanitize live
    if (field === "subdomain") {
      value = sanitizeSlug(value);
    }
    // For studentCount: allow only digits
    if (field === "studentCount") {
      value = value.replace(/[^0-9]/g, "");
    }
    setValues((prev) => ({ ...prev, [field]: value }));
    // Clear field error on change
    if (errors[field]) {
      setErrors((prev) => {
        const c = { ...prev };
        delete c[field];
        return c;
      });
    }
    if (globalError) setGlobalError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError(null);

    if (!validate()) return;

    const count = parseInt(values.studentCount, 10);
    const { pricePerStudent: tierPrice } = getPricingTier(count);
    const amount = calculateTieredTotal(count);

    // Double-check amount
    if (amount <= 0) {
      setGlobalError("Invalid student count — cannot calculate payment.");
      return;
    }

    setIsSubmitting(true);

    const publicKey = getFlutterwavePublicKey();
    // For demo/development: allow fallback test key with warning
    const effectivePublicKey =
      publicKey || "FLWPUBK_TEST-dummy-key-for-demo-do-not-use-in-prod";

    const txRef = generateTxRef(values.subdomain);

    try {
      // Pre-load script to surface network errors before opening modal
      await loadFlutterwaveScript();
    } catch (err) {
      setIsSubmitting(false);
      setGlobalError(
        "Could not load Flutterwave checkout. Check your connection and try again."
      );
      console.error(err);
      return;
    }

    // If no real public key, show demo warning but still open modal if script loaded
    // In production you MUST set NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY
    if (!publicKey) {
      console.warn(
        "NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY not set — using dummy key. Set it in .env.local for real payments."
      );
    }

    initiateFlutterwaveInlinePayment(
      {
        publicKey: effectivePublicKey,
        txRef,
        amount,
        currency: "NGN",
        customer: {
          email: values.adminEmail.trim(),
          name: values.adminName.trim(),
          phone_number: values.phone.trim(),
        },
        customizations: {
          title: `ResultApp • ${values.schoolName.trim()}`,
          description: `${count} students × ${formatNaira(tierPrice)} = ${formatNaira(amount)}`,
          logo: "https://resultapp.org/logo.png",
        },
        meta: {
          schoolName: values.schoolName.trim(),
          subdomain: values.subdomain.trim(),
          adminName: values.adminName.trim(),
          adminPassword: values.adminPassword,
          studentCount: count,
          pricePerStudent: tierPrice,
          source: "registration_form",
        },
      },
      {
        onSuccess: async (response) => {
          // Flutterwave returns status; consider success if transaction_id exists or status indicates success
          const isSuccess =
            response.status === "successful" ||
            response.status === "completed" ||
            response.status === "success" ||
            !!response.transaction_id;

          if (!isSuccess) {
            setIsSubmitting(false);
            setGlobalError("Payment was not successful. Please try again.");
            return;
          }

          // Show provisioning state — now we will verify server-side and proxy to FastAPI
          setProvisioning(true);

          try {
            const provisionRes = await fetch("/api/provision", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transaction_id: response.transaction_id,
                tx_ref: response.tx_ref || txRef,
                schoolName: values.schoolName.trim(),
                subdomain: values.subdomain.trim(),
                adminEmail: values.adminEmail.trim(),
                adminName: values.adminName.trim(),
                adminPassword: values.adminPassword,
                phoneNumber: values.phone.trim(),
                studentCount: count,
              }),
            });

            const provisionData = await provisionRes.json().catch(() => ({}));

            if (!provisionRes.ok || !provisionData.success) {
              const msg =
                (provisionData as { error?: string })?.error ||
                (provisionData as { details?: string })?.details ||
                `Provisioning failed (${provisionRes.status}). Please contact support with ref ${response.tx_ref || txRef}.`;
              throw new Error(msg);
            }

            // Success — backend returned deployed_url
            setSuccessData({
              subdomain: (provisionData.subdomain as string) || values.subdomain.trim(),
              txRef: (provisionData.tx_ref as string) || response.tx_ref || txRef,
              amount,
              studentCount: count,
              deployedUrl: provisionData.deployed_url as string,
              domain: provisionData.domain as string,
            });
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Provisioning failed. Please contact support.";
            setGlobalError(message);
            console.error("[provision] client error:", err);
          } finally {
            setIsSubmitting(false);
            setProvisioning(false);
          }
        },
        onClose: () => {
          // User closed modal without completing payment
          setIsSubmitting(false);
          // Only show message if not already provisioning/success
          if (!provisioning && !successData) {
            setGlobalError("Payment was cancelled. You can try again when ready.");
          }
        },
        onError: (err) => {
          setIsSubmitting(false);
          setGlobalError(err.message || "Payment initialization failed.");
          console.error("Flutterwave error:", err);
        },
      }
    );
  }

  // Alias for overlay integration (instruction expects isProvisioning)
  const isProvisioning = provisioning;

  // -------------------------------------------------------------------------
  // Success / Provisioning UI
  // -------------------------------------------------------------------------
  if (provisioning) {
    return (
      <>
        <LoadingOverlay isVisible={isProvisioning} message="PROVISIONING_PORTAL..." />
        <LoadingOverlay isVisible={provisioning} message="PROVISIONING_PORTAL..." />
        <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-600/15 ring-1 ring-purple-500/20">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
        </div>
        <h3 className="mt-6 text-xl font-semibold tracking-tight text-white">Provisioning your portal...</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-purple-200/60">
          Payment verified! We&apos;re setting up{" "}
          <span className="font-mono font-medium text-purple-200">
            {values.subdomain}.resultapp.org
          </span>{" "}
          for <span className="font-medium text-white">{values.schoolName}</span>.
        </p>
        <div className="mt-6 w-full max-w-sm space-y-2 text-left">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <span className="text-sm text-emerald-100">Payment confirmed</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-purple-500/20 bg-purple-900/20 p-3">
            <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
            <span className="text-sm text-purple-100">Creating subdomain & admin account</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-purple-500/10 bg-purple-950/20 p-3 opacity-60">
            <Globe className="h-5 w-5 text-purple-300/60" />
            <span className="text-sm text-purple-200/60">Deploying to resultapp.org</span>
          </div>
        </div>
        <p className="mt-6 text-xs text-purple-300/50">
          This usually takes 30–60 seconds. You&apos;ll receive an email at {values.adminEmail}.
        </p>
      </div>
      </>
    );
  }

  if (successData) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/20">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <h3 className="mt-6 text-2xl font-bold tracking-tight text-white">Payment successful!</h3>
        <p className="mt-2 max-w-md text-sm text-purple-200/60">
          Your automated school portal is being provisioned at
        </p>
        <a
          href={successData.deployedUrl || `https://${successData.subdomain}.resultapp.org`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-purple-600 px-4 py-2 font-mono text-sm font-medium text-white shadow-[0_0_20px_rgba(147,51,234,0.35)] hover:bg-purple-500"
        >
          <Globe className="h-4 w-4" />
          {successData.domain || `${successData.subdomain}.resultapp.org`}
        </a>

        <div className="mt-6 w-full rounded-2xl border border-purple-500/15 bg-purple-900/10 p-4 text-left backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Sparkles className="h-4 w-4 text-purple-400" />
            What happens next?
          </div>
          <ul className="mt-3 space-y-2 text-sm text-purple-200/70">
            <li>• Admin account for <strong className="text-white">{values.adminName}</strong> is being created</li>
            <li>
              • {successData.studentCount} student slots credited ({formatNaira(successData.amount)}{" "}
              paid)
            </li>
            <li>• Login details sent to {values.adminEmail}</li>
            <li>• Portal will be live at the subdomain above in ~1 minute</li>
          </ul>
          <div className="mt-4 rounded-xl border border-purple-500/10 bg-[#0B0514]/60 p-3 font-mono text-xs text-purple-200">
            Tx ref: {successData.txRef}
          </div>
        </div>

        <Button
          className="mt-6 w-full rounded-full bg-purple-600 font-semibold text-white shadow-[0_0_20px_rgba(147,51,234,0.35)] hover:bg-purple-500"
          onClick={() =>
            (window.location.href =
              successData.deployedUrl || `https://${successData.subdomain}.resultapp.org`)
          }
        >
          Go to your portal
        </Button>
        <p className="mt-3 text-xs text-purple-300/50">
          Need help? Contact support@resultapp.org with your tx_ref.
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Form UI (default)
  // -------------------------------------------------------------------------
  return (
    <>
      <LoadingOverlay isVisible={isProvisioning} message="PROVISIONING_PORTAL..." />
      <LoadingOverlay isVisible={provisioning} message="PROVISIONING_PORTAL..." />
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
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
      />

      {/* Subdomain Slug */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="input-subdomain"
          className="text-sm font-medium text-purple-100"
        >
          Desired Subdomain Slug <span className="text-red-400">*</span>
        </label>
        <div className="flex">
          <input
            id="input-subdomain"
            name="subdomain"
            value={values.subdomain}
            onChange={(e) => handleChange("subdomain", e.target.value)}
            placeholder="vhs"
            required
            className={`flex h-10 w-full rounded-l-xl border bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${
              errors.subdomain ? "border-red-500/60 focus-visible:ring-red-500 focus-visible:border-red-500" : "border-purple-800/50 focus-visible:ring-purple-500 focus-visible:border-purple-500"
            }`}
          />
          <span className="inline-flex items-center rounded-r-xl border border-l-0 border-purple-800/50 bg-purple-950/30 px-3 text-sm text-purple-300/60">
            .resultapp.org
          </span>
        </div>
        {errors.subdomain ? (
          <p className="text-xs text-red-400">{errors.subdomain}</p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-purple-300/50">
            <Globe className="h-3 w-3" />
            Preview:{" "}
            <span className="font-mono font-medium text-purple-200">{subdomainPreview}</span>
          </p>
        )}
      </div>

      {/* Admin Full Name */}
      <Input
        label="Administrator Full Name"
        name="adminName"
        placeholder="Mrs. Adaeze Okafor"
        value={values.adminName}
        onChange={(e) => handleChange("adminName", e.target.value)}
        error={errors.adminName}
        required
        autoComplete="name"
      />

      {/* Admin Email */}
      <Input
        label="Admin Email Address"
        name="adminEmail"
        type="email"
        placeholder="admin@victoryhigh.edu.ng"
        value={values.adminEmail}
        onChange={(e) => handleChange("adminEmail", e.target.value)}
        error={errors.adminEmail}
        required
        autoComplete="email"
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
      />

      {/* Phone */}
      <Input
        label="Phone Number"
        name="phone"
        type="tel"
        placeholder="+234 801 234 5678"
        value={values.phone}
        onChange={(e) => handleChange("phone", e.target.value)}
        error={errors.phone}
        required
        autoComplete="tel"
      />

      {/* Student Count — text + slider synced */}
      <Input
        label="Estimated Number of Students"
        name="studentCount"
        type="text"
        inputMode="numeric"
        placeholder="e.g. 150"
        value={values.studentCount}
        onChange={(e) => handleChange("studentCount", e.target.value)}
        error={errors.studentCount}
        required
      />

      {/* Slider: 50-2000, step 10, clamped — allows 1-49 via text */}
      <div className="rounded-2xl border border-purple-500/10 bg-purple-950/15 p-4 backdrop-blur">
        <div className="flex items-center justify-between text-xs font-medium text-purple-300">
          <span>50</span>
          <span className="rounded-full border border-purple-500/15 bg-purple-500/5 px-2 py-0.5 text-[11px] text-purple-200/60">Slider 50–2000 • step 10 • 1–49 via text</span>
          <span>2,000</span>
        </div>
        <div className="relative mt-3">
          <input
            type="range"
            min={50}
            max={2000}
            step={10}
            value={clampedSliderValue}
            onChange={(e) => handleChange("studentCount", e.target.value)}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-purple-950/60"
            style={{
              background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(168 85 247) ${sliderPct}%, rgba(88,28,135,0.35) ${sliderPct}%, rgba(88,28,135,0.35) 100%)`,
            }}
            aria-label="Number of students slider"
          />
          <div
            className="pointer-events-none absolute top-1/2 hidden h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-purple-400 shadow-[0_0_14px_6px_rgba(168,85,247,0.45)] sm:block"
            style={{ left: `calc(${sliderPct}% - 5px)` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className={`rounded-full border px-2.5 py-1 ${studentCountNum < 500 ? "border-purple-500 bg-purple-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
            50–499 → ₦100
          </span>
          <span className={`rounded-full border px-2.5 py-1 ${studentCountNum >= 500 && studentCountNum < 1000 ? "border-violet-500 bg-violet-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
            500–999 → ₦90
          </span>
          <span className={`rounded-full border px-2.5 py-1 ${studentCountNum >= 1000 ? "border-emerald-500 bg-emerald-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
            1000+ → ₦80
          </span>
        </div>
        <style>{`input[type="range"]::-webkit-slider-thumb{appearance:none;height:18px;width:18px;border-radius:9999px;background:white;border:3px solid rgb(147 51 234);box-shadow:0 0 14px rgba(147,51,234,0.5)} input[type="range"]::-moz-range-thumb{height:18px;width:18px;border-radius:9999px;background:white;border:3px solid rgb(147 51 234);box-shadow:0 0 14px rgba(147,51,234,0.5)}`}</style>
      </div>

      {/* Real-time Pricing Card — tiered */}
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
                  {studentCountNum || 0} × {formatNaira(unitPrice)}
                </span>
                {badge && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeStyle}`}>{badge}</span>}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tracking-tight text-white">
              {studentCountNum > 0 ? formatNaira(totalAmount) : "—"}
            </p>
            <p className="text-xs text-purple-300/50">One-time • Credits never expire</p>
          </div>
        </div>

        {studentCountNum > 0 && (
          <div className="mt-3 rounded-xl border border-purple-500/10 bg-[#0B0514]/60 p-3 text-xs leading-5 text-purple-200/70">
            <div className="flex justify-between">
              <span>Students</span>
              <span className="font-medium text-white">{studentCountNum}</span>
            </div>
            <div className="flex justify-between">
              <span>Price per student</span>
              <span className="text-purple-200">{formatNaira(unitPrice)}</span>
            </div>
            <div className="my-2 border-t border-purple-500/10" />
            <div className="flex justify-between font-semibold text-white">
              <span>Total payable</span>
              <span>{formatNaira(totalAmount)}</span>
            </div>
          </div>
        )}

        <p className="mt-2 flex items-center gap-1 text-xs text-purple-300/50">
          <Building2 className="h-3 w-3" />
          Secured by Flutterwave • Pay with card, transfer, or USSD
        </p>
      </div>

      {/* Global error */}
      {globalError && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Submit — pulsing electric purple */}
      <Button
        type="submit"
        className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.40)] hover:bg-purple-500 hover:shadow-[0_0_40px_rgba(147,51,234,0.55)] disabled:opacity-60 motion-safe:animate-pulse hover:motion-safe:animate-none"
        disabled={isSubmitting}
        size="lg"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Initializing payment...
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" />
            {studentCountNum > 0
              ? `Pay ${formatNaira(totalAmount)} & Create Portal`
              : "Pay & Create Portal"}
          </>
        )}
      </Button>

      <p className="text-center text-xs leading-5 text-purple-300/40">
        By continuing, you agree to our Terms and Privacy Policy. Your portal at{" "}
        <span className="font-mono font-medium text-purple-200">{subdomainPreview}</span> will be created after
        payment.
      </p>
    </form>
    </>
  );
}
