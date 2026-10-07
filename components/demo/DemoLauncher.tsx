"use client";

import { useEffect, useState } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";

// Must equal ACTIVE_DEMO_COOKIE in app/api/demo/provision/route.ts (the
// proxy is the only writer). Kept as a literal here so the client bundle
// never imports next/server. Pinned by scripts/verify-demo-isolation.mjs.

/**
 * "Launch interactive demo" button with session resumption.
 *
 * On mount it reads the `active_demo` cookie (set by the provision proxy,
 * shared across resultapp.org and demo.resultapp.org). If a live classroom
 * id is present AND the registry still has it, the button becomes
 * "Continue your Demo" and navigates straight there — no second database.
 * If the classroom was swept (cookie outlived the 1h TTL edge), the cookie
 * is dropped and the button falls back to a fresh launch.
 */

const DEMO_ID_RE = /^demo-[a-z0-9]{6}$/;
const ACTIVE_DEMO_COOKIE = "active_demo";

function readActiveDemo(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ACTIVE_DEMO_COOKIE) {
      const value = decodeURIComponent(rest.join("=")).trim();
      return DEMO_ID_RE.test(value) ? value : null;
    }
  }
  return null;
}

function clearActiveDemo() {
  document.cookie = `${ACTIVE_DEMO_COOKIE}=; Domain=.resultapp.org; Path=/; Max-Age=0`;
}

export function DemoLauncher() {
  const [launching, setLaunching] = useState(false);
  const [checking, setChecking] = useState(true);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resume check runs once: cookie present does NOT mean classroom present.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = readActiveDemo();
      if (!id) {
        if (!cancelled) setChecking(false);
        return;
      }
      try {
        // available:true means the row is gone (swept) — drop the cookie.
        const res = await fetch(`/api/tenant/${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { available?: boolean };
        if (cancelled) return;
        if (data.available === false) {
          setResumeId(id);
        } else {
          clearActiveDemo();
        }
      } catch {
        // Offline/unreachable: keep the cookie and offer Continue anyway —
        // worst case the portal shows "School not found" with a way back.
        if (!cancelled) setResumeId(id);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function launch() {
    if (launching) return;
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.success || !data.url) {
        throw new Error(data.error || "Demo launch failed. Please retry.");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo launch failed. Please retry.");
      setLaunching(false);
    }
  }

  function resume() {
    if (!resumeId) return;
    window.location.href = `https://demo.resultapp.org/${resumeId}`;
  }

  return (
    <div className="mt-8 flex w-full max-w-md flex-col items-center">
      {checking ? (
        <div className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-purple-950/60 px-8 text-base font-semibold text-purple-200/60">
          <Loader2 className="h-5 w-5 animate-spin" /> Checking for your classroom…
        </div>
      ) : resumeId ? (
        <button
          type="button"
          onClick={resume}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-8 text-base font-semibold text-white shadow-[0_0_28px_rgba(16,185,129,0.30)] transition hover:bg-emerald-500"
        >
          <RotateCcw className="h-5 w-5" /> Continue your Demo
        </button>
      ) : (
        <button
          type="button"
          onClick={launch}
          disabled={launching}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-8 text-base font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.30)] transition hover:bg-purple-500 disabled:opacity-60"
        >
          {launching ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Setting up your classroom…
            </>
          ) : (
            <>
              <Play className="h-5 w-5" /> Launch interactive demo
            </>
          )}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-purple-300/50">
        {resumeId
          ? "Your classroom is still live — pick up right where you left off."
          : "Private to you for the next hour • fictional data • nothing to install"}
      </p>
    </div>
  );
}
