"use client";

import { useEffect, useState } from "react";

/**
 * Simulated-but-honest progress for the registration wizard.
 *
 * The backend only reports coarse truth (roughly 10 → 60 → 85 → 100), which
 * leaves the bar visibly frozen while a certificate is issued. This hook
 * drives the DISPLAYED value: it can never fall behind the backend, snaps
 * forward instantly when the backend advances, drifts upward slowly while
 * waiting, and reaches exactly 100 only when the portal genuinely answers.
 *
 * Honesty invariants (asserted in scripts/verify-auth-flow.mjs):
 * - display >= backend at all times (Math.max floor)
 * - display < 100 unless ready === true
 * - monotonic non-decreasing within a registration
 * - reduced-motion users jump straight to backend values (no tween)
 */

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clampBackend(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(5, Math.min(99, value));
}

/** Friendly, non-technical copy bands keyed by DISPLAYED percent. */
export function friendlyStage(displayPercent: number, ready: boolean): string {
  if (ready) return "Your portal is live";
  if (displayPercent < 35) return "Setting up your school environment…";
  if (displayPercent < 60) return "Preparing student and staff databases…";
  if (displayPercent < 85) return "Configuring secure gradebooks…";
  return "Finalizing your secure portal…";
}

export function useSimulatedProgress(backendPercent: number | null, ready: boolean): number {
  const [display, setDisplay] = useState(10);

  useEffect(() => {
    if (ready) {
      setDisplay(100);
      return;
    }
    const backend = clampBackend(backendPercent);
    if (backend === null) return;
    // Snap forward instantly on real backend progress — fast backends zip.
    setDisplay((d) => Math.max(d, backend));
    if (prefersReducedMotion()) return;
    // Drift toward (but never reach) the next backend milestone while waiting.
    const cap = backend < 60 ? 59 : backend < 85 ? 84 : 97;
    const id = window.setInterval(() => {
      setDisplay((d) => {
        if (d >= cap) return d;
        const step = cap - d > 12 ? 2 : 1;
        return Math.min(d + step, cap);
      });
    }, 450);
    return () => window.clearInterval(id);
  }, [backendPercent, ready]);

  return display;
}
