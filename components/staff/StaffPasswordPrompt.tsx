"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, X } from "lucide-react";

interface Props {
  subdomain: string;
}

/**
 * Soft "please change your password" banner for the staff portal.
 *
 * The student equivalent (components/student/PasswordChangePrompt.tsx) is a hard
 * redirect on the same condition. That is right for a child on a shared family
 * phone and wrong here: a teacher signs in on a machine in the staff room that
 * forty other staff use that day, and gating them behind a password form before
 * they can reach the class register they were sent to fix is a worse outcome
 * than the warning being ignorable. So: banner, not redirect.
 *
 * Dismissal is remembered per tenant+browser so it does not reappear on every
 * navigation, but it is NOT remembered server-side. Changing the password is
 * the only thing that clears must_change_password, and treating dismissal as
 * equivalent would let a member hide the warning indefinitely while still on
 * the shared default.
 */
export default function StaffPasswordPrompt({ subdomain }: Props) {
  // Namespaced per role: a staff member who also has a student account must not
  // have their student-portal dismissal hide the staff warning.
  const storageKey = `resultapp:dismissed-default-pw:staff:${subdomain}`;
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
          You are still using the default staff password. Please{" "}
          <Link
            href={`/${subdomain}/staff/profile`}
            className="font-semibold text-amber-200 underline underline-offset-2 hover:text-white"
          >
            change it
          </Link>{" "}
          so nobody else can enter grades or sign off on results as you.
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
