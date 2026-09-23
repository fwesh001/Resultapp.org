"use client";

import { useEffect, useState } from "react";

export interface GlobalTerm {
  term: string;
  session: string | null;
}

const VALID_TERMS = ["Term 1", "Term 2", "Term 3"] as const;

function normalizeTerm(raw: unknown): string {
  const t = String(raw ?? "").trim();
  return (VALID_TERMS as readonly string[]).includes(t) ? t : "Term 1";
}

/**
 * Default-plus-override global term hook.
 * Fetches the admin-configured term once per tenant; returns null until
 * loaded so callers keep their static fallback with zero layout shift.
 * Callers apply it ONLY when no explicit ?term exists and the user hasn't
 * manually picked a term yet.
 */
export function useGlobalTerm(tenantId: string): GlobalTerm | null {
  const [value, setValue] = useState<GlobalTerm | null>(null);

  useEffect(() => {
    const tid = (tenantId || "").toLowerCase().trim();
    if (!tid) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/tenant/${encodeURIComponent(tid)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as {
          available?: boolean;
          currentTerm?: string;
          currentSession?: string | null;
        };
        if (cancelled || data.available !== false) return;
        setValue({
          term: normalizeTerm(data.currentTerm),
          session: typeof data.currentSession === "string" && data.currentSession.trim() ? data.currentSession.trim() : null,
        });
      } catch {
        // Fail silent — callers keep their static default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return value;
}

export { VALID_TERMS };
