"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp, ImagePlus } from "lucide-react";

export interface UploadFieldProps {
  id: string;
  label?: string;
  /** Form field name. Upload behavior: hidden input carrying the URL. Select behavior: native file input name. */
  name?: string;
  /** Existing file URL (upload behavior). */
  defaultValue?: string;
  /** POST endpoint for immediate uploads. Defaults to the branding upload API. */
  endpoint?: string;
  /** Extra fields appended to the upload FormData (e.g. subdomain, kind). */
  extraFields?: Record<string, string>;
  /** File picker filter. Defaults to images. */
  accept?: string;
  /** Max file size in bytes. Defaults to 5MB. */
  maxBytes?: number;
  /** Show the "Image URL" / "Upload file" toggle (upload behavior). Defaults to true. */
  allowUrl?: boolean;
  /** "upload": upload immediately with progress. "select": pick only, parent form submits the file. */
  behavior?: "upload" | "select";
  /** Preview style. "file" shows a name/size chip instead of a thumbnail. Defaults to "image". */
  preview?: "image" | "file" | "none";
  /** Image thumbnail shape. Defaults to "wide". */
  previewVariant?: "square" | "wide";
  /** Image shown while no value is set (e.g. platform default artwork). */
  fallbackPreview?: string;
  /** Note shown under the preview while the fallback is displayed. */
  fallbackNote?: string;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
  tone?: "dark" | "light";
  onUploaded?: (url: string) => void;
  onFileSelect?: (file: File | null) => void;
}

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchesAccept(file: File, accept: string): boolean {
  const tokens = accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith(".")) return name.endsWith(token);
    if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

/**
 * Upload a file with progress callbacks (XHR is used
 * because fetch has no upload-progress events).
 */
export function uploadFile(
  endpoint: string,
  file: File,
  extraFields: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
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
    for (const [key, val] of Object.entries(extraFields)) {
      fd.append(key, val);
    }
    xhr.send(fd);
  });
}

/**
 * Shared file upload field — like Footer, import and drop it anywhere:
 * `<UploadField id="..." name="..." />`.
 *
 * - behavior="upload": uploads immediately with a progress bar; the
 *   resulting URL is submitted via a hidden input.
 * - behavior="select": only picks a file (with preview chip); the parent
 *   form submits the raw file on its own submit.
 */
