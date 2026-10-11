"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  tenantId: string;
}

/** Mirrors the backend's 6-character minimum so the error is immediate. */
const MIN_PASSWORD = 6;

/**
 * Password change form.
 *
 * The current password is required by design: on a shared family device, a
 * left-open session must not be enough to reassign the account to whoever finds
 * it next. The backend re-verifies it; this only checks the obvious client-side
 * rules so a mistyped password does not cost a round trip.
 *
 * The student_id is NOT part of this payload — the proxy reads it from the
 * signed session cookie, so a student cannot change someone else's password by
 * editing the request.
 */
export default function PasswordChangeForm({ tenantId }: Props) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < MIN_PASSWORD) {
      setError(`New password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The two new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must differ from your current one.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/student/password?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };

      if (!res.ok || !data.success) {
        setError(data.error || "Could not change your password. Please try again.");
        setBusy(false);
        return;
      }

      setDone(true);
      setBusy(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // The layout reads must_change_password from the cookie, so a refresh is
      // required for the banner to disappear.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-emerald-300" aria-hidden="true">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-4 text-base font-semibold text-white">Password updated</h2>
        <p className="mt-1 text-sm text-purple-200/60">
          Use it the next time you sign in. Keep it somewhere only you know.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="currentPassword" className="block text-xs font-medium text-purple-200/80">
            Current password
          </label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="mt-1.5 w-full rounded-xl border border-purple-500/25 bg-purple-950/40 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-purple-300/30 focus:border-purple-400/60"
          />
        </div>

        <div>
          <label htmlFor="newPassword" className="block text-xs font-medium text-purple-200/80">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD}
            className="mt-1.5 w-full rounded-xl border border-purple-500/25 bg-purple-950/40 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-purple-300/30 focus:border-purple-400/60"
          />
          <p className="mt-1 text-[0.7rem] text-purple-300/50">
            At least {MIN_PASSWORD} characters.
          </p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-xs font-medium text-purple-200/80">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD}
            className="mt-1.5 w-full rounded-xl border border-purple-500/25 bg-purple-950/40 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-purple-300/30 focus:border-purple-400/60"
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-xl bg-purple-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-400 disabled:opacity-50"
      >
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}