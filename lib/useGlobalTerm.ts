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
 * Module-scoped deduplication (M1 perf fix — zero-dependency singleton cache).
 * Simultaneous hook instances share one in-flight promise per tenant;
 * resolved values are cached for 5 minutes so sequential mounts fetch nothing.
 */
const INFLIGHT = new Map<string, Promise<GlobalTerm | null>>();
const CACHE = new Map<string, { value: GlobalTerm | null; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getTerm(tid: string): Promise<GlobalTerm | null> {
  const hit = CACHE.get(tid);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
  const ongoing = INFLIGHT.get(tid);
  if (ongoing) return ongoing;
  const p = (async (): Promise<GlobalTerm | null> => {
    try {
      const res = await fetch(`/api/tenant/${encodeURIComponent(tid)}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => ({}))) as {
        available?: boolean;
        currentTerm?: string;
        currentSession?: string | null;
      };
      if (data.available !== false) return null;
      return {
        term: normalizeTerm(data.currentTerm),
        session: typeof data.currentSession === "string" && data.currentSession.trim() ? data.currentSession.trim() : null,
      };
    } catch {
      // Fail silent — callers keep their static default.
      return null;
    } finally {
      INFLIGHT.delete(tid);
    }
  })();
  INFLIGHT.set(tid, p);
  void p.then((v) => {
    CACHE.set(tid, { value: v, expiresAt: Date.now() + CACHE_TTL_MS });
  });
  return p;
}

/**
 * Default-plus-override global term hook.
 * Fetches the admin-configured term once per tenant; returns null until
 * loaded so callers keep their static fallback with zero layout shift.
 * Callers apply it ONLY when no explicit ?term exists and the user hasn't
 * manually picked a term yet.
 */
export function useGlobalTerm(tenantId: string): GlobalTerm | null {
  const tid = (tenantId || "").toLowerCase().trim();
  const [value, setValue] = useState<GlobalTerm | null>(() => {
    if (!tid) return null;
    const hit = CACHE.get(tid);
    return hit && hit.expiresAt > Date.now() ? hit.value : null;
  });

  useEffect(() => {
    if (!tid) return;
    let cancelled = false;
    void getTerm(tid).then((v) => {
      if (!cancelled) setValue(v);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return value;
}

export { VALID_TERMS };
