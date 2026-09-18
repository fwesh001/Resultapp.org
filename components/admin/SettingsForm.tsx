"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus } from "lucide-react";
import type { School } from "@/types/school";

interface SettingsFormProps {
  school: School | null;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Upload a branding image with progress callbacks (XHR is used
 * because fetch has no upload-progress events).
 */
function uploadImage(
  file: File,
  subdomain: string,
  kind: string,
  onProgress: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/uploads");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as {
          success?: boolean;
          url?: string;
          error?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && data.success && data.url) {
          resolve(data.url);
        } else {
          reject(new Error(data.error || `Upload failed (${xhr.status}).`));
        }
      } catch {
        reject(new Error("Upload failed: invalid server response."));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error."));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("subdomain", subdomain);
    fd.append("kind", kind);
    xhr.send(fd);
  });
}

interface ImageFieldProps {
  id: string;
  label: string;
  fieldName: string;
  kind: "logo" | "hero";
  defaultValue: string;
  subdomain: string;
  helper: string;
  fallbackPreview?: string;
}

/**
 * Branding image field with "Image URL" / "Upload file" modes,
 * live preview, and upload progress.
 */
function ImageField({
  id,
  label,
  fieldName,
  kind,
  defaultValue,
  subdomain,
  helper,
  fallbackPreview,
}: ImageFieldProps) {
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [value, setValue] = useState(defaultValue);
  const [preview, setPreview] = useState(defaultValue || fallbackPreview || "");
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("Image must be 5MB or less.");
      return;
    }
    if (!subdomain) {
      setUploadError("Unknown school subdomain — cannot upload.");
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const localUrl = URL.createObjectURL(file);
    objectUrlRef.current = localUrl;
    setPreview(localUrl);
    setFileLabel(file.name);
    setUploading(true);
    setProgress(0);

    try {
      const url = await uploadImage(file, subdomain, kind, setProgress);
      setValue(url);
      setPreview(url);
      setProgress(100);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
      setProgress(null);
    } finally {
      setUploading(false);
    }
  }

  const showingFallback = !value && !!fallbackPreview;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-purple-200"
      >
        {label}
      </label>

      <div className="mt-2 flex gap-2">
        {(["url", "upload"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              mode === m
                ? "rounded-full bg-purple-600/20 px-4 py-1.5 text-xs font-medium text-purple-200"
                : "rounded-full border border-purple-500/15 px-4 py-1.5 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-white"
            }
          >
            {m === "url" ? "Image URL" : "Upload file"}
          </button>
        ))}
      </div>

      {/* Live preview */}
      <div className="mt-2 overflow-hidden rounded-xl border border-purple-500/20 bg-[#0B0514]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`${label} preview`}
            className={
              kind === "logo"
                ? "h-24 w-24 object-cover"
                : "h-40 w-full object-cover"
            }
          />
        ) : (
          <div className="flex h-24 items-center justify-center text-xs text-purple-300/40">
            No image selected
          </div>
        )}
      </div>
      {showingFallback ? (
        <p className="mt-1 text-xs text-purple-300/50">
          Previewing default platform artwork — upload to replace it.
        </p>
      ) : (
        <p className="mt-1 text-xs text-purple-300/50">{helper}</p>
      )}

      {/* Submitted value (URL mode edits this directly, upload mode sets it) */}
      <input type="hidden" name={fieldName} value={value} />

      {mode === "url" ? (
        <input
          id={id}
          type="url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setPreview(e.target.value || fallbackPreview || "");
          }}
          placeholder="https://..."
          className="mt-2 w-full rounded-xl border border-purple-500/20 bg-[#0B0514] px-4 py-3 text-white placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
        />
      ) : (
        <div className="mt-2">
          <label
            htmlFor={`${id}-file`}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-purple-500/30 px-4 py-6 text-sm text-purple-200/70 transition hover:bg-purple-900/10"
          >
            <ImagePlus className="h-5 w-5 text-purple-300" />
            {fileLabel ?? "Choose an image (max 5MB)"}
          </label>
          <input
            id={`${id}-file`}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          {progress !== null && (
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-purple-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-purple-200/60">
                {uploading ? (
                  <>Uploading... {progress}%</>
                ) : (
                  progress === 100 && (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      Upload complete.
                    </>
                  )
                )}
              </p>
            </div>
          )}
          {uploadError && (
            <p className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
              {uploadError}
            </p>
          )}
        </div>
      )}
    </div>
  );
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
      "logo_url",
      "hero_bg_url",
    ]) {
      const value = formData.get(field);
      if (typeof value === "string") {
        payload[field] = value.trim();
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
          Address
        </label>
        <textarea
          id="school-address"
          name="address"
          rows={3}
          defaultValue={school?.address ?? ""}
          placeholder="School address"
          className={inputClassName}
        />
      </div>

      <ImageField
        id="school-logo-url"
        label="School logo"
        fieldName="logo_url"
        kind="logo"
        defaultValue={school?.logoUrl ?? ""}
        subdomain={school?.slug ?? ""}
        helper="Shown in the navbar and landing hero."
      />

      <ImageField
        id="school-hero-bg-url"
        label="Hero background image"
        fieldName="hero_bg_url"
        kind="hero"
        defaultValue={school?.heroBgUrl ?? ""}
        subdomain={school?.slug ?? ""}
        helper="Displayed behind the landing hero."
        fallbackPreview="/bento-csv-accent.avif"
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
