"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import UploadField from "@/components/ui/UploadField";
import { Select } from "@/components/ui/Select";
import SchemeBuilder from "@/components/remarks/SchemeBuilder";
import { toast } from "@/components/ui/toast";
import SignatureCaptureModal from "@/components/ui/SignatureCaptureModal";
import type { RemarkBand, School } from "@/types/school";

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
  const [activeTab, setActiveTab] = useState<"profile" | "branding">("profile");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The custom Select is controlled, so the active term is held in state and
  // mirrored into the form by its hidden `name="current_term"` input.
  const [currentTerm, setCurrentTerm] = useState(school?.currentTerm ?? "Term 1");

  // Drawn principal signature.
  //
  // Held in local state (not in the form's field list) and persisted by its
  // OWN request the moment the modal saves. Deliberately not part of
  // handleSubmit: a hidden input would be re-sent on every later Save, so
  // changing an unrelated setting could silently restore a stale signature.
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [drawnSignature, setDrawnSignature] = useState<string | null>(
    school?.principalSignatureData ?? null,
  );

  async function persistSignature(body: Record<string, string | null>) {
    const subdomain = school?.slug ?? "";
    if (!subdomain) throw new Error("Unknown school subdomain");
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(data.error || `Could not save signature (${res.status})`);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
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
        "staff_id_prefix",
        "principal_signature_url",
      ]) {
      const value = formData.get(field);
      if (typeof value === "string") {
        if (field === "id_prefix") payload[field] = value.trim().toLowerCase();
        else if (field === "staff_id_prefix") payload[field] = value.trim();
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

      toast.success(data.message || "School profile updated successfully.");
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

  const content = (
    <form
      onSubmit={handleSubmit}
      className="mt-6 space-y-4 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-6"
    >
      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-2" role="tablist" aria-label="Settings sections">
        {(
          [
            { id: "profile", label: "Public Profile" },
            { id: "branding", label: "Report-Card Branding" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            className={
              activeTab === t.id
                ? "rounded-xl bg-purple-600 px-3 py-2.5 text-sm font-semibold text-white"
                : "rounded-xl px-3 py-2.5 text-sm font-medium text-purple-200/70 transition hover:bg-white/5 hover:text-white"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <div className="space-y-4" role="tabpanel" aria-label="Public Profile">
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

      </div>
      )}

      {activeTab === "branding" && (
        <div className="space-y-4" role="tabpanel" aria-label="Report-Card Branding">
      {/* Drawn signature — the primary path. Shown above the uploader so the
          recommended option is the first thing an admin reaches for. */}
      <div className="rounded-xl border border-purple-500/20 bg-purple-900/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-purple-100">Principal's signature</p>
            <p className="mt-0.5 text-xs text-purple-300/50">
              {drawnSignature
                ? "Using your drawn signature."
                : school?.principalSignatureUrl
                  ? "Using the uploaded image below."
                  : "Not set — report cards fall back to the word “Principal”."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSigModalOpen(true)}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {drawnSignature ? "Redraw signature" : "Draw signature"}
          </button>
        </div>
        {drawnSignature && (
          <div className="mt-3 flex h-20 items-end rounded-lg border border-purple-500/20 bg-white p-2">
            {/* Preview of what will print. eslint-disable: a data URI cannot go
                through next/image without a loader configured for it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={drawnSignature} alt="Your saved signature preview" className="h-12 object-contain object-left" />
          </div>
        )}
      </div>

      {/* Uploaded-image fallback, retained per the single-signature rule: saving
          one clears the other, and the drawn one wins. */}
      <UploadField
        id="principal-signature-url"
        label="Or upload a signature image"
        name="principal_signature_url"
        defaultValue={school?.principalSignatureUrl ?? ""}
        extraFields={{ subdomain: school?.slug ?? "", kind: "signature" }}
        helper="Transparent PNG works best. Used only if no signature has been drawn above."
        preview="image"
        previewVariant="square"
      />
      <div className="grid gap-4 sm:grid-cols-2">
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
          defaultValue={school?.idPrefix ?? school?.slug?.toLowerCase() ?? ""}
          placeholder="e.g. vhs"
          pattern="^[A-Za-z0-9/-]{2,20}$"
          maxLength={20}
          onChange={(e) => {
            e.target.value = e.target.value.toLowerCase();
          }}
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-purple-300/40">
          Prefix for new Admission Nos (e.g. <span className="font-mono text-purple-200">vhs/001</span>). Auto-assigned on bulk upload; existing IDs are never changed.
        </p>
      </div>

      <div>
        <label
          htmlFor="staff-id-prefix"
          className="block text-sm font-medium text-purple-200"
        >
          Staff ID Prefix
        </label>
        <input
          id="staff-id-prefix"
          name="staff_id_prefix"
          type="text"
          autoComplete="off"
          defaultValue={school?.staffIdPrefix ?? "STAFF/"}
          placeholder="e.g. STAFF/"
          pattern="^[A-Za-z0-9/-]{2,20}$"
          maxLength={20}
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-purple-300/40">
          Prefix for new Staff IDs (e.g. <span className="font-mono text-purple-200">STAFF/001</span>). Auto-assigned on bulk upload; existing IDs are never changed.
        </p>
      </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="current-term" className="block text-sm font-medium text-purple-200">
            Active Term
          </label>
          <Select
            id="current-term"
            name="current_term"
            aria-label="Active Term"
            value={currentTerm}
            onChange={setCurrentTerm}
            options={[
              { value: "Term 1", label: "Term 1" },
              { value: "Term 2", label: "Term 2" },
              { value: "Term 3", label: "Term 3" },
            ]}
          />
          <p className="mt-1 text-xs text-purple-300/40">Dashboard and reports default to this term.</p>
        </div>
        <div>
          <label htmlFor="current-session" className="block text-sm font-medium text-purple-200">
            Academic Session
          </label>
          <input
            id="current-session"
            name="current_session"
            type="text"
            autoComplete="off"
            defaultValue={school?.currentSession ?? ""}
            placeholder="e.g. 2026/2027"
            pattern="^\d{4}/\d{4}$"
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-purple-300/40">Leave blank to auto-derive (Sept rollover).</p>
        </div>
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

      <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4">
        <h3 className="text-sm font-semibold text-white">Principal&apos;s Remark Scheme</h3>
        <p className="mt-1 text-xs text-purple-300/50">
          Grade bands that auto-generate principal remarks from overall averages. Used by the “Auto-Apply Principal Remarks” bulk action. Averages in gaps stay manual.
        </p>
        <div className="mt-3">
          <SchemeBuilder
            initial={school?.principalRemarkScheme ?? []}
            accent="purple"
            onSave={async (bands: RemarkBand[]) => {
              const subdomain = school?.slug ?? "";
              if (!subdomain) throw new Error("Unknown school subdomain — cannot save.");
              const res = await fetch("/api/admin/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subdomain, principal_remark_scheme: bands }),
              });
              const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
              if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to save scheme.");
              }
              toast.success("Principal remark scheme saved.");
              router.refresh();
            }}
          />
        </div>
      </div>

        </div>
      )}

      <div className="action-bar-sticky rounded-b-xl">
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-[#0B0514] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Saving..." : "Save Changes"}
        </button>
</div>
      </form>
  );

  // Mounted OUTSIDE the <form> on purpose: the drawn signature persists on its
  // own so that pressing "Save Changes" for an unrelated field (motto, prefixes)
  // cannot clobber a signature the admin just drew.
  return (
    <>
      {content}

      <SignatureCaptureModal
        open={sigModalOpen}
        onOpenChange={setSigModalOpen}
        signerLabel="Principal"
        currentSignature={drawnSignature ?? school?.principalSignatureUrl ?? null}
        onSave={async (dataUri) => {
          await persistSignature({ principal_signature_data: dataUri });
          setDrawnSignature(dataUri);
          toast.success("Signature saved", {
            description: "It will appear on report cards from now on.",
          });
          // Re-read the tenant so the header/logo and any other server-derived
          // school fields reflect the new state.
          router.refresh();
        }}
        onRemove={async () => {
          // "" is the clear signal, NOT null: null decodes identically to a
          // missing key, so the proxy cannot tell "clear it" from "not
          // supplied" and rejects the request. Blank is normalized to SQL NULL
          // server-side, which also clears the paired uploaded URL.
          await persistSignature({ principal_signature_data: "" });
          setDrawnSignature(null);
          toast.success("Signature removed");
          router.refresh();
        }}
      />
    </>
  );
}
