"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Offline-first draft persistence for teacher score entry.
 *
 * WHY THIS EXISTS
 * Teachers grade on phones, often on school WiFi, and switch mobile data off
 * to save battery. A tab close, an OS RAM sweep, or a lost connection must
 * never destroy typed scores. This hook persists the working set to
 * localStorage on every change so the work survives, and lets the caller
 * decide when a draft is offered back to the user.
 *
 * KEY STRUCTURE (v1)
 *   resultapp:draft:v1:<tenant>:<term>:<class>:<subject>:<assessment>
 *
 * TERM IS PART OF THE KEY — this is the whole reason v1 exists. The previous
 * key was `draft_<tenant>_<class>_<subject>_<assessment>`, so a Term 2 draft
 * overwrote a Term 1 draft for the same class/subject and restored stale marks.
 * Terms are separated by segment, so they can never collide.
 *
 * LEGACY COMPATIBILITY
 * Pre-v1 drafts were a bare `Record<studentId, string>` under an underscore
 * key. `readDraft` recognises those and still returns them, flagged
 * `legacy: true`, so an upgrade never discards a teacher's in-progress work.
 * They are re-written in v1 form on the next change.
 *
 * STORAGE IS BEST-EFFORT BY DESIGN
 * Private-mode Safari and a full quota both throw. Persistence then degrades to
 * a no-op and `persistenceAvailable` goes false so the UI can say so once.
 * Data entry must keep working either way.
 */

/** Bump when the envelope shape changes incompatibly. */
export const DRAFT_SCHEMA_VERSION = 1;

/** Drafts older than this are treated as absent. */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Coalesce keystrokes; a 50-row grid otherwise writes localStorage per key. */
const WRITE_DEBOUNCE_MS = 250;

/** Debounce on unmount/key-change so a pending write is never lost. */
const FLUSH_DEBOUNCE_MS = 400;

/**
 * Key delimiter.
 *
 * MUST be a character `encodeURIComponent` always escapes, otherwise a class
 * named "a_b" with subject "c" would collide with class "a" and subject "b_c".
 * "|" is encoded to %7C, so it can never appear inside an encoded segment.
 */
const SEP = "|";

/** Encode a value as a single key segment. */
function seg(value: string): string {
  return encodeURIComponent(String(value ?? "").trim().toLowerCase());
}

/**
 * Build the storage key. Term is required and always present — callers must
 * not be able to construct an unscoped key.
 */
export function buildDraftKey(scope: DraftScope): string {
  const { tenantId, term, className, subjectName, assessmentKey } = scope;
  if (!tenantId || !term || !className || !assessmentKey) {
    // Fail loudly in dev rather than silently writing to a shared key.
    throw new Error(
      `buildDraftKey: incomplete scope (tenant=${tenantId} term=${term} class=${className} assessment=${assessmentKey})`,
    );
  }
  return [
    "resultapp",
    "draft",
    `v${DRAFT_SCHEMA_VERSION}`,
    seg(tenantId),
    seg(term),
    seg(className),
    seg(subjectName),
    seg(assessmentKey),
  ].join(SEP);
}

export interface DraftScope {
  tenantId: string;
  term: string;
  className: string;
  subjectName: string;
  assessmentKey: string;
}

/** The v1 envelope written to localStorage. */
export interface DraftEnvelope<T> {
  v: number;
  term: string;
  className: string;
  subjectName: string;
  assessmentKey: string;
  savedAt: number;
  values: T;
}

/** What the UI needs to decide whether to offer a restore. */
export interface DraftInfo<T> {
  key: string;
  values: T;
  savedAt: number;
  term: string;
  /** True when this came from the pre-v1 bare-object format. */
  legacy: boolean;
}

export interface UseDraftSaveOptions<T> {
  scope: DraftScope;
  /** Current working set. Any change schedules a debounced persist. */
  value: T;
  /** When false, nothing is read or written (e.g. no modal open). */
  enabled?: boolean;
  /**
   * Pre-v1 storage keys to consider for this scope. If one holds a draft it is
   * offered like any other, flagged `legacy: true`, and left in place until
   * the user chooses (so a decline still loses nothing).
   */
  legacyKeys?: string[];
  /**
   * Called when a draft exists on open. The caller owns the prompt; this hook
   * deliberately does not decide policy.
   */
  onRestoreCandidate?: (draft: DraftInfo<T>) => void;
}

