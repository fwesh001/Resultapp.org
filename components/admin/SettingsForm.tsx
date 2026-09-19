"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UploadField from "@/components/ui/UploadField";
import type { School } from "@/types/school";

interface SettingsFormProps {
  school: School | null;
}

/**
 * Client-side school profile form.
 * PATCHes branding data through the Next.js settings proxy,
 * which forwards to FastAPI with the API secret.
 */
export default function SettingsForm({ school }: SettingsFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setSuccess(null);
    setError(null);

    const subdomain = school?.slug ?? "";
    if (!subdomain) {
      setError("Unknown school subdomain — cannot save.");
      setIsSubmitting(false);
      return;
    }

    const formData = new FormData(e.currentTarget);
    const payload: Record<string, string> = { subdomain };
    for (const field of [
      "school_name",
      "motto",
      "email",
      "phone",
      "address",
      "current_term",
      "current_session",
      "new_term_begins",
      "logo_url",
      "hero_bg_url",
      "id_prefix",
    ]) {
      const value = formData.get(field);
      if (typeof value === "string") {
        if (field === "id_prefix") payload[field] = value.trim().toUpperCase();
        else if (field === "current_term" || field === "current_session") payload[field] = value.trim();
        else payload[field] = value.trim();
      }
    }

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Failed to save settings.");
      }

      setSuccess(data.message || "School profile updated successfully.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClassName =
    "mt-2 w-full rounded-xl border border-purple-500/20 bg-[#0B0514] px-4 py-3 text-white placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50";

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 space-y-4 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-6"
    >
      {success && (
        <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {success}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <div>
        <label
          htmlFor="school-name"
          className="block text-sm font-medium text-purple-200"
        >
          School name
        </label>
        <input
          id="school-name"
          name="school_name"
          type="text"
          autoComplete="organization"
          defaultValue={school?.name ?? ""}
          placeholder="e.g. Victory High School"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-motto"
          className="block text-sm font-medium text-purple-200"
        >
          Motto
        </label>
        <input
          id="school-motto"
          name="motto"
          type="text"
          autoComplete="off"
          defaultValue={school?.motto ?? ""}
          placeholder="e.g. Excellence through discipline"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-email"
          className="block text-sm font-medium text-purple-200"
        >
          Email
        </label>
        <input
          id="school-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={school?.email ?? ""}
          placeholder="e.g. info@school.edu"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-phone"
          className="block text-sm font-medium text-purple-200"
        >
          Phone
        </label>
        <input
          id="school-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={school?.phone ?? ""}
          placeholder="e.g. +234 800 000 0000"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-address"
          className="block text-sm font-medium text-purple-200"
        >
          School Address
        </label>
        <textarea
          id="school-address"
          name="address"
          rows={2}
          autoComplete="street-address"
          defaultValue={school?.address ?? ""}
          placeholder="e.g. Off Student Village Road, Nasarawa"
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-purple-300/40">Shown beneath the school name on the report header.</p>
      </div>

      <div>
        <label
          htmlFor="id-prefix"
          className="block text-sm font-medium text-purple-200"
        >
          Admission ID Prefix
        </label>
        <input
          id="id-prefix"
          name="id_prefix"
          type="text"
          autoComplete="off"
          defaultValue={school?.idPrefix ?? school?.slug?.toUpperCase() ?? ""}
          placeholder="e.g. VHS"
          pattern="^[A-Za-z0-9/-]{2,20}$"
          maxLength={20}
          onChange={(e) => {
            e.target.value = e.target.value.toUpperCase();
          }}
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-purple-300/40">
          Prefix for new Admission Nos (e.g. <span className="font-mono text-purple-200">VHS/001</span>). Auto-filled when adding students; existing IDs are never changed.
        </p>
      </div>

      <div>
        <label
          htmlFor="new-term-begins"
          className="block text-sm font-medium text-purple-200"
        >
          New Term Begins
        </label>
        <input
          id="new-term-begins"
          name="new_term_begins"
          type="date"
          defaultValue={school?.newTermBegins ? String(school.newTermBegins).slice(0, 10) : ""}
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-purple-300/40">
          Resumption date for the next term (e.g., 2026-01-09). Displayed as “09 Jan 2026” on report cards. Leave empty for “—”.
        </p>
      </div>

      <UploadField
        id="school-logo-url"
        label="School logo"
        name="logo_url"
        defaultValue={school?.logoUrl ?? ""}
        extraFields={{ subdomain: school?.slug ?? "", kind: "logo" }}
        helper="Shown in the navbar and landing hero."
        preview="image"
        previewVariant="square"
      />

      <UploadField
        id="school-hero-bg-url"
        label="Hero background image"
        name="hero_bg_url"
        defaultValue={school?.heroBgUrl ?? ""}
        extraFields={{ subdomain: school?.slug ?? "", kind: "hero" }}
        helper="Displayed behind the landing hero."
        preview="image"
        previewVariant="wide"
        fallbackPreview="/bento-csv-accent.avif"
        fallbackNote="Previewing default platform artwork — upload to replace it."
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-[#0B0514] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Saving..." : "Save Changes"}
      </button>
    </form>
  );
}
