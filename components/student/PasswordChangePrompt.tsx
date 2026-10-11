"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, X } from "lucide-react";

interface Props {
  subdomain: string;
}

/**
 * Soft "please change your password" banner.
 *
 * Deliberately NOT a redirect and NOT a modal. Every account starts on the
 * shared default 123456, so this fires for essentially every student on first
 * sign-in. A hard gate would mean the child who opens the portal on the shared
 * family phone is stuck staring at a password form instead of the result their
 * parent actually asked about — and dismissing here costs nothing, because the
 * server-side check is advisory, not an authorization condition.
 *
 * Dismissal is remembered per tenant+browser so the banner does not reappear on
 * every navigation. It is NOT remembered server-side: changing the password is
 * what clears the real flag, and pretending dismissal is equivalent would let a
 * student hide the warning indefinitely without fixing anything.
 */
export default function PasswordChangePrompt({ subdomain }: Props) {
  const storageKey = `resultapp:dismissed-default-pw:${subdomain}`;
  const [dismissed, setDismissed] = useState(true);
  const [ready, setReady] = useState(false);

  // Read localStorage in an effect, not during render: reading it inline causes
  // a hydration mismatch, because the server has no access to it and would
  // always render the banner.
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // Private mode / storage disabled: show the banner every time rather than
      // crashing. Annoying is strictly better than blank.
      setDismissed(false);
    }
    setReady(true);
  }, [storageKey]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Non-fatal: the banner simply returns next visit.
    }
  }

  if (!ready || dismissed) return null;

  return (
    <div className="border-b border-amber-400/20 bg-amber-500/[0.07] px-4 py-3 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <p className="min-w-0 flex-1 text-xs leading-5 text-amber-100/90">
          You are still using the default password. Please{" "}
          <Link
            href={`/${subdomain}/student/password`}
            className="font-semibold text-amber-200 underline underline-offset-2 hover:text-white"
          >
            change it
          </Link>{" "}
          so nobody else can see your results.
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-lg p-1.5 text-amber-200/70 transition hover:bg-amber-500/15 hover:text-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}