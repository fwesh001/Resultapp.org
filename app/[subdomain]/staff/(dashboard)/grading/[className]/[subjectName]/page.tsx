"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
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
import { toast } from "@/components/ui/toast";

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

export default function FocusedGradingPage() {
  const params = useParams<{ subdomain: string; className: string; subjectName: string }>();
  const searchParams = useSearchParams();
  const tenantId = (params.subdomain || "").toLowerCase().trim();
  const className = params.className || "";
  const subjectName = params.subjectName || "";
  const decodedClassName = safeDecode(className);
  const decodedSubjectName = safeDecode(subjectName);

  const [term, setTerm] = useState(() => validTerm(searchParams.get("term")));
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Focused entry modal state
  const [focused, setFocused] = useState<Assessment | null>(null);
  const [behaviouralOpen, setBehaviouralOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);

  // Behavioural per-student entry state
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [traitDrafts, setTraitDrafts] = useState<Record<string, string>>({});
  const [traitSaving, setTraitSaving] = useState(false);

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
    const next: Record<string, string> = {};
    for (const s of bundle?.students || []) {
      const v = existing[s.student_id]?.[a.key];
      if (v !== undefined && v !== null) next[s.student_id] = String(v);
    }
    setDrafts(next);
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

  async function handleSave() {
    if (!focused || !bundle) return;
    const scores = Object.entries(drafts)
      .filter(([, raw]) => raw.trim() !== "")
      .map(([student_id, raw]) => ({ student_id, score: parseFloat(raw) }));
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
      setFocused(null);
      toast.success(`Saved ${focused.key} for ${scores.length} student${scores.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error("Could not save scores", {
        description: err instanceof Error ? err.message : "Please try again",
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
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="rounded-xl border border-purple-500/20 bg-[#0B0514] px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
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
              {traits.length > 0 && (
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

      {/* View 2a — Focused academic entry modal */}
      <Modal
        open={focused !== null}
        onOpenChange={(o) => {
          if (!o) setFocused(null);
        }}
        title={focused ? `Entering scores for ${focused.key} • Max: ${focused.max}` : ""}
        description={`${decodedClassName} • ${decodedSubjectName} • ${term}`}
        size="md"
      >
        {focused && bundle && (
          <div className="space-y-2">
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {bundle.students.map((s) => {
                const err = fieldErrors[s.student_id];
                return (
                  <div key={s.id} className="flex items-center gap-3">
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
                          ? "h-10 w-24 rounded-xl border border-red-500/60 bg-[#0B0514] px-3 text-sm text-white focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                          : "h-10 w-24 rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
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

      {/* View 2b — Behavioural entry modal */}
      <Modal
        open={behaviouralOpen}
        onOpenChange={setBehaviouralOpen}
        title="Behavioural Traits • A–E"
        description={`${decodedClassName} • ${decodedSubjectName} • ${term} — tap a student, grade each trait, save.`}
        size="md"
      >
        {bundle && (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
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
                          <select
                            value={traitDrafts[`${s.student_id}::${t}`] ?? ""}
                            onChange={(e) =>
                              setTraitDrafts((prev) => ({
                                ...prev,
                                [`${s.student_id}::${t}`]: e.target.value,
                              }))
                            }
                            aria-label={`${t} grade for ${s.full_name}`}
                            className="h-9 w-24 rounded-lg border border-purple-800/50 bg-purple-950/30 px-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                          >
                            <option value="">–</option>
                            {scale.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
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
    </div>
  );
}
