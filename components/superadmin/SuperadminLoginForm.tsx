"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Lock } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

/** Platform sign-in — per-user email+password, or legacy env password when email is blank. */
export default function SuperadminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError("Password is required");
      return;
    }
    setLoading(true);
    try {
      // Email present → per-user platform login; blank → legacy env fallback.
      const body = email.trim()
        ? { email: email.trim().toLowerCase(), password }
        : { password };
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string })?.error || `Login failed (${res.status})`);
      }
      router.push("/superadmin");
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
        label="Email (optional — per-user sign in)"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@resultapp.org"
        autoComplete="username"
        disabled={loading}
      />
      <Input
        label={email.trim() ? "Password" : "Superadmin Password"}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
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
