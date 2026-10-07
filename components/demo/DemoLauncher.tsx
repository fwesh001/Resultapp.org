"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";

/**
 * "Launch interactive demo" button. Provisions an ephemeral tenant through
 * the rate-limited proxy and navigates straight to it. The demo id returned
 * by the server becomes the path: https://demo.resultapp.org/<id>.
 */
export function DemoLauncher() {
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="mt-8 flex w-full max-w-md flex-col items-center">
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
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-purple-300/50">
        Private to you for the next hour • fictional data • nothing to install
      </p>
    </div>
  );
}
