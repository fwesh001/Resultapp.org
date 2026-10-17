"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Lock, User } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { PasswordToggle } from "@/components/ui/PasswordField";
import { Button } from "@/components/ui/Button";
import { VerifyEmailWall } from "@/components/auth/VerifyEmailWall";

export interface SignInFormProps {
  tenantId: string;
  /** API endpoint to POST { tenantId, identifier, password } to. Defaults to staff login. */
  endpoint?: string;
  /** Where to navigate on success. Defaults to `/{tenantId}/staff`. */
  redirectTo?: string;
  identifierLabel?: string;
  identifierPlaceholder?: string;
  passwordLabel?: string;
  submitLabel?: string;
  signingInLabel?: string;
  footerHint?: string;
  requiredErrorMessage?: string;
  /** When the backend reports PASSWORD_NOT_SET, show a setup link to this href. */
  setupHref?: string;
  setupLinkLabel?: string;
  /**
   * Opt-in transform applied to `identifier` immediately before submit.
   *
   * This form is SHARED by admin, staff and root sign-in, and those do NOT all
   * want the same treatment: admin/root identify by email and must never be
   * rewritten. Staff are the only caller that needs bare-number expansion, so
   * the behaviour is opt-in and off by default. Adding prefixing here
   * unconditionally would corrupt admin email logins.
   *
   * Implementations must be conservative — see lib/identityPrefix.
   */
  transformIdentifier?: (raw: string) => string;
  /** Hint shown under the identifier field when a transform is active. */
  identifierHint?: string;
  /**
   * Show the soft-login verification wall when the login response reports
   * `email_verified: false`. Leave undefined to disable (staff sign-in, where
   * accounts have no email requirement).
   */
  showVerifyWall?: boolean;
}

/**
 * Reusable sign-in form template for Admin & Staff portals.
 * Thin role-specific wrappers should pass `endpoint` + `redirectTo`.
 */
export default function SignInForm({
  tenantId,
  endpoint = "/api/staff/login",
  redirectTo,
  identifierLabel = "Staff ID or Email",
  identifierPlaceholder = "e.g., STF001 or staff@school.edu",
  passwordLabel = "PIN / Password",
  submitLabel = "Sign In",
  signingInLabel = "Signing in…",
footerHint = "Dual-login: Staff ID or Email + PIN",
  requiredErrorMessage = "Staff ID or Email and PIN are required",
  setupHref,
  setupLinkLabel,
  transformIdentifier,
  identifierHint,
  showVerifyWall = false,
}: SignInFormProps) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Soft-login gate: when the backend reports an unverified email we hold the
  // user here rather than pushing them straight to the portal.
  const [unverified, setUnverified] = useState<string | null>(null);

  function enterPortal() {
    router.push(redirectTo ?? `/${tenantId}/staff`);
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setUnverified(null);

    const rawIdentifier = identifier.trim();
    if (!rawIdentifier || !password.trim()) {
      setError(requiredErrorMessage);
      return;
    }

    // Expand a bare "001" into the stored "staff/001" — but only when the
    // caller opted in (staff only; admin/root identify by email and must not
    // be rewritten). See SignInFormProps.transformIdentifier.
    const sendIdentifier = transformIdentifier
      ? transformIdentifier(rawIdentifier)
      : rawIdentifier;

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, identifier: sendIdentifier, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCode((data as { code?: string })?.code ?? null);
        throw new Error((data as { error?: string })?.error || `Login failed (${res.status})`);
      }
      // The session cookie is already set by the proxy. Only the *navigation*
      // is held back, which is what makes this a soft login rather than a block.
      const verified = (data as { email_verified?: boolean })?.email_verified;
      if (showVerifyWall && verified === false) {
        const adminEmail =
          (data as { admin?: { email?: string } })?.admin?.email || rawIdentifier;
        setUnverified(adminEmail);
        return;
      }
      enterPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  if (unverified !== null) {
    return (
      <VerifyEmailWall
        email={unverified}
        scope="schools"
        onContinue={enterPortal}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label={identifierLabel}
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        placeholder={identifierPlaceholder}
        autoComplete="username"
        required
        disabled={loading}
      />
      {identifierHint && (
        <p className="-mt-2 text-xs text-text-3">{identifierHint}</p>
      )}
      <Input
        label={passwordLabel}
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••"
        autoComplete="current-password"
        required
        disabled={loading}
        trailing={
          <PasswordToggle
            label={passwordLabel}
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        }
      />

      {error && (
        <div
          className={
            errorCode === "PASSWORD_NOT_SET"
              ? "rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
              : "flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
          }
        >
          <div className="flex gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          {errorCode === "PASSWORD_NOT_SET" && setupHref && (
            <a
              href={setupHref}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1.5 text-xs font-semibold text-warning transition hover:bg-warning-soft"
            >
              {setupLinkLabel} →
            </a>
          )}
        </div>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="w-full gap-2 rounded-full bg-accent font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        size="lg"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {signingInLabel}
          </>
        ) : (
          <>
            <Lock className="h-4 w-4" /> {submitLabel}
          </>
        )}
      </Button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-text-3">
        <User className="h-3 w-3" /> {footerHint}
      </div>
    </form>
  );
}
