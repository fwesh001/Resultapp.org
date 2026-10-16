"use client";

import { useState } from "react";
import { KeyRound, Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { toast } from "@/components/ui/toast";

/**
 * Password change for the school's admin account.
 *
 * Lives in Settings rather than on its own page because "who can get in" and
 * "what does the portal look like" are the same question at different times,
 * and an admin changing a password has usually just realised it is stale.
 *
 * The current password is required even though the caller is already
 * authenticated. That is deliberate: an unattended logged-in session (a shared
 * office machine, a borrowed laptop) is exactly the situation where someone
 * else is watching, and requiring the old password turns a hijacked session
 * into a dead end instead of a silent credential change.
 */

interface PasswordChangeProps {
  subdomain: string;
}

export default function PasswordChange({ subdomain }: PasswordChangeProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  // One flag per field, not one for the form.
  //
  // This used to be a single `show` driving all three inputs, with the button
  // rendered only inside the current-password field. So revealing the current
  // password also revealed the new one and its confirmation — which defeats the
  // point of the confirmation box, whose whole job is to let you check a value
  // you have not seen yet.
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);

    // Validate here rather than letting the server be the first place these
    // are noticed: a round trip to learn your passwords differ is a poor way
    // to learn they differ.
    if (next !== confirm) {
      setError("The new password and its confirmation do not match.");
      return;
    }
    if (next.length < 8) {
      setError("Choose a password of at least 8 characters.");
      return;
    }
    if (next === current) {
      setError("The new password must be different from the current one.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain, current_password: current, new_password: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Could not change the password.");
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
      toast.success(data.message || "Password changed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-line-1 bg-surface-0 px-4 py-3 text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50";

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-line-1 bg-surface-1 p-4 sm:p-5"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-text-1">Admin password</h3>
      </div>
      <p className="mt-1 text-xs text-text-3">
        This is the password for the school&apos;s admin login. Staff have their
        own PINs, managed from the Command Center.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-success/40 bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Password updated.
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="pw-current" className="block text-sm font-medium text-text-2">
            Current password
          </label>
          <div className="relative">
            <input
              id="pw-current"
              name="current_password"
              type={showCurrent ? "text" : "password"}
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              className={`${inputClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              aria-label={showCurrent ? "Hide current password" : "Show current password"}
              aria-pressed={showCurrent}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-text-3 transition hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              {showCurrent ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="pw-new" className="block text-sm font-medium text-text-2">
            New password
          </label>
          <div className="relative">
            <input
              id="pw-new"
              name="new_password"
              type={showNext ? "text" : "password"}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              placeholder="At least 8 characters"
              className={`${inputClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowNext((v) => !v)}
              aria-label={showNext ? "Hide new password" : "Show new password"}
              aria-pressed={showNext}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-text-3 transition hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              {showNext ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="pw-confirm" className="block text-sm font-medium text-text-2">
            Confirm new password
          </label>
          <div className="relative">
            <input
              id="pw-confirm"
              name="confirm_password"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className={`${inputClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              aria-label={showConfirm ? "Hide confirmed password" : "Show confirmed password"}
              aria-pressed={showConfirm}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-text-3 transition hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              {showConfirm ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-semibold text-accent-fg transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {busy ? "Updating…" : "Change password"}
      </button>
    </form>
  );
}
