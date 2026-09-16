"use client";

import { useState } from "react";
import { Send, CheckCircle2 } from "lucide-react";

export function ContactForm() {
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
        <h3 className="mt-3 text-lg font-semibold text-white">Message sent!</h3>
        <p className="mt-1 text-sm text-purple-200/60">We’ll reply via email within a few hours.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-purple-500/15 bg-purple-900/10 p-6 backdrop-blur">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-purple-100">Your Name</label>
        <input
          required
          placeholder="Adaeze Okafor"
          className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-purple-100">School Name</label>
        <input
          required
          placeholder="Victory High School"
          className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-purple-100">Message</label>
        <textarea
          required
          rows={4}
          placeholder="How can we help you?"
          className="flex min-h-[120px] w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.35)] transition hover:bg-purple-500 hover:shadow-[0_0_36px_rgba(147,51,234,0.5)] animate-pulse hover:animate-none"
      >
        <Send className="h-4 w-4" /> Send Message
      </button>
    </form>
  );
}
