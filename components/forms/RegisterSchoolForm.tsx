"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Building2,
  Users,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError(null);

    if (!validate()) return;

    const payload = {
      schoolName: values.schoolName.trim(),
      subdomain: values.subdomain.trim().toLowerCase(),
      adminEmail: values.adminEmail.trim().toLowerCase(),
      adminPassword: values.adminPassword,
      studentCount: parseInt(values.studentCount.trim(), 10),
      // Credit & Command: fixed 30-credit trial grant (frictionless onboarding).
      initial_credits: 30,
    };

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/register-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        deployed_url?: string;
        deployedUrl?: string;
        domain?: string;
        subdomain?: string;
        school_name?: string;
        details?: string;
      };

      if (!res.ok || !data.success) {
        // Map fieldErrors from API (e.g., 409 subdomain)
        if (data.fieldErrors) {
          const mapped: FormErrors = {};
          if (data.fieldErrors.subdomain) mapped.subdomain = data.fieldErrors.subdomain;
          if (data.fieldErrors.schoolName) mapped.schoolName = data.fieldErrors.schoolName;
          if (data.fieldErrors.adminEmail) mapped.adminEmail = data.fieldErrors.adminEmail;
          if (data.fieldErrors.adminPassword) mapped.adminPassword = data.fieldErrors.adminPassword;
          if (data.fieldErrors.studentCount) mapped.studentCount = data.fieldErrors.studentCount;
          if (Object.keys(mapped).length > 0) setErrors((prev) => ({ ...prev, ...mapped }));
        }

        // Graceful backend error mapping
        if (res.status === 409) {
          throw new Error(data.error || "Subdomain already exists — please choose another.");
        }

        throw new Error(
          data.error || data.details || `Provisioning failed (${res.status}). Please try again or contact support@resultapp.org.`
        );
      }

      // Success
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
      console.error("[RegisterSchoolForm] submit error:", err);
    } finally {
      setIsSubmitting(false);
    }
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
          onClick={() => {
            setSuccessData(null);
            setValues({ schoolName: "", subdomain: "", adminEmail: "", adminPassword: "", adminPasswordConfirm: "", studentCount: "" });
            setErrors({});
          }}
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

      {/* Trial grant notice — 30 free credits, no payment at registration */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-emerald-200">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          Includes 30 free trial credits at launch
        </p>
        <p className="mt-1 text-xs leading-5 text-emerald-100/60">
          Enough to publish a full class. Previews and drafts are always free — you only pay when topping up to publish the rest of the school.
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

      {/* Submit */}
      <Button
        type="submit"
        className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.40)] hover:bg-purple-500 hover:shadow-[0_0_40px_rgba(147,51,234,0.55)] disabled:opacity-60 disabled:cursor-not-allowed"
        disabled={isSubmitting}
        size="lg"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Provisioning your school... This may take a minute
          </>
        ) : (
          <>
            <Building2 className="h-4 w-4" />
            Create School Portal
          </>
        )}
      </Button>

      {/* Loading helper text */}
      {isSubmitting && (
        <p className="text-center text-xs text-purple-300/50">
          Please keep this tab open — we&apos;re contacting the provisioning engine at {baseDomain}…
        </p>
      )}

      <p className="text-center text-xs leading-5 text-purple-300/40">
        By continuing, you agree to our Terms and Privacy Policy. Your portal at{" "}
        <span className="font-mono font-medium text-purple-200">{previewDomain}</span> will be created securely.
      </p>
    </form>
  );
}
