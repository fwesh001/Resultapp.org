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
import {
  calculateTotalAmount,
  formatNaira,
  PRICE_PER_STUDENT,
  getFlutterwavePublicKey,
  loadFlutterwaveScript,
  initiateFlutterwaveInlinePayment,
  generateTxRef,
} from "@/lib/flutterwave";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface FormValues {
  schoolName: string;
  subdomain: string;
  adminName: string;
  adminEmail: string;
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

  // Derived pricing
  const studentCountNum = useMemo(() => {
    const n = parseInt(values.studentCount, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [values.studentCount]);

  const totalAmount = useMemo(() => calculateTotalAmount(studentCountNum), [studentCountNum]);

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
    const amount = calculateTotalAmount(count);

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
          description: `${count} students × ${formatNaira(PRICE_PER_STUDENT)} = ${formatNaira(amount)}`,
          logo: "https://resultapp.org/logo.png",
        },
        meta: {
          schoolName: values.schoolName.trim(),
          subdomain: values.subdomain.trim(),
          adminName: values.adminName.trim(),
          studentCount: count,
          pricePerStudent: PRICE_PER_STUDENT,
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

  // -------------------------------------------------------------------------
  // Success / Provisioning UI
  // -------------------------------------------------------------------------
  if (provisioning) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
        <h3 className="mt-6 text-xl font-semibold">Provisioning your portal...</h3>
        <p className="mt-2 max-w-md text-sm text-zinc-600">
          Payment verified! We&apos;re setting up{" "}
          <span className="font-mono font-medium text-black">
            {values.subdomain}.resultapp.org
          </span>{" "}
          for <span className="font-medium">{values.schoolName}</span>.
        </p>
        <div className="mt-6 w-full max-w-sm space-y-2 text-left">
          <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span className="text-sm">Payment confirmed</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            <span className="text-sm">Creating subdomain & admin account</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-zinc-50 p-3 opacity-60">
            <Globe className="h-5 w-5 text-zinc-400" />
            <span className="text-sm">Deploying to resultapp.org</span>
          </div>
        </div>
        <p className="mt-6 text-xs text-zinc-500">
          This usually takes 30–60 seconds. You&apos;ll receive an email at {values.adminEmail}.
        </p>
      </div>
    );
  }

  if (successData) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h3 className="mt-6 text-2xl font-bold">Payment successful!</h3>
        <p className="mt-2 max-w-md text-sm text-zinc-600">
          Your automated school portal is being provisioned at
        </p>
        <a
          href={successData.deployedUrl || `https://${successData.subdomain}.resultapp.org`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 font-mono text-sm font-medium text-white hover:bg-zinc-800"
        >
          <Globe className="h-4 w-4" />
          {successData.domain || `${successData.subdomain}.resultapp.org`}
        </a>

        <div className="mt-6 w-full rounded-xl border bg-zinc-50 p-4 text-left">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-blue-600" />
            What happens next?
          </div>
          <ul className="mt-3 space-y-2 text-sm text-zinc-600">
            <li>• Admin account for <strong>{values.adminName}</strong> is being created</li>
            <li>
              • {successData.studentCount} student slots credited ({formatNaira(successData.amount)}{" "}
              paid)
            </li>
            <li>• Login details sent to {values.adminEmail}</li>
            <li>• Portal will be live at the subdomain above in ~1 minute</li>
          </ul>
          <div className="mt-4 rounded-md bg-white p-3 font-mono text-xs">
            Tx ref: {successData.txRef}
          </div>
        </div>

        <Button
          className="mt-6 w-full"
          onClick={() =>
            (window.location.href =
              successData.deployedUrl || `https://${successData.subdomain}.resultapp.org`)
          }
        >
          Go to your portal
        </Button>
        <p className="mt-3 text-xs text-zinc-500">
          Need help? Contact support@resultapp.org with your tx_ref.
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Form UI (default)
  // -------------------------------------------------------------------------
  return (
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
          className="text-sm font-medium text-zinc-700"
        >
          Desired Subdomain Slug <span className="text-red-500">*</span>
        </label>
        <div className="flex">
          <input
            id="input-subdomain"
            name="subdomain"
            value={values.subdomain}
            onChange={(e) => handleChange("subdomain", e.target.value)}
            placeholder="vhs"
            required
            className={`flex h-10 w-full rounded-l-md border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:opacity-50 ${
              errors.subdomain ? "border-red-500 focus-visible:ring-red-500" : ""
            }`}
          />
          <span className="inline-flex items-center rounded-r-md border border-l-0 border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500">
            .resultapp.org
          </span>
        </div>
        {errors.subdomain ? (
          <p className="text-xs text-red-600">{errors.subdomain}</p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Globe className="h-3 w-3" />
            Preview:{" "}
            <span className="font-mono font-medium text-zinc-700">{subdomainPreview}</span>
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

      {/* Student Count */}
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

      {/* Real-time Pricing Card */}
      <div className="rounded-xl border bg-zinc-50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white">
              <CreditCard className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium">Total Amount</p>
              <p className="text-xs text-zinc-500">
                {studentCountNum || 0} students × {formatNaira(PRICE_PER_STUDENT)}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">
              {studentCountNum > 0 ? formatNaira(totalAmount) : "—"}
            </p>
            <p className="text-xs text-zinc-500">One-time • Credits never expire</p>
          </div>
        </div>

        {studentCountNum > 0 && (
          <div className="mt-3 rounded-md bg-white p-3 text-xs leading-5 text-zinc-600">
            <div className="flex justify-between">
              <span>Students</span>
              <span className="font-medium">{studentCountNum}</span>
            </div>
            <div className="flex justify-between">
              <span>Price per student</span>
              <span>{formatNaira(PRICE_PER_STUDENT)}</span>
            </div>
            <div className="my-2 border-t" />
            <div className="flex justify-between font-semibold text-black">
              <span>Total payable</span>
              <span>{formatNaira(totalAmount)}</span>
            </div>
          </div>
        )}

        <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
          <Building2 className="h-3 w-3" />
          Secured by Flutterwave • Pay with card, transfer, or USSD
        </p>
      </div>

      {/* Global error */}
      {globalError && (
        <div className="flex gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Submit */}
      <Button type="submit" className="w-full gap-2" disabled={isSubmitting} size="lg">
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

      <p className="text-center text-xs text-zinc-500">
        By continuing, you agree to our Terms and Privacy Policy. Your portal at{" "}
        <span className="font-mono font-medium">{subdomainPreview}</span> will be created after
        payment.
      </p>
    </form>
  );
}