export interface UseDraftSaveResult<T> {
  /** A draft was found on mount/enable. Consumed once. */
  pendingRestore: DraftInfo<T> | null;
  /** Mark the candidate handled so it does not re-fire. */
  consumeRestore: () => void;
  /** Read the draft without the prompt (used by Restore). */
  readDraft: () => DraftInfo<T> | null;
  /** Delete this scope's draft (Discard, or after a successful save). */
  clearDraft: () => void;
  /**
   * Remove only the entries belonging to one subject from the stored draft.
   * Used by per-student saves on surfaces where one student is saved at a time:
   * their confirmed data is no longer needed locally, but anyone else's
   * in-flight work must survive.
   */
  clearDraftEntries?: (matchKey: string) => void;
  /** False when localStorage is unavailable (private mode / quota). */
  persistenceAvailable: boolean;
  /** true while a debounced write is queued — drives a "saved" affordance. */
  isPendingWrite: boolean;
  lastSavedAt: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse a stored draft, tolerating both the v1 envelope and the legacy bare
 * object. Returns null for corrupt, expired, or non-object payloads.
 */
export function readDraft<T>(key: string, scope: DraftScope, now: number = Date.now()): DraftInfo<T> | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  // v1 envelope.
  if (parsed.v === DRAFT_SCHEMA_VERSION && isRecord(parsed.values)) {
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    if (!savedAt || now - savedAt > DRAFT_TTL_MS) return null;
    // Defensive: a draft whose term disagrees with the current scope is a bug
    // or a hand-edited key. Never restore it.
    if (typeof parsed.term === "string" && parsed.term && parsed.term !== scope.term) return null;
    return {
      key,
      values: parsed.values as T,
      savedAt,
      term: typeof parsed.term === "string" ? parsed.term : scope.term,
      legacy: false,
    };
  }

  // Legacy bare object: `{ "VHS/001": "45" }`. No term, no timestamp. We keep it
  // (it is real unsaved work) but flag it so the UI can warn.
  return {
    key,
    values: parsed as T,
    savedAt: now,
    term: scope.term,
    legacy: true,
  };
}

/** Remove every legacy underscore-style draft for a tenant (migration helper). */
export function clearLegacyDraftsForScope(scope: DraftScope): number {
  if (typeof window === "undefined") return 0;
  let removed = 0;
  try {
    const prefix = `draft_${String(scope.tenantId).trim().toLowerCase()}_`;
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) {
      window.localStorage.removeItem(k);
      removed += 1;
    }
  } catch {
    /* best effort */
  }
  return removed;
}

