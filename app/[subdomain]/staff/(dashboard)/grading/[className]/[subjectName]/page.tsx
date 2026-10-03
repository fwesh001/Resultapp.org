"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useGlobalTerm } from "@/lib/useGlobalTerm";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Select, type SelectOption } from "@/components/ui/Select";
import {
  ArrowLeft,
  BookOpen,
  Users,
  Loader2,
  AlertCircle,
  HeartHandshake,
  Save,
  ChevronDown,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/toast";
import { useDraftSave } from "@/lib/useDraftSave";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { DraftRecoveryPrompt } from "@/components/ui/DraftRecoveryPrompt";
import { NetworkIndicator } from "@/components/ui/NetworkIndicator";

const TERMS = ["Term 1", "Term 2", "Term 3"] as const;
const DEFAULT_SCALE = ["A", "B", "C", "D", "E"];

interface TemplateComponent {
  name: string;
  weight?: number;
  items?: Array<{ name: string; max_score?: number; max?: number }>;
  max_score?: number;
  max?: number;
}

interface TemplateData {
  id: number;
  name: string;
  academic_structure: { components?: TemplateComponent[] };
  behavioral_structure?: { traits?: string[]; scale?: string[] } | null;
}

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  class_name: string;
}

interface Bundle {
  template: TemplateData;
  students: Student[];
  grades: Record<string, Record<string, number>>;
  behavioural: Record<string, Record<string, string>>;
  term: string;
  class_name: string;
  subject_name: string;
  // Capability flags from the backend (absent = legacy permissive backend).
  can_grade_academic?: boolean;
  can_grade_traits?: boolean;
}

interface Assessment {
  key: string;
  max: number;
  category: string;
}

function validTerm(value: string | null): string {
  return value && (TERMS as readonly string[]).includes(value) ? value : "Term 1";
}

/** useParams values may arrive URL-encoded (e.g. "JSS%201"); never throw on stray `%`. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitize(value: string): string {
  return value.replace(/\s+/g, "_");
}

/**
 * Pre-v1 draft key, kept so existing in-progress work is still recoverable.
 * v1 moved to a term-scoped `resultapp|draft|v1|…` key because the old one
 * omitted term and so let one term's draft overwrite another's.
 */
function legacyDraftKey(
  tenantId: string,
  className: string,
  subjectName: string,
  assessmentKey: string,
): string {
  return `draft_${tenantId}_${sanitize(className)}_${sanitize(subjectName)}_${sanitize(assessmentKey)}`;
}

