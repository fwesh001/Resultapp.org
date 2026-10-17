"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { PasswordToggle } from "@/components/ui/PasswordField";
import { Button } from "@/components/ui/Button";

interface Props {
  tenantId: string;
  loginHref: string;
}

/**
 * One-time admin password setup for legacy schools whose
 * `admin_password_hash` is NULL. Posts to /api/admin/set-password,
 * which the backend only allows while no hash exists.
 */
export default function AdminSetupForm({ tenantId, loginHref }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [confirm, setConfirm] = useState("");
const [showPassword, setShowPassword] = useState(false);
const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password || !confirm) {
      setError("Email and a new password (entered twice) are required");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, email: email.trim(), newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string })?.error || `Could not set password (${res.status})`);
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set password");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 rounded-xl border border-success/30 bg-success-soft p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Admin password set. You can now sign in.</span>
        </div>
        <a
          href={loginHref}
          className="block w-full rounded-full bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
        >
          Go to Admin Sign In →
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Admin Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="admin@school.edu"
        autoComplete="username"
        required
        disabled={loading}
      />
      <Input
        label="New Password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Minimum 8 characters"
        autoComplete="new-password"
        required
        disabled={loading}
        trailing={
          <PasswordToggle
            label="new password"
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        }
      />
      <Input
        label="Confirm New Password"
        type={showConfirm ? "text" : "password"}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Repeat your password"
        autoComplete="new-password"
        required
        disabled={loading}
        trailing={
          <PasswordToggle
            label="confirmed password"
            visible={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
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
            <Loader2 className="h-4 w-4 animate-spin" /> Setting password…
          </>
        ) : (
          <>
            <KeyRound className="h-4 w-4" /> Set Admin Password
          </>
        )}
      </Button>
    </form>
  );
}