export function useDraftSave<T extends Record<string, string>>({
  scope,
  value,
  enabled = true,
  legacyKeys = [],
  onRestoreCandidate,
}: UseDraftSaveOptions<T>): UseDraftSaveResult<T> {
  const [pendingRestore, setPendingRestore] = useState<DraftInfo<T> | null>(null);
  const [persistenceAvailable, setPersistenceAvailable] = useState(true);
  const [isPendingWrite, setIsPendingWrite] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failsafe = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A stable string key so effects don't re-run on object identity changes.
  const key = useMemo(() => {
    if (!enabled) return "";
    try {
      return buildDraftKey(scope);
    } catch {
      return "";
    }
  }, [enabled, scope.tenantId, scope.term, scope.className, scope.subjectName, scope.assessmentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelTimers = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (failsafe.current) {
      clearTimeout(failsafe.current);
      failsafe.current = null;
    }
  }, []);

  const flush = useCallback(
    (values: T) => {
      if (!key) return;
      cancelTimers();
      try {
        const savedAt = Date.now();
        const envelope: DraftEnvelope<T> = {
          v: DRAFT_SCHEMA_VERSION,
          term: scope.term,
          className: scope.className,
          subjectName: scope.subjectName,
          assessmentKey: scope.assessmentKey,
          savedAt,
          values,
        };
        window.localStorage.setItem(key, JSON.stringify(envelope));
        setPersistenceAvailable(true);
        setLastSavedAt(savedAt);
      } catch {
        // Quota or private mode. Persistence is best-effort: keep the UI working.
        setPersistenceAvailable(false);
      } finally {
        setIsPendingWrite(false);
      }
    },
    [key, cancelTimers, scope.term, scope.className, scope.subjectName, scope.assessmentKey],
  );

  // Persist on every change (debounced). The fast timer is the battery/typing
  // path; the failsafe guarantees a write even if the tab is throttled, and the
  // cleanup flushes synchronously so unmount/navigation cannot lose the tail.
  useEffect(() => {
    if (!key) return;
    cancelTimers();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsPendingWrite(true);
    timer.current = setTimeout(() => flush(value), WRITE_DEBOUNCE_MS);
    failsafe.current = setTimeout(() => flush(value), FLUSH_DEBOUNCE_MS);
    return () => {
      // Flush synchronously rather than dropping the pending write.
      flush(value);
    };
  }, [value, key, flush, cancelTimers]);

  // Keep the latest callback in a ref without writing it during render.
  const onRestoreCandidateRef = useRef(onRestoreCandidate);
  useEffect(() => {
    onRestoreCandidateRef.current = onRestoreCandidate;
  }, [onRestoreCandidate]);

  /**
   * Find a draft for this scope: the v1 key first, then any legacy keys.
   * Returns null when nothing usable is found.
   */
  const findDraft = useCallback((): DraftInfo<T> | null => {
    if (!key) return null;
    const primary = readDraft<T>(key, scope);
    if (primary) return primary;
    for (const lk of legacyKeys) {
      const found = readDraft<T>(lk, scope);
      if (found) return { ...found, key: lk, legacy: true };
    }
    return null;
  }, [key, scope, legacyKeys]);

  // Offer an existing draft exactly once per scope opening. Deferred to a
  // microtask so this is not a synchronous setState inside the effect body.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const found = findDraft();
      if (cancelled) return;
      setPendingRestore(found);
      if (found) onRestoreCandidateRef.current?.(found);
    });
    return () => {
      cancelled = true;
    };
  }, [key, findDraft]);

  const consumeRestore = useCallback(() => setPendingRestore(null), []);

  const read = useCallback(() => findDraft(), [findDraft]);

  const clear = useCallback(() => {
    cancelTimers();
    if (!key) return;
    try {
      // Remove both formats so a legacy draft cannot resurface next time.
      window.localStorage.removeItem(key);
      for (const lk of legacyKeys) window.localStorage.removeItem(lk);
    } catch {
      /* best effort */
    }
    setPendingRestore(null);
    setLastSavedAt(null);
    setIsPendingWrite(false);
  }, [key, cancelTimers, legacyKeys]);

  const clearEntries = useCallback(
    (matchKey: string) => {
      if (!key) return;
      const found = findDraft();
      if (!found) return;
      const kept: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(found.values as Record<string, unknown>)) {
        // Keys are namespaced per subject, e.g. "t::<studentId>::<trait>".
        const subject = k.startsWith("r::") ? k.slice(3) : k.replace(/^[tr]::/, "");
        if (subject.split("::")[0] === matchKey) continue;
        kept[k] = v;
      }
      // Persist the pruned set immediately so a later unmount flush of the full
      // in-memory value cannot resurrect the cleared entries.
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            v: DRAFT_SCHEMA_VERSION,
            term: scope.term,
            className: scope.className,
            subjectName: scope.subjectName,
            assessmentKey: scope.assessmentKey,
            savedAt: Date.now(),
            values: kept,
          } satisfies DraftEnvelope<unknown>),
        );
      } catch {
        /* best effort */
      }
    },
    [key, findDraft, scope.term, scope.className, scope.subjectName, scope.assessmentKey],
  );

  return {
    pendingRestore,
    consumeRestore,
    readDraft: read,
    clearDraft: clear,
    clearDraftEntries: clearEntries,
    persistenceAvailable,
    isPendingWrite,
    lastSavedAt,
  };
}
