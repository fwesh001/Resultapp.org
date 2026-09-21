"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Lock, User } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

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
  setupLinkLabel = "Set up your admin password",
}: SignInFormProps) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);

    if (!identifier.trim() || !password.trim()) {
      setError(requiredErrorMessage);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, identifier: identifier.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCode((data as { code?: string })?.code ?? null);
        throw new Error((data as { error?: string })?.error || `Login failed (${res.status})`);
      }
      router.push(redirectTo ?? `/${tenantId}/staff`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
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
      <Input
        label={passwordLabel}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••"
        autoComplete="current-password"
        required
        disabled={loading}
      />

      {error && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white hover:bg-purple-500 disabled:opacity-60"
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

      <div className="flex items-center justify-center gap-1.5 text-xs text-purple-300/40">
        <User className="h-3 w-3" /> {footerHint}
      </div>
    </form>
  );
}
