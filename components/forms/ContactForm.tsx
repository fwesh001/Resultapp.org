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
      <div className="flex flex-col items-center justify-center rounded-2xl border border-success/30 bg-success-soft p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-success" />
        <h3 className="mt-3 text-lg font-semibold text-text-1">Message sent!</h3>
        <p className="mt-1 text-sm text-text-3">We’ll reply via email within a few hours.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-line-1 bg-surface-1 p-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-name" className="text-sm font-medium text-text-2">Your Name</label>
        <input
          id="contact-name"
          name="name"
          required
          placeholder="Adaeze Okafor"
          autoComplete="name"
          className="flex h-10 w-full rounded-xl border border-line-1 bg-surface-3 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-school" className="text-sm font-medium text-text-2">School Name</label>
        <input
          id="contact-school"
          name="school"
          required
          placeholder="Victory High School"
          autoComplete="organization"
          className="flex h-10 w-full rounded-xl border border-line-1 bg-surface-3 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-message" className="text-sm font-medium text-text-2">Message</label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={4}
          placeholder="How can we help you?"
          className="flex min-h-[120px] w-full rounded-xl border border-line-1 bg-surface-3 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-fg shadow-[0_0_28px_rgba(147,51,234,0.35)] transition hover:bg-accent-hover hover:shadow-[0_0_36px_rgba(147,51,234,0.5)] motion-safe:animate-pulse hover:motion-safe:animate-none"
      >
        <Send className="h-4 w-4" /> Send Message
      </button>
    </form>
  );
}
