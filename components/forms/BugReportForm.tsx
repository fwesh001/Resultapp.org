"use client";

import { useState } from "react";
import { Bug, CheckCircle2 } from "lucide-react";
import UploadField from "@/components/ui/UploadField";

export function BugReportForm() {
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-400" />
        <h3 className="mt-3 text-lg font-semibold text-white">Bug reported!</h3>
        <p className="mt-1 text-sm text-purple-200/60">Thanks — our team will investigate.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-purple-500/15 bg-purple-900/10 p-6 backdrop-blur">
      <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200">
        <Bug className="h-3.5 w-3.5" /> Bug Report
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-purple-100">What happened?</label>
        <textarea
          required
          rows={3}
          placeholder="Describe the issue you encountered..."
          className="flex min-h-[96px] w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-purple-100">What did you expect to happen?</label>
        <textarea
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

      <button
        type="submit"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.35)] hover:bg-purple-500 animate-pulse hover:animate-none"
      >
        Submit Bug Report
      </button>
    </form>
  );
}
