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
  const [show, setShow] = useState(false);
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
    "mt-2 w-full rounded-xl border border-purple-500/20 bg-[#0B0514] px-4 py-3 text-white placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50";

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 sm:p-5"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-purple-300" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-white">Admin password</h3>
      </div>
      <p className="mt-1 text-xs text-purple-300/50">
        This is the password for the school&apos;s admin login. Staff have their
        own PINs, managed from the Command Center.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Password updated.
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="pw-current" className="block text-sm font-medium text-purple-200">
            Current password
          </label>
          <div className="relative">
            <input
              id="pw-current"
              name="current_password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              className={`${inputClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide passwords" : "Show passwords"}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-2.5 text-purple-300/50 transition hover:text-purple-200"
            >
              {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="pw-new" className="block text-sm font-medium text-purple-200">
            New password
          </label>
          <input
            id="pw-new"
            name="new_password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
            placeholder="At least 8 characters"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="pw-confirm" className="block text-sm font-medium text-purple-200">
            Confirm new password
          </label>
          <input
            id="pw-confirm"
            name="confirm_password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className={inputClass}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {busy ? "Updating…" : "Change password"}
      </button>
    </form>
  );
}
