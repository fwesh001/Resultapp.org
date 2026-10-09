"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, ArrowRight, Globe, ShieldCheck, Users, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/Button";

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;

/**
 * Where each role lands once the school is known.
 *
 * Students never authenticate: they go straight to the public result checker
 * on the tenant landing page (`#result-checker`). Admin and staff each have
 * their own isolated sign-in surface, so the handoff is a cross-origin
 * navigation and no credential is ever typed on the root domain.
 */
const ROLE_DESTINATIONS = {
  admin: (slug: string) => `https://${slug}.resultapp.org/admin/login`,
  staff: (slug: string) => `https://${slug}.resultapp.org/staff/login`,
  student: (slug: string) => `https://${slug}.resultapp.org/#result-checker`,
} as const;

type Role = keyof typeof ROLE_DESTINATIONS;

const ROLES: ReadonlyArray<{ id: Role; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "admin", label: "Admin", hint: "School administrator", icon: ShieldCheck },
  { id: "staff", label: "Staff", hint: "Teacher or form master", icon: Users },
  { id: "student", label: "Student", hint: "Check a result", icon: GraduationCap },
];

/** "Continue to admin sign in" — label follows the chosen role. */
const CTA_LABEL: Record<Role, string> = {
  admin: "Continue to admin sign in",
  staff: "Continue to staff sign in",
  student: "Continue to result checker",
};

/** Remembers the last choice so a returning user picks up where they left off. */
const LAST_ROLE_KEY = "signin-role";

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

/**
 * Unified sign-in entry point for the root domain (resultapp.org/login).
 *
 * Two steps in one card: pick who you are, then say which school. Because the
 * root domain has no tenant context, the portal id cannot be inferred — so we
 * ask, validate it, and hand off to the tenant's own isolated surface.
 *
 * No credential fields here, by design: the root domain is shared by every
 * visitor, so typing a password into it would be a phishing magnet. The
 * subdomain is the security boundary.
 */
export default function WorkspaceLocatorForm() {
  const [role, setRole] = useState<Role>("staff");
  const [subdomain, setSubdomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);

  // Hydrate the remembered role after mount so server and first client render
  // agree (reading localStorage during render would break hydration).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAST_ROLE_KEY);
      if (saved && saved in ROLE_DESTINATIONS) setRole(saved as Role);
    } catch {
      /* private mode: fall back to the default */
    }
  }, []);

  const selectRole = useCallback((next: Role) => {
    setRole(next);
    setError(null);
    try {
      window.localStorage.setItem(LAST_ROLE_KEY, next);
    } catch {
      /* best effort */
    }
  }, []);

  const preview = subdomain.trim() || "yourschool";

  const go = useCallback(
    (slug: string) => {
      // Cross-origin navigation: history.back() still works on arrival.
      window.location.assign(ROLE_DESTINATIONS[role](slug));
    },
    [role],
  );

  function validateSlug(slug: string): string | null {
    if (!slug) return "Enter your school portal ID";
    if (slug.length < 3 || slug.length > 30 || !SUBDOMAIN_RE.test(slug)) {
      return "Portal IDs are 3-30 chars: lowercase letters, numbers, hyphens";
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const slug = subdomain.trim().toLowerCase();
    const invalid = validateSlug(slug);
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    go(slug);
  }

  /**
   * Confirm the school exists before bouncing the user across to a subdomain.
   *
   * NOTE the inverted semantics of /api/tenant/[subdomain]: `available: false`
   * means the subdomain is TAKEN, i.e. the school exists. `available: true`
   * means free, i.e. no such school. Reading that backwards would send real
   * users to an error and let typos through.
   *
   * Students are not checked: a student may belong to a school whose portal is
   * mid-setup, and the checker itself explains the situation far better than we
   * can from here. A network failure also never blocks sign-in — we hand off
   * anyway and let the tenant surface report the truth.
   */
  async function handleVerifiedSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const slug = subdomain.trim().toLowerCase();
    const invalid = validateSlug(slug);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (role === "student") {
      setLoading(true);
      go(slug);
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { available?: boolean };
      if (res.ok && data.available === true) {
        setError(`We couldn't find a school at ${slug}.resultapp.org. Check the ID, or try the demo.`);
        setChecking(false);
        return;
      }
    } catch {
      // Unreachable registry: hand off rather than trap the user.
    }
    setChecking(false);
    setLoading(true);
    go(slug);
  }

  const busy = loading || checking;

  return (
    <form onSubmit={role === "student" ? handleSubmit : handleVerifiedSubmit} className="space-y-5">
      <fieldset>
        <legend className="text-sm font-medium text-purple-100">Who are you signing in as?</legend>
        <div role="radiogroup" aria-label="Sign in as" className="mt-2 grid grid-cols-3 gap-2">
          {ROLES.map(({ id, label, hint, icon: Icon }) => {
            const active = role === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectRole(id)}
                className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center transition ${
                  active
                    ? "border-purple-400/60 bg-purple-500/15 text-white"
                    : "border-purple-500/20 bg-purple-950/30 text-purple-200/70 hover:border-purple-400/40 hover:bg-purple-500/5"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "text-purple-300" : "text-purple-300/60"}`} />
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-[11px] leading-tight text-purple-300/50">{hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="workspace-subdomain" className="text-sm font-medium text-purple-100">
          School portal ID
        </label>
        <div className="mt-2 flex">
          <input
            id="workspace-subdomain"
            name="subdomain"
            value={subdomain}
            onChange={(e) => {
              setSubdomain(sanitizeSlug(e.target.value));
              if (error) setError(null);
            }}
            placeholder="vhs"
            required
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            aria-describedby="workspace-subdomain-hint"
            className="flex h-10 w-full rounded-l-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 font-mono text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:opacity-50"
          />
          <span className="inline-flex items-center rounded-r-xl border border-l-0 border-purple-800/50 bg-purple-950/30 px-3 font-mono text-sm text-purple-300/70">
            .resultapp.org
          </span>
        </div>
        <p id="workspace-subdomain-hint" className="mt-1.5 flex items-center gap-1.5 text-xs text-purple-300/50">
          <Globe className="h-3 w-3" />
          You&apos;ll continue at <span className="font-mono text-purple-200">{preview}.resultapp.org</span>
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* No credential fields by design — this form only locates the workspace. */}

      <Button
        type="submit"
        disabled={busy}
        className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white hover:bg-purple-500 disabled:opacity-60"
        size="lg"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {checking ? "Checking school…" : "Redirecting…"}
          </>
        ) : (
          <>
            {CTA_LABEL[role]} <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}