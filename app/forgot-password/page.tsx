"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, MailCheck, Send } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setError("Enter the email address on your account.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not send the reset email");
      // Deliberately NOT revealing whether the address exists.
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset email");
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your account email and we’ll send you a link to choose a new password."
      footer={
        <Link href="/login" className="underline underline-offset-4 hover:text-text-1">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft p-3">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <p className="text-sm leading-6 text-success">
              If that address has a ResultApp account, a reset link is on its way.
            </p>
          </div>
          <p className="text-xs leading-5 text-text-3">
            <strong className="font-semibold text-text-2">Check your spam folder</strong> — the
            message may land in Promotions or Junk while we send from a personal address. The link expires
            in 1 hour.
          </p>
          <button
            type="button"
            onClick={() => {
              setDone(false);
              setEmail("");
            }}
            className="w-full rounded-full border border-line-1 bg-transparent px-6 py-3 text-sm font-medium text-text-2 transition hover:bg-surface-2"
          >
            Try a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fp-email" className="text-sm font-medium text-text-2">
              Account email
            </label>
            <input
              id="fp-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu.ng"
              className="flex h-10 w-full rounded-xl border border-line-1 bg-surface-3 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          {error && (
            <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={sending}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send reset link
          </button>

          <p className="text-xs leading-5 text-text-3">
            We’ll send the same confirmation whether or not the address is registered, so this page
            can’t be used to find which emails exist.
          </p>
        </form>
      )}
    </AuthShell>
  );
}
