"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { PasswordField } from "@/components/ui/PasswordField";
import { toast } from "@/components/ui/toast";

interface Props {
  tenantId: string;
}

/** Mirrors backend/routers/staff_auth.py MIN_STAFF_PASSWORD so the error is immediate. */
const MIN_PASSWORD = 6;

/**
 * Staff change-password card, shown on the profile page.
 *
 * The current password is required on purpose: staff portals run on shared
 * machines in a staff room, and a left-open session must not be enough to
 * reassign the account to whoever finds it next. The backend re-verifies it;
 * this only short-circuits the obvious mistakes so they do not cost a round trip.
 *
 * The staff_id is NOT part of the payload — /api/staff/password reads it from
 * the signed staff_session cookie, so a staff member cannot change someone
 * else's password by editing the request.
 */
export default function StaffPasswordCard({ tenantId }: Props) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("The two new passwords do not match.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (newPassword === currentPassword) {
      setError("The new password must be different from the current one.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/staff/password?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (!res.ok || !data.success) {
        setError(data.error || "Could not change your password. Please try again.");
        setBusy(false);
        return;
      }

      // Clear every field. Leaving the new password in a DOM node is a way for
      // it to end up in a screenshot or a shared-password-manager autofill.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setBusy(false);
      toast.success("Password changed.", {
        description: "Use your new password the next time you sign in.",
      });

      // The dashboard layout reads must_change_password from the live dashboard
      // payload, so a refresh is what makes the banner disappear.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line-1 bg-surface-1 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text-1">
        <KeyRound className="h-4 w-4 text-accent" /> Password
      </h2>
      <p className="mt-1 text-xs text-text-3">
        Your staff account starts on a shared default. Set a password only you know.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-4 max-w-sm">
        <div className="space-y-3">
          <PasswordField
            id="staff-current-password"
            label="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            disabled={busy}
          />
          <PasswordField
            id="staff-new-password"
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={MIN_PASSWORD}
            required
            disabled={busy}
            hint={`At least ${MIN_PASSWORD} characters.`}
          />
          <PasswordField
            id="staff-confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={MIN_PASSWORD}
            required
            disabled={busy}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Updating…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
