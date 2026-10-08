"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailCheck, ShieldAlert } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";

type Phase = "verifying" | "success" | "invalid";

/**
 * The verification token arrives in the query string, so this component reads
 * useSearchParams() and must live inside a Suspense boundary or the static
 * prerender of /verify-email fails. See app/reset-password/page.tsx.
 */
function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [message, setMessage] = useState<string>("");
  const [canResend, setCanResend] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  // Guards against React 18 StrictMode double-invoking the effect, which would
  // consume the single-use token on the first pass and fail the second.
  const fired = useRef(false);

  const token = searchParams.get("token") ?? "";
  const email = searchParams.get("email") ?? "";

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    let cancelled = false;
    // Deferred a microtask so even the malformed-link branch is not a
    // synchronous setState inside the effect body.
    Promise.resolve().then(async () => {
      if (cancelled) return;

      if (!token || !email) {
        setPhase("invalid");
        setMessage("This link is missing its verification details. Request a new one below.");
        setCanResend(true);
        return;
      }

      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data?.verified) {
          setPhase("success");
          setMessage("Your email is verified. You can now sign in to your portal.");
        } else {
          setPhase("invalid");
          setMessage(
            data?.message ?? "This verification link is invalid or has expired.",
          );
          setCanResend(true);
        }
      } catch {
        if (cancelled) return;
        setPhase("invalid");
        setMessage("We could not reach the verification service. Try again shortly.");
        setCanResend(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token, email]);

  async function handleResend() {
    if (!email || resending) return;
    setResending(true);
    try {
      const res = await fetch("/api/auth/request-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("send failed");
      // The response is intentionally identical whether or not the account
      // exists, so we must not claim it was sent.
      setResent(true);
      setCanResend(false);
    } catch {
      setMessage("We could not send a new link just now. Please try again shortly.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Email verification"
      subtitle={
        phase === "verifying"
          ? "Confirming your email address…"
          : undefined
      }
      footer={
        <Link href="/login" className="underline underline-offset-4 hover:text-white">
          Back to sign in
        </Link>
      }
    >
      {phase === "verifying" && (
        <div className="flex items-center gap-3 text-sm text-purple-200/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying your link…
        </div>
      )}

      {phase === "success" && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            <p className="text-sm leading-6 text-emerald-100">{message}</p>
          </div>
          <Link
            href="/login"
            className="flex w-full items-center justify-center rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-purple-500"
          >
            Continue to sign in
          </Link>
        </div>
      )}

      {phase === "invalid" && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <p className="text-sm leading-6 text-amber-100">{message}</p>
          </div>

          {resent ? (
            <div className="flex items-start gap-3 rounded-xl border border-purple-500/20 bg-purple-900/20 p-3">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-purple-300" />
              <p className="text-xs leading-5 text-purple-200/70">
                If that address has an account, a fresh link is on its way.
                <strong className="font-semibold text-purple-100"> Check your spam folder</strong> — it may
                land in Promotions or Junk while we send from a personal address.
              </p>
            </div>
          ) : canResend ? (
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={resending}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:opacity-60"
            >
              {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send a new verification link
            </button>
          ) : null}

          <p className="text-center text-xs text-purple-300/40">
            Links expire after 24 hours and can only be used once.
          </p>
        </div>
      )}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <AuthShell title="Email verification">
          <div className="flex items-center gap-3 text-sm text-purple-200/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying your link…
          </div>
        </AuthShell>
      }
    >
      <VerifyEmailForm />
    </Suspense>
  );
}
