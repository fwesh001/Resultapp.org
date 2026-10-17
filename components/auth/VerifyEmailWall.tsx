"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, MailCheck, Send } from "lucide-react";

/**
 * Soft-login verification interstitial.
 *
 * Shown after a successful sign-in when the backend reports
 * `email_verified: false`. It is deliberately NOT a hard block — the session
 * is already valid and the user can proceed — because the schema migration
 * backfilled every pre-existing account as verified, so this only ever appears
 * for genuinely new signups. Hard-blocking would risk stranding a real admin
 * whose verification mail went to spam.
 *
 * The spam-folder note is prominent on purpose: until resultapp.org is
 * purchased we send from a personal address, so the message frequently lands
 * in Promotions/Junk.
 */
export function VerifyEmailWall({
  email,
  scope = "schools",
  onContinue,
}: {
  email: string;
  /** "schools" for tenant admins, "platform_admins" for superadmin. */
  scope?: "schools" | "platform_admins";
  onContinue: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    if (!email || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/request-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, scope }),
      });
      if (!res.ok) throw new Error("send failed");
      // Backend returns the same 200 for unknown addresses, so we must not
      // claim "we emailed you" as a verified fact.
      setSent(true);
    } catch {
      setError("We could not send a new link just now. Please try again shortly.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div>
          <p className="text-sm font-semibold text-warning">
            Your email address isn&apos;t verified yet
          </p>
          <p className="mt-1 text-xs leading-5 text-warning/70">
            You can carry on and use your portal now. Verifying just secures password
            resets and gives you a recovery email if you get locked out.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-line-2 bg-surface-2 p-3">
        <p className="text-xs text-text-3">
          We sent a verification link to{" "}
          <span className="font-mono text-text-2">{email || "your address"}</span>.
        </p>
      </div>

      {/* Prominent on purpose — see the component docblock. */}
      <p className="text-xs leading-5 text-text-2">
        <strong className="font-semibold text-text-2">Check your spam folder.</strong>{" "}
        While resultapp.org is being set up we send from a personal address, so the message often
        lands in Promotions or Junk.
      </p>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-xs text-danger">
          {error}
        </p>
      )}

      {sent ? (
        <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-soft p-3">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p className="text-xs leading-5 text-success">
            If that address has an account, a fresh link is on its way.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={sending}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-line-1 bg-surface-2 px-6 py-2.5 text-sm font-medium text-text-2 transition hover:bg-surface-3 disabled:opacity-60"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Resend verification email
        </button>
      )}

      <button
        type="button"
        onClick={onContinue}
        className="w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
      >
        Continue to my portal
      </button>
    </div>
  );
}