export default function UploadField({
  id,
  label,
  name,
  defaultValue = "",
  endpoint = "/api/admin/uploads",
  extraFields = {},
  accept = "image/*",
  maxBytes = DEFAULT_MAX_BYTES,
  allowUrl = true,
  behavior = "upload",
  preview = "image",
  previewVariant = "wide",
  fallbackPreview,
  fallbackNote,
  helper,
  required = false,
  disabled = false,
  tone = "dark",
  onUploaded,
  onFileSelect,
}: UploadFieldProps) {
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [value, setValue] = useState(defaultValue);
  const [previewUrl, setPreviewUrl] = useState(
    defaultValue || fallbackPreview || "",
  );
  const [previewIsImage, setPreviewIsImage] = useState(
    !defaultValue ? !!fallbackPreview : true,
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function setLocalPreview(file: File) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const isImage = file.type.startsWith("image/");
    if (isImage) {
      const localUrl = URL.createObjectURL(file);
      objectUrlRef.current = localUrl;
      setPreviewUrl(localUrl);
    } else {
      setPreviewUrl("");
    }
    setPreviewIsImage(isImage);
    setFileMeta(`${file.name} • ${formatBytes(file.size)}`);
  }

  function validate(file: File): string | null {
    if (!matchesAccept(file, accept)) return "File type not allowed.";
    if (file.size > maxBytes)
      return `File must be ${formatBytes(maxBytes)} or less.`;
    return null;
  }

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || disabled) return;
    setUploadError(null);

    const problem = validate(file);
    if (problem) {
      setUploadError(problem);
      return;
    }

    setLocalPreview(file);
    onFileSelect?.(file);

    if (behavior === "select") return;

    setUploading(true);
    setProgress(0);
    try {
      const url = await uploadFile(endpoint, file, extraFields, setProgress);
      setValue(url);
      setPreviewUrl(url);
      setPreviewIsImage(true);
      setFileMeta(`${file.name} • ${formatBytes(file.size)}`);
      setProgress(100);
      onUploaded?.(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
      setProgress(null);
    } finally {
      setUploading(false);
    }
  }

  function clearSelection() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPreviewUrl(fallbackPreview || "");
    setPreviewIsImage(!!fallbackPreview);
    setFileMeta(null);
    setProgress(null);
    setUploadError(null);
    if (behavior === "select") {
      onFileSelect?.(null);
    } else {
      setValue("");
    }
  }

  const showingFallback = !value && !!fallbackPreview && behavior === "upload";
  const showUrlInput = behavior === "upload" && (!allowUrl ? false : mode === "url");
  const acceptHint = accept === "image/*" ? "image" : accept;

  const muted = tone === "dark" ? "text-purple-300/50" : "text-zinc-500";
  const dropzone =
    tone === "dark"
      ? `border-purple-500/30 text-purple-200/70 hover:bg-purple-900/10 ${dragOver ? "bg-purple-900/20 border-purple-400" : ""}`
      : `border-zinc-300 text-zinc-500 hover:bg-zinc-50 ${dragOver ? "bg-zinc-100 border-zinc-400" : ""}`;
  const inputClass =
    tone === "dark"
      ? "border-purple-500/20 bg-[#0B0514] text-white placeholder:text-purple-300/40 focus:border-purple-500 focus:ring-purple-500/50"
      : "border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-zinc-500/30";
  const chip =
    tone === "dark"
      ? "border-purple-500/20 bg-purple-900/20 text-purple-200"
      : "border-zinc-200 bg-zinc-100 text-zinc-700";

  return (
    <div>
      {label && (
        <label
          htmlFor={showUrlInput ? id : undefined}
          className={`block text-sm font-medium ${tone === "dark" ? "text-purple-200" : "text-zinc-700"}`}
        >
          {label}
        </label>
      )}

      {behavior === "upload" && allowUrl && (
        <div className="mt-2 flex gap-2">
          {(["url", "upload"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => setMode(m)}
              className={
                mode === m
                  ? "rounded-full bg-purple-600/20 px-4 py-1.5 text-xs font-medium text-purple-200"
                  : "rounded-full border border-purple-500/15 px-4 py-1.5 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-white"
              }
            >
              {m === "url" ? "File URL" : "Upload file"}
            </button>
          ))}
        </div>
      )}

      {/* Preview */}
      {preview !== "none" && (previewUrl || fileMeta) && (
        <div
          className={`mt-2 overflow-hidden rounded-xl border ${tone === "dark" ? "border-purple-500/20 bg-[#0B0514]" : "border-zinc-200 bg-zinc-50"}`}
        >
          {preview === "image" && previewUrl && previewIsImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={`${label || "Upload"} preview`}
              className={
                previewVariant === "square"
                  ? "h-24 w-24 object-cover"
                  : "h-40 w-full object-cover"
              }
            />
          ) : (
            fileMeta && (
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <span
                  className={`inline-flex min-w-0 items-center gap-2 truncate rounded-full border px-3 py-1 text-xs ${chip}`}
                >
                  <FileUp className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{fileMeta}</span>
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className={`shrink-0 text-xs underline-offset-4 hover:underline ${muted}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
      {showingFallback && fallbackNote ? (
        <p className={`mt-1 text-xs ${muted}`}>{fallbackNote}</p>
      ) : (
        helper && <p className={`mt-1 text-xs ${muted}`}>{helper}</p>
      )}

      {behavior === "upload" && name && (
        <input type="hidden" name={name} value={value} />
      )}

      {showUrlInput ? (
        <input
          id={id}
          type="url"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value);
            setPreviewUrl(e.target.value || fallbackPreview || "");
            setPreviewIsImage(true);
          }}
          placeholder="https://..."
          className={`mt-2 w-full rounded-xl border px-4 py-3 placeholder:text-sm focus:outline-none focus:ring-2 ${inputClass}`}
        />
      ) : (
        <div className="mt-2">
          <label
            htmlFor={`${id}-file`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm transition ${dropzone}`}
          >
            {behavior === "upload" ? (
              <ImagePlus
                className={`h-5 w-5 ${tone === "dark" ? "text-purple-300" : "text-zinc-400"}`}
              />
            ) : (
              <FileUp
                className={`h-5 w-5 ${tone === "dark" ? "text-purple-300" : "text-zinc-400"}`}
              />
            )}
            {fileMeta && behavior === "select"
              ? fileMeta
              : `Choose a file or drag and drop (${acceptHint}, max ${formatBytes(maxBytes)})`}
          </label>
          <input
            ref={fileInputRef}
            id={`${id}-file`}
            type="file"
            name={behavior === "select" ? name : undefined}
            accept={accept}
            required={required && behavior === "select"}
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={disabled || uploading}
          />
          {behavior === "upload" && progress !== null && (
            <div className="mt-2">
              <div
                className={`h-2 overflow-hidden rounded-full ${tone === "dark" ? "bg-white/5" : "bg-zinc-200"}`}
              >
                <div
                  className="h-full rounded-full bg-purple-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className={`mt-1 flex items-center gap-1.5 text-xs ${muted}`}>
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
