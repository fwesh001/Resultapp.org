"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Lock } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { PasswordToggle } from "@/components/ui/PasswordField";
import { Button } from "@/components/ui/Button";
import { VerifyEmailWall } from "@/components/auth/VerifyEmailWall";

/** Platform sign-in — per-user email+password. */
export default function SuperadminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Soft-login gate. Only applies to the per-user path — the legacy env
  // password has no account row behind it, so there is nothing to verify.
  const [unverified, setUnverified] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      // The legacy env-password path was retired in production with page
      // allocation: an identity-less session has no role and no scope.
      setError("Platform admin email is required");
      return;
    }
    if (!password) {
      setError("Password is required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string })?.error || `Login failed (${res.status})`);
      }
      // Session cookie is already set by the proxy; only navigation is held
      // back, so this is a soft login rather than a block.
      const verified = (data as { email_verified?: boolean })?.email_verified;
      if (email.trim() && verified === false) {
        setUnverified(email.trim().toLowerCase());
        return;
      }
      router.push("/superadmin");
      router.refresh();
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
        scope="platform_admins"
        onContinue={() => {
          router.push("/superadmin");
          router.refresh();
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Platform admin email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@resultapp.org"
        autoComplete="username"
        disabled={loading}
        required
      />
      <Input
        label="Password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        autoComplete="current-password"
        required
        disabled={loading}
        trailing={
          <PasswordToggle
            label="password"
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        }
      />
      {error && (
        <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
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
            <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
          </>
        ) : (
          <>
            <Lock className="h-4 w-4" /> Sign In
          </>
        )}
      </Button>
    </form>
  );
}
