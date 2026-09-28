"use client";

import { useState } from "react";
import { Bug, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import UploadField from "@/components/ui/UploadField";

type Status = "idle" | "submitting" | "sent";

export function BugReportForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus("submitting");

    const form = new FormData(e.currentTarget);
    const screenshot = String(form.get("screenshot_url") ?? "").trim();

    const body = {
      type: "bug",
      email: String(form.get("email") ?? "").trim(),
      payload: {
        what: String(form.get("what") ?? "").trim(),
        expected: String(form.get("expected") ?? "").trim(),
        // Empty string when nothing was attached; the backend stores null-ish.
        ...(screenshot ? { screenshot_url: screenshot } : {}),
      },
    };

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your report");
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-400" />
        <h3 className="mt-3 text-lg font-semibold text-white">Bug reported!</h3>
        <p className="mt-1 text-sm text-purple-200/60">Thanks — our team will investigate.</p>
      </div>
    );
  }

  const submitting = status === "submitting";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-purple-500/15 bg-purple-900/10 p-6 backdrop-blur">
      <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200">
        <Bug className="h-3.5 w-3.5" /> Bug Report
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bug-what" className="text-sm font-medium text-purple-100">What happened?</label>
        <textarea
          id="bug-what"
          name="what"
          required
          rows={3}
          placeholder="Describe the issue you encountered..."
          className="flex min-h-[96px] w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bug-expected" className="text-sm font-medium text-purple-100">What did you expect to happen?</label>
        <textarea
          id="bug-expected"
          name="expected"
          required
          rows={3}
          placeholder="What should have happened instead?"
          className="flex min-h-[96px] w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <UploadField
          id="bug-screenshot"
          label="Screenshot or file (optional)"
          name="screenshot_url"
          allowUrl={false}
          accept="image/*,.pdf"
          extraFields={{ subdomain: "shared", kind: "bug-report" }}
          helper="PNG, JPG, PDF up to 5MB"
          preview="image"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bug-email" className="text-sm font-medium text-purple-100">
          Your email <span className="font-normal text-purple-300/50">(optional, for follow-up)</span>
        </label>
        <input
          id="bug-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@school.org"
          className="w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.35)] hover:bg-purple-500 motion-safe:animate-pulse hover:motion-safe:animate-none disabled:cursor-not-allowed disabled:opacity-60 disabled:motion-safe:animate-none"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bug className="h-4 w-4" />}
        {submitting ? "Submitting…" : "Submit Bug Report"}
      </button>
    </form>
  );
}
