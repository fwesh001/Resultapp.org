"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";

type LinkState = "checking" | "valid" | "expired" | "invalid";

/**
 * The reset token arrives in the query string, so this component reads
 * useSearchParams(). That forces a client-side bailout and therefore must sit
 * inside a Suspense boundary or the static prerender of /reset-password fails.
 * (This page previously relied on the app-wide app/loading.tsx, which was
 * removed so the tenant landing page could return a real 404.)
 */
function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // StrictMode would otherwise fire the pre-flight twice; harmless here (it
  // does not consume the token) but wasteful.
  const checked = useRef(false);

  const token = searchParams.get("token") ?? "";
  const email = searchParams.get("email") ?? "";

  // Pre-flight so an expired link is rejected BEFORE the user types a new
  // password, rather than after.
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    let cancelled = false;
    // Deferred a microtask so the malformed-link branch is not a synchronous
    // setState inside the effect body.
    Promise.resolve().then(async () => {
      if (cancelled) return;
      if (!token || !email) {
        setLinkState("invalid");
        return;
      }
      try {
        const res = await fetch("/api/auth/check-reset-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setLinkState(data?.valid ? "valid" : data?.expired ? "expired" : "invalid");
      } catch {
        if (!cancelled) setLinkState("invalid");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, email]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not reset your password");
      if (!data?.reset) {
        throw new Error(data?.message || "This reset link is invalid or has expired.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password");
    } finally {
      setSaving(false);
    }
  }

  const blocked = linkState === "expired" || linkState === "invalid";

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={
        linkState === "valid" && !done
          ? "Pick something you haven’t used before. You’ll stay signed out everywhere else."
          : undefined
      }
      footer={
        <Link href="/login" className="underline underline-offset-4 hover:text-white">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
          <div>
            <p className="text-sm leading-6 text-emerald-100">
              Password updated. Your email address is now verified too.
            </p>
            <Link
              href="/login"
              className="mt-3 flex w-full items-center justify-center rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-purple-500"
            >
              Sign in
            </Link>
          </div>
        </div>
      ) : linkState === "checking" ? (
        <div className="flex items-center gap-3 text-sm text-purple-200/70">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your link…
        </div>
      ) : blocked ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <p className="text-sm leading-6 text-amber-100">
              {linkState === "expired"
                ? "This reset link has expired. Reset links last 1 hour."
                : "This reset link is invalid or has already been used."}
            </p>
          </div>
          <Link
            href="/forgot-password"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-purple-500"
          >
            <KeyRound className="h-4 w-4" /> Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rp-pass" className="text-sm font-medium text-purple-100">
              New password
            </label>
            <input
              id="rp-pass"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="rp-confirm" className="text-sm font-medium text-purple-100">
              Confirm new password
            </label>
            <input
              id="rp-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            />
          </div>

          {error && (
            <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Update password
          </button>

          <p className="text-xs text-purple-300/40">
            This link works once and expires in 1 hour.
          </p>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthShell title="Choose a new password">
          <div className="flex items-center gap-3 text-sm text-purple-200/70">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your link…
          </div>
        </AuthShell>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
