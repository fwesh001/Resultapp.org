"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type State = "working" | "no-session" | "not-a-moderator" | "failed";

/**
 * Auto-elevation gate for `/{sub}/moderator`.
 *
 * ══ WHY THERE IS NO LOGIN FORM HERE ══
 * A moderator is already authenticated in the Staff Portal. This used to send
 * them to `/{sub}/admin`, which asked for "Admin ID or Email" — a credential
 * they do not have, for a role they do not hold. So this page never asks for
 * anything: it POSTs to /api/moderator/session, which re-verifies
 * `is_moderator` against the DATABASE, mints the restricted session, and hands
 * back success. The browser lands on the console.
 *
 * ══ WHY THE AUTO-POST IS NOT A SECURITY HOLE ══
 * It grants nothing that was not already grantable: the backend already lets a
 * moderator mint an admin_session with their Staff ID and PIN. This removes a
 * step, not a check. Every real decision happens server-side —
 *   1. validly SIGNED staff_session, tenant-bound
 *   2. live DB check of is_moderator (no-store, not the cookie's own claim)
 *   3. role minted EXPLICITLY as "moderator" with a fixed capability subset
 * The endpoint is reachable by anyone holding a valid staff session, and it
 * refuses everyone else — including a plain non-moderator staff member, who
 * gets `not-a-moderator` rather than a console with broken links.
 *
 * ══ WHY THIS IS A PAGE AND NOT MIDDLEWARE ══
 * Middleware runs on the edge runtime and cannot do the HMAC session
 * verification, nor reach the backend to re-check `is_moderator`. It would have
 * to rewrite `/moderator/*` to `/admin/*` based on an UNVERIFIED cookie, which
 * would hand the admin portal to anyone who pasted a plausible-looking value.
 * The gate therefore lives at the point where a real, verified session exists.
 */
export default function ModeratorElevationPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = (params?.subdomain ?? "").toLowerCase().trim();
  const [state, setState] = useState<State>("working");
  // React 18 StrictMode mounts effects twice in development. Without this the
  // endpoint would be called twice, minting a second session and re-running the
  // whole redirect — harmless but it masks real single-flight bugs, and it makes
  // the failure path fire twice in dev only.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !subdomain) return;
    attempted.current = true;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/moderator/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain }),
          cache: "no-store",
        });

        if (cancelled) return;

        if (res.ok) {
          // Full navigation, not router.replace: the middleware/layout guards
          // below run during a server render, and a client-side navigation would
          // reuse the payload already fetched for THIS page.
          window.location.replace(`/${subdomain}/moderator`);
          return;
        }

        if (res.status === 401) setState("no-session");
        else if (res.status === 403) setState("not-a-moderator");
        else setState("failed");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [subdomain]);

  const copy: Record<State, { title: string; body: string; action?: { href: string; label: string } }> = {
    working: {
      title: "Opening your Moderator Console…",
      body: "Confirming your Moderator access. This normally takes a second.",
    },
    "no-session": {
      title: "Sign in to the Staff Portal first",
      body: "Your Moderator Console is derived from your Staff Portal session, so there is no separate password to enter here.",
      action: { href: `/${subdomain}/staff/login`, label: "Go to Staff Portal sign-in" },
    },
    "not-a-moderator": {
      title: "You do not have Moderator access",
      body: "Your Staff Portal account is valid, but it is not marked as a Moderator for this school. If you think that is wrong, ask the school's administrator.",
      action: { href: `/${subdomain}/staff`, label: "Back to Staff Portal" },
    },
    failed: {
      title: "Could not start your Moderator Console",
      body: "Something went wrong on our side. Reload the page to try again — your Staff Portal session is untouched.",
      action: { href: `/${subdomain}/moderator`, label: "Try again" },
    },
  };

  const view = copy[state];

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 px-6">
      <div className="w-full max-w-md rounded-2xl border border-line-1 bg-surface-1/60 p-8 text-center">
        {state === "working" ? (
          <div
            aria-hidden="true"
            className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
          />
        ) : null}

        <h1 className="text-lg font-semibold tracking-tight text-text-1">
          {view.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-2">{view.body}</p>

        {/* Announced to assistive tech on state change; the spinner alone would
            otherwise be silence. */}
        <p aria-live="polite" className="sr-only">
          {view.title}
        </p>

        {view.action && (
          <Link
            href={view.action.href}
            className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:bg-accent-hover"
          >
            {view.action.label}
          </Link>
        )}
      </div>
    </main>
  );
}