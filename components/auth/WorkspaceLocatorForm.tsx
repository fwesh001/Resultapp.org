"use client";

import * as React from "react";
import { useState } from "react";
import { Loader2, AlertCircle, ArrowRight, Globe } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;

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
 * Workspace locator — root-domain sign-in helper. Takes a subdomain and
 * redirects to that tenant's admin login. No backend calls by design.
 */
export default function WorkspaceLocatorForm() {
  const [subdomain, setSubdomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const preview = subdomain.trim() || "yourschool";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const slug = subdomain.trim().toLowerCase();
    if (!slug) {
      setError("Enter your school subdomain");
      return;
    }
    if (slug.length < 3 || slug.length > 30 || !SUBDOMAIN_RE.test(slug)) {
      setError("Subdomains are 3-30 chars: lowercase letters, numbers, hyphens");
      return;
    }

    setLoading(true);
    // Client-side redirect to the tenant's admin login (no history entry lost —
    // this is a cross-origin navigation, history.back() still works there).
    window.location.assign(`https://${slug}.resultapp.org/admin/login`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="workspace-subdomain" className="text-sm font-medium text-purple-100">
          School subdomain
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
            disabled={loading}
            className="flex h-10 w-full rounded-l-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 font-mono text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:opacity-50"
          />
          <span className="inline-flex items-center rounded-r-xl border border-l-0 border-purple-800/50 bg-purple-950/30 px-3 font-mono text-sm text-purple-300/70">
            .resultapp.org
          </span>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-purple-300/50">
          <Globe className="h-3 w-3" />
          You&apos;ll continue at <span className="font-mono text-purple-200">{preview}.resultapp.org</span>
        </p>
      </div>

      {error && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Hidden input keeps password managers / a11y happy without a real credential field */}
      <Input label="" name="workspace" value="" onChange={() => {}} className="hidden" aria-hidden="true" tabIndex={-1} />

      <Button
        type="submit"
        disabled={loading}
        className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white hover:bg-purple-500 disabled:opacity-60"
        size="lg"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Redirecting…
          </>
        ) : (
          <>
            Continue to admin sign in <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}