export default function FocusedGradingPage() {
  const params = useParams<{ subdomain: string; className: string; subjectName: string }>();
  const searchParams = useSearchParams();
  const tenantId = (params.subdomain || "").toLowerCase().trim();
  const className = params.className || "";
  const subjectName = params.subjectName || "";
  const decodedClassName = safeDecode(className);
  const decodedSubjectName = safeDecode(subjectName);

  const [term, setTerm] = useState(() => validTerm(searchParams.get("term")));
  // Default-plus-override: explicit ?term wins; otherwise adopt the global
  // admin term once loaded (direct visits with no query param).
  const [termTouched, setTermTouched] = useState(() => searchParams.get("term") !== null);
  const globalTerm = useGlobalTerm(tenantId);

  useEffect(() => {
    if (!termTouched && globalTerm && term !== globalTerm.term) {
      setTerm(globalTerm.term);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [globalTerm, termTouched]);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Focused entry modal state
  const [focused, setFocused] = useState<Assessment | null>(null);
  const [behaviouralOpen, setBehaviouralOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Behavioural per-student entry state
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [traitDrafts, setTraitDrafts] = useState<Record<string, string>>({});
  const [traitSaving, setTraitSaving] = useState(false);

  // Restore is an explicit choice: merging silently could overwrite a
  // colleague's server-side marks with this device's stale copy.
  const [dismissedRestoreKey, setDismissedRestoreKey] = useState<string | null>(null);

  const { isOnline } = useOnlineStatus();

  // Offline-first draft persistence. The scope is term-aware, so a Term 1 draft
  // can never be restored over Term 2 marks (the pre-v1 key allowed exactly that).
  const draftScope = useMemo(
    () => ({
      tenantId,
      term,
      className: decodedClassName,
      subjectName: decodedSubjectName,
      assessmentKey: focused?.key ?? "",
    }),
    [tenantId, term, decodedClassName, decodedSubjectName, focused],
  );
  const legacyKeys = useMemo(
    () =>
      focused ? [legacyDraftKey(tenantId, decodedClassName, decodedSubjectName, focused.key)] : [],
    [tenantId, decodedClassName, decodedSubjectName, focused],
  );
  const draft = useDraftSave<Record<string, string>>({
    scope: draftScope,
    value: drafts,
    enabled: Boolean(focused),
    legacyKeys,
  });

  function applyDraft(base: Record<string, string>, incoming: Record<string, string>) {
    const known = new Set((bundle?.students ?? []).map((s) => s.student_id));
    const next: Record<string, string> = { ...base };
    for (const [sid, val] of Object.entries(incoming)) {
      // Drop entries for students no longer on the roster — they must never be
      // submitted and would otherwise linger in the draft.
      if (known.size > 0 && !known.has(sid)) continue;
      if (typeof val === "string") next[sid] = val;
    }
    return next;
  }

  function handleRestore() {
    const found = draft.readDraft();
    if (restoreKey) setDismissedRestoreKey(restoreKey);
    if (!found) return;
    setDrafts((prev) => applyDraft(prev, found.values));
    draft.consumeRestore();
    toast.success("Draft restored", {
      description: found.legacy
        ? "Recovered from an earlier version of the app."
        : "Your unsaved scores are back. Press Save to publish them.",
    });
  }

  function handleDiscardDraft() {
    draft.clearDraft();
    if (restoreKey) setDismissedRestoreKey(restoreKey);
    draft.consumeRestore();
    toast.info("Draft discarded", { description: "Keeping the values stored on the server." });
  }

  const fetchBundle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        tenant_id: tenantId,
        class_name: decodedClassName,
        subject_name: decodedSubjectName,
        term,
      });
      const res = await fetch(`/api/staff/grading?${qs.toString()}`);
      const data = (await res.json()) as Bundle & { error?: string };
      if (!res.ok) throw new Error(data.error || `Failed to load (${res.status})`);
      setBundle(data);
    } catch (err) {
      setBundle(null);
      setError(err instanceof Error ? err.message : "Failed to load grading sheet");
    } finally {
      setLoading(false);
    }
  }, [tenantId, decodedClassName, decodedSubjectName, term]);

  // Initial + term-change load from the network (event-driven fetching,
  // not render-derived state).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBundle();
  }, [fetchBundle]);

  const assessments: Assessment[] = useMemo(() => {
    const components = bundle?.template.academic_structure?.components || [];
    const out: Assessment[] = [];
    for (const comp of components) {
      const category = comp.name || "General";
      if (Array.isArray(comp.items) && comp.items.length > 0) {
        for (const it of comp.items) {
          if (!it.name) continue;
          out.push({
            key: it.name,
            max: Number(it.max_score ?? it.max ?? 0),
            category,
          });
        }
      } else if (comp.name) {
        out.push({
          key: comp.name,
          max: Number(comp.max_score ?? comp.max ?? 0),
          category,
        });
      }
    }
    return out;
  }, [bundle]);

  const traits: string[] = useMemo(
    () => bundle?.template.behavioral_structure?.traits || [],
    [bundle],
  );
  const scale: string[] = useMemo(() => {
    const s = bundle?.template.behavioral_structure?.scale;
    return s && s.length > 0 ? s : DEFAULT_SCALE;
  }, [bundle]);

  function openFocused(a: Assessment) {
    const existing = bundle?.grades || {};
    const base: Record<string, string> = {};
    for (const s of bundle?.students || []) {
      const v = existing[s.student_id]?.[a.key];
      if (v !== undefined && v !== null) base[s.student_id] = String(v);
    }
    // No silent merge here: any existing draft (v1 or legacy) is offered by
    // the DraftRecoveryPrompt once the modal's scope becomes active.
    setDrafts(base);
    setFieldErrors({});
    setFocused(a);
  }

  function openBehavioural() {
    setExpandedStudent(null);
    setTraitDrafts({});
    setBehaviouralOpen(true);
  }

  function expandStudent(studentId: string) {
    if (expandedStudent === studentId) {
      setExpandedStudent(null);
      return;
    }
    const existing = bundle?.behavioural?.[studentId] || {};
    const next: Record<string, string> = {};
    for (const t of traits) {
      if (existing[t]) next[`${studentId}::${t}`] = existing[t];
    }
    setTraitDrafts(next);
    setExpandedStudent(studentId);
  }

  // Autosave to the device is handled by `useDraftSave` (debounced, term-scoped,
  // private-mode tolerant) — no manual localStorage effect here.

  // The prompt's open state is derived, not set from an effect: dismissing
  // records the specific draft key so a different draft can still prompt later.
  const restoreKey = draft.pendingRestore?.key ?? null;
  const showRestorePrompt = Boolean(focused && restoreKey && restoreKey !== dismissedRestoreKey);

  function handleFocusedClose(nextOpen: boolean) {
    if (nextOpen) return;
    if (!focused) {
      setFocused(null);
      return;
    }
    // Dirty check against in-memory state, which is what the hook persists.
    // Simpler and more accurate than re-parsing localStorage, and it correctly
    // reports a modification back to the server value (e.g. 45 -> 0).
    const saved = bundle?.grades || {};
    const hasUnsaved = Object.entries(drafts).some(([sid, raw]) => {
      const trimmed = String(raw).trim();
      if (trimmed === "") return false;
      const savedVal = saved[sid]?.[focused.key];
      return savedVal === undefined || String(savedVal) !== trimmed;
    });
    if (hasUnsaved) {
      setShowDiscardConfirm(true);
      return;
    }
    discardFocused();
  }

  function discardFocused() {
    setShowDiscardConfirm(false);
    setFocused(null);
    setDrafts({});
    setFieldErrors({});
  }

  async function handleSave() {
    if (!focused || !bundle) return;

    // Fast pre-check only. `navigator.onLine` is link-layer: a captive portal or
    // a WiFi connection with no upstream still reports true, so the catch block
    // below remains the real safety net and must keep the draft either way.
    if (isOnline === false) {
      toast.warning("You're offline", {
        description:
          "Your scores are saved on this device. Reconnect and press Save to publish them.",
      });
      return;
    }

    const scores = Object.entries(drafts)
      .filter(([, raw]) => raw.trim() !== "")
      .map(([student_id, raw]) => ({ student_id, score: parseFloat(raw) }))
      .filter((s) => !Number.isNaN(s.score));
    if (scores.length === 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/staff/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          term,
          subject_name: decodedSubjectName,
          class_name: decodedClassName,
          assessment_key: focused.key,
          scores,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      setBundle((prev) => {
        if (!prev) return prev;
        const grades = { ...prev.grades };
        for (const s of scores) {
          grades[s.student_id] = { ...(grades[s.student_id] || {}), [focused.key]: s.score };
        }
        return { ...prev, grades };
      });
      // Only now is the draft redundant: a confirmed 200 from the backend.
      // Also removes any legacy key so it cannot resurface later.
      draft.clearDraft();
      setFocused(null);
      setDrafts({});
      setFieldErrors({});
      toast.success(`Saved ${focused.key} for ${scores.length} student${scores.length === 1 ? "" : "s"}`);
    } catch (err) {
      // Draft deliberately NOT cleared. If navigator.onLine lied (captive
      // portal, dead upstream) this is the only thing standing between the
      // teacher and lost work.
      toast.error("Could not save scores", {
        description:
          (err instanceof Error ? err.message : "Please try again") +
          " — your work is still saved on this device.",
      });
    } finally {
      setSaving(false);
    }
  }
  async function handleTraitSave(studentId: string) {
    const items = traits
      .map((t) => ({ student_id: studentId, trait: t, score: (traitDrafts[`${studentId}::${t}`] || "").trim() }))
      .filter((i) => i.score !== "");

    if (items.length === 0) return;

    if (isOnline === false) {
      toast.warning("You're offline", {
        description: "Your entries are saved on this device. Reconnect and press Save to publish.",
      });
      return;
    }

    setTraitSaving(true);
    try {
      const res = await fetch("/api/staff/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          term,
          subject_name: decodedSubjectName,
          class_name: decodedClassName,
          assessment_key: "behavioural",
          scores: items,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      setBundle((prev) => {
        if (!prev) return prev;
        const behavioural = { ...prev.behavioural };
        const merged = { ...(behavioural[studentId] || {}) };
        for (const i of items) merged[i.trait] = i.score;
        behavioural[studentId] = merged;
        return { ...prev, behavioural };
      });
      setExpandedStudent(null);
      toast.success(`Saved traits for ${items.length} field${items.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error("Could not save traits", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setTraitSaving(false);
    }
  }

  const hasFieldError = Object.values(fieldErrors).some(Boolean);
  const enteredCount = Object.values(drafts).filter((v) => v.trim() !== "").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div>
        <Link
          href={`/${tenantId}/staff`}
          className="inline-flex items-center gap-1.5 text-sm text-purple-300/60 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {decodedClassName} • {decodedSubjectName}
            </h1>
            <p className="mt-1 text-sm text-purple-200/60">
              {bundle ? `${bundle.students.length} student${bundle.students.length === 1 ? "" : "s"} • ${bundle.template.name}` : "Focused grading sheet"}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-purple-200/70">
            Term
<Select
                aria-label="Term"
                value={term}
                onChange={(v) => {
                  setTermTouched(true);
                  setTerm(v);
                }}
                triggerClassName="w-44"
                options={TERMS.map((t): SelectOption => ({ value: t, label: t }))}
              />
          </label>
        </div>
      </div>

      {/* Loading / error */}
      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] px-4 py-6 text-sm text-purple-200/70">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading grading sheet…
        </div>
      )}
      {!loading && error && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void fetchBundle()}
              className="ml-2 font-medium underline underline-offset-4 hover:text-red-200"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* View 1 — Class hub */}
      {!loading && !error && bundle && (
        <>
          {bundle.students.length === 0 ? (
            <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-amber-300" />
              <h3 className="mt-3 text-sm font-semibold text-white">No students in {decodedClassName} yet</h3>
              <p className="mt-1 text-sm text-purple-200/60">
                Ask an admin to register students for this class first.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {assessments.map((a) => {
                const filled = bundle.students.filter(
                  (s) => bundle.grades[s.student_id]?.[a.key] !== undefined,
                ).length;
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => openFocused(a)}
                    className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5 text-left backdrop-blur transition hover:bg-purple-900/10"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/15 ring-1 ring-purple-500/20">
                      <BookOpen className="h-5 w-5 text-purple-300" />
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-white">
                      {a.key} <span className="font-normal text-purple-300/60">(Max: {a.max})</span>
                    </h3>
                    <p className="mt-1 text-xs text-purple-200/50">
                      {a.category} • {filled}/{bundle.students.length} entered
                    </p>
                  </button>
                );
              })}
              {/* Behavioural entry is form-teacher-only: hidden (not disabled)
                  for subject teachers without the form assignment. */}
              {traits.length > 0 && bundle?.can_grade_traits !== false && (
                <button
                  key="behavioural"
                  type="button"
                  onClick={openBehavioural}
                  className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5 text-left backdrop-blur transition hover:bg-purple-900/10"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/15 ring-1 ring-purple-500/20">
                    <HeartHandshake className="h-5 w-5 text-purple-300" />
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-white">
                    Behavioural Traits <span className="font-normal text-purple-300/60">(A–E)</span>
                  </h3>
                  <p className="mt-1 text-xs text-purple-200/50">
                    {traits.length} traits • tap a student to grade
                  </p>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* View 2a — Focused academic entry modal (failsafe, centered large) */}
      <Modal
        open={focused !== null}
        onOpenChange={handleFocusedClose}
        title={focused ? `Entering scores for ${focused.key} • Max: ${focused.max}` : ""}
        description={`${decodedClassName} • ${decodedSubjectName} • ${term}`}
        size="lg"
        className="border-purple-500/20 bg-[#0B0514] text-white"
      >
        {focused && bundle && (
          <div className="space-y-3">
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1 sm:max-h-[60vh]">
              {bundle.students.map((s) => {
                const err = fieldErrors[s.student_id];
                return (
                  <div key={s.id} className="flex items-center gap-3 rounded-xl border border-purple-500/10 bg-purple-900/[0.02] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-white">
                      {s.full_name}{" "}
                      <span className="font-mono text-xs text-purple-300/40">{s.student_id}</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={focused.max}
                      value={drafts[s.student_id] ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setDrafts((prev) => ({ ...prev, [s.student_id]: raw }));
                        const n = parseFloat(raw);
                        setFieldErrors((prev) => ({
                          ...prev,
                          [s.student_id]:
                            raw.trim() !== "" && !isNaN(n) && n > focused.max
                              ? `Max is ${focused.max}`
                              : undefined,
                        }));
                      }}
                      placeholder="–"
                      aria-label={`Score for ${s.full_name}`}
                      className={
                        err
                          ? "h-10 w-24 shrink-0 rounded-xl border border-red-500/60 bg-[#0B0514] px-3 text-sm text-white focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                          : "h-10 w-24 shrink-0 rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                      }
                    />
                  </div>
                );
              })}
            </div>
            {hasFieldError && (
              <p className="flex items-center gap-1.5 text-xs text-red-300">
                <AlertCircle className="h-3.5 w-3.5" /> Some scores exceed the maximum — fix the red fields to save.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-purple-300/30">
                Draft auto-saves to this device for{" "}
                <span className="font-semibold text-purple-200/60">{term}</span>
              </p>
              <NetworkIndicator
                isOnline={isOnline}
                isPendingWrite={draft.isPendingWrite}
                persistenceAvailable={draft.persistenceAvailable}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || hasFieldError || enteredCount === 0}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 py-3 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" /> Save {enteredCount} score{enteredCount === 1 ? "" : "s"}
                </>
              )}
            </button>
          </div>
        )}
      </Modal>

      {/* View 2b — Behavioural entry modal (form-teacher-only) */}
      <Modal
        open={behaviouralOpen && bundle?.can_grade_traits !== false}
        onOpenChange={setBehaviouralOpen}
        title="Behavioural Traits • A–E"
        description={`${decodedClassName} • ${decodedSubjectName} • ${term} — tap a student, grade each trait, save.`}
        size="lg"
        className="border-purple-500/20 bg-[#0B0514] text-white"
      >
        {bundle && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {bundle.students.map((s) => {
              const expanded = expandedStudent === s.student_id;
              const doneCount = traits.filter(
                (t) => bundle.behavioural[s.student_id]?.[t],
              ).length;
              return (
                <div
                  key={s.id}
                  className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04]"
                >
                  <button
                    type="button"
                    onClick={() => expandStudent(s.student_id)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-white">
                      {s.full_name}{" "}
                      <span className="font-mono text-xs text-purple-300/40">{s.student_id}</span>
                    </span>
                    <span className="text-xs text-purple-300/50">
                      {doneCount}/{traits.length}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-purple-300 transition ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>
                  {expanded && (
                    <div className="space-y-2 border-t border-purple-500/10 px-4 py-3">
                      {traits.map((t) => (
                        <div key={t} className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate text-xs text-purple-200/80">{t}</span>
<Select
                              size="sm"
                              triggerClassName="w-24"
                              value={traitDrafts[`${s.student_id}::${t}`] ?? ""}
                              onChange={(v) =>
                                setTraitDrafts((prev) => ({
                                  ...prev,
                                  [`${s.student_id}::${t}`]: v,
                                }))
                              }
                              aria-label={`${t} grade for ${s.full_name}`}
                              placeholder="-"
                              options={[
                                { value: "", label: "-" },
                                ...traits.map((g): SelectOption => ({ value: g, label: g })),
                              ]}
                            />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => void handleTraitSave(s.student_id)}
                        disabled={traitSaving}
                        className="flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {traitSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" /> Save traits for {s.full_name.split(" ")[0]}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={(o) => { if (!o) setShowDiscardConfirm(false); }}
        title="Discard unsaved scores?"
        message="You have unsaved scores. Close anyway?"
        variant="default"
        confirmLabel="Discard"
        onConfirm={discardFocused}
      />

      {/* Draft recovery — offered instead of silently merging over server marks. */}
      <DraftRecoveryPrompt
        open={showRestorePrompt}
        onOpenChange={(o) => { if (!o && restoreKey) setDismissedRestoreKey(restoreKey); }}
        entryCount={Object.values(draft.pendingRestore?.values ?? {}).filter((v) => String(v).trim() !== "").length}
        savedAt={draft.pendingRestore?.savedAt ?? null}
        term={draft.pendingRestore?.term ?? term}
        legacy={draft.pendingRestore?.legacy}
        onRestore={handleRestore}
        onDiscard={handleDiscardDraft}
      />
    </div>
  );
}
