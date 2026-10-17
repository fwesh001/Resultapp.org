"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordToggle } from "@/components/ui/PasswordField";

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
const [showCurrent, setShowCurrent] = useState(false);
const [showNew, setShowNew] = useState(false);
const [showConfirm, setShowConfirm] = useState(false);
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
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-success/30 bg-success-soft">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-success" aria-hidden="true">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-4 text-base font-semibold text-text-1">Password updated</h2>
        <p className="mt-1 text-sm text-text-3">
          Use it the next time you sign in. Keep it somewhere only you know.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="currentPassword" className="block text-xs font-medium text-text-2">
            Current password
          </label>
          <div className="relative mt-1.5">
            <input
              id="currentPassword"
              type={showCurrent ? "text" : "password"}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full rounded-xl border border-line-1 bg-surface-3 px-3.5 py-2.5 pr-11 text-sm text-text-1 outline-none transition placeholder:text-text-3 focus:border-accent/60"
            />
            <div className="absolute inset-y-0 right-0">
              <PasswordToggle
                label="current password"
                visible={showCurrent}
                onToggle={() => setShowCurrent((v) => !v)}
              />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="newPassword" className="block text-xs font-medium text-text-2">
            New password
          </label>
          <div className="relative mt-1.5">
            <input
              id="newPassword"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD}
              className="w-full rounded-xl border border-line-1 bg-surface-3 px-3.5 py-2.5 pr-11 text-sm text-text-1 outline-none transition placeholder:text-text-3 focus:border-accent/60"
            />
            <div className="absolute inset-y-0 right-0">
              <PasswordToggle
                label="new password"
                visible={showNew}
                onToggle={() => setShowNew((v) => !v)}
              />
            </div>
          </div>
          <p className="mt-1 text-[0.7rem] text-text-3">
            At least {MIN_PASSWORD} characters.
          </p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-xs font-medium text-text-2">
            Confirm new password
          </label>
          <div className="relative mt-1.5">
            <input
              id="confirmPassword"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD}
              className="w-full rounded-xl border border-line-1 bg-surface-3 px-3.5 py-2.5 pr-11 text-sm text-text-1 outline-none transition placeholder:text-text-3 focus:border-accent/60"
            />
            <div className="absolute inset-y-0 right-0">
              <PasswordToggle
                label="confirmed password"
                visible={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
              />
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}