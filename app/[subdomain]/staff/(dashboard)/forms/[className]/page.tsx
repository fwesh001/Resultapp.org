"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, HeartHandshake, Loader2, MessageSquareText, Save, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "@/components/ui/toast";
import SchemeBuilder from "@/components/remarks/SchemeBuilder";
import type { RemarkBand } from "@/types/school";

const TERMS = ["Term 1", "Term 2", "Term 3"] as const;

interface GridStudent {
  id: string;
  student_id: string;
  full_name: string;
  class_name: string;
}

interface FormGrid {
  students: GridStudent[];
  traits: Record<string, Record<string, string>>;
  remarks: Record<string, string>;
  form_teacher_remarks?: Record<string, string>;
  averages?: Record<string, number | null>;
  teacher_scheme?: RemarkBand[];
  subjects: string[];
  allowed_traits: string[];
  scale: string[];
  term: string;
  class_name: string;
  is_form_teacher: boolean;
}

/** Client mirror of the server band evaluation (server is authoritative). */
function evaluateSchemeLocal(average: number | null | undefined, bands: RemarkBand[] | undefined): string | null {
  if (average === null || average === undefined || !Number.isFinite(average)) return null;
  const avg = Math.round(Number(average) * 10) / 10;
  const ordered = [...(bands || [])]
    .filter((b) => b && Number.isFinite(Number(b.min)) && Number.isFinite(Number(b.max)))
    .sort((a, b) => Number(a.min) - Number(b.min) || Number(a.max) - Number(b.max));
  for (const b of ordered) {
    if (Number(b.min) <= avg && avg <= Number(b.max)) {
      const text = String(b.text || "").trim();
      return text || null;
    }
  }
  return null;
}

function validTerm(value: string | null): string {
  return value && (TERMS as readonly string[]).includes(value) ? value : "Term 1";
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Form-teacher workspace: behavioural traits + remarks for one class.
 * Academic subjects never mount here. Writes ride the standard batch
 * endpoint (assessment_key "behavioural") under the class's first allocated
 * subject as a storage context — invisible in this UI. The backend enforces
 * the form-teacher assignment (403 otherwise).
 */
export default function FormGridPage() {
  const params = useParams<{ subdomain: string; className: string }>();
  const searchParams = useSearchParams();
  const tenantId = (params.subdomain || "").toLowerCase().trim();
  const decodedClassName = safeDecode(params.className || "");
  const [term, setTerm] = useState(() => validTerm(searchParams.get("term")));

  const [grid, setGrid] = useState<FormGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [traitDrafts, setTraitDrafts] = useState<Record<string, string>>({});
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({});
  const [remarkTouched, setRemarkTouched] = useState<Set<string>>(new Set());
  const [savingSid, setSavingSid] = useState<string | null>(null);

  const fetchGrid = useCallback(async () => {
    if (!tenantId || !decodedClassName) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        view: "form",
        tenant_id: tenantId,
        class_name: decodedClassName,
        term,
      });
      const res = await fetch(`/api/staff/grading?${qs.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as FormGrid & { error?: string };
      if (!res.ok) throw new Error(data.error || `Failed to load (${res.status})`);
      setGrid(data);
      // Seed drafts from stored values.
      const td: Record<string, string> = {};
      for (const [sid, tm] of Object.entries(data.traits || {})) {
        for (const [trait, grade] of Object.entries(tm || {})) {
          td[`${sid}::${trait}`] = String(grade);
        }
      }
      setTraitDrafts(td);
      setRemarkDrafts({ ...(data.remarks || {}) });
      setRemarkTouched(new Set());
      setExpandedStudent(null);
    } catch (err) {
      setGrid(null);
      setError(err instanceof Error ? err.message : "Failed to load form grid");
    } finally {
      setLoading(false);
    }
  }, [tenantId, decodedClassName, term]);

  useEffect(() => {
    void fetchGrid();
  }, [fetchGrid]);

  function expandStudent(studentId: string) {
    setExpandedStudent((prev) => (prev === studentId ? null : studentId));
  }

  async function handleSave(studentId: string) {
    if (!grid || savingSid) return;
    const contextSubject = grid.subjects[0];
    if (!contextSubject) {
      toast.error("No subjects allocated to this class yet", {
        description: "Ask an admin to allocate subjects first.",
      });
      return;
    }
    const items = (grid.allowed_traits || [])
      .map((t) => ({
        student_id: studentId,
        trait: t,
        score: (traitDrafts[`${studentId}::${t}`] || "").trim().toUpperCase(),
      }))
      .filter((i) => i.score !== "");
    // Remarks ride only when the textarea was touched (absent key preserves).
    const remarkText = remarkTouched.has(studentId) ? (remarkDrafts[studentId] || "").trim() : null;
    if (items.length === 0 && remarkText === null) return;

    setSavingSid(studentId);
    try {
      // Behavioural rows require at least one score item server-side; when
      // only a remark changed, send the already-stored first trait back so
      // the row (and remark) persists without altering grades.
      const payloadScores =
        items.length > 0
          ? items
          : (() => {
              const existing = grid.traits[studentId] || {};
              const firstTrait = grid.allowed_traits.find((t) => existing[t]);
              if (!firstTrait) {
                throw new Error("Grade at least one trait before saving a remark alone");
              }
              return [{ student_id: studentId, trait: firstTrait, score: existing[firstTrait] }];
            })();
      const payload: Record<string, unknown> = {
        tenant_id: tenantId,
        term,
        subject_name: contextSubject,
        class_name: grid.class_name,
        assessment_key: "behavioural",
        scores: payloadScores,
      };
      if (remarkText !== null) payload.remarks = { [studentId]: remarkText };
      const res = await fetch("/api/staff/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      setGrid((prev) => {
        if (!prev) return prev;
        const traits = { ...prev.traits };
        const merged = { ...(traits[studentId] || {}) };
        for (const i of payloadScores as Array<{ trait: string; score: string }>) merged[i.trait] = i.score;
        traits[studentId] = merged;
        const remarks = { ...prev.remarks };
        if (remarkText !== null) {
          if (remarkText) remarks[studentId] = remarkText;
          else delete remarks[studentId];
        }
        return { ...prev, traits, remarks };
      });
      setRemarkTouched((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
      setExpandedStudent(null);
      toast.success(`Saved behavioural record for ${studentId}`);
    } catch (err) {
      toast.error("Could not save behavioural record", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSavingSid(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link
          href={`/${tenantId}/staff`}
          className="inline-flex items-center gap-1.5 text-sm text-purple-300/60 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600/15 ring-1 ring-emerald-500/25">
            <HeartHandshake className="h-5 w-5 text-emerald-300" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              {decodedClassName} — Behavioural Grid
            </h1>
            <p className="text-sm text-purple-200/60">
              Form-teacher workspace • {term} • academic subjects hidden
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            {TERMS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTerm(t)}
                aria-pressed={term === t}
                className={
                  term === t
                    ? "rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white"
                    : "rounded-full border border-purple-500/20 px-4 py-1.5 text-xs text-purple-200 hover:bg-white/5"
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/15 p-8 text-sm text-purple-200/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading form grid…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-300">{error}</div>
      ) : grid && !grid.is_form_teacher ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-200">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p>You are not the assigned Form Teacher for {decodedClassName}. Behavioural records are restricted to the designated form teacher.</p>
        </div>
      ) : grid ? (
        <div className="space-y-2">
          {grid.subjects.length === 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
              No subjects are allocated to this class yet — saving is disabled until an admin allocates at least one subject.
            </div>
          )}
          {grid.students.map((s) => {
            const expanded = expandedStudent === s.student_id;
            const doneCount = (grid.allowed_traits || []).filter(
              (t) => grid.traits[s.student_id]?.[t],
            ).length;
            const saving = savingSid === s.student_id;
            return (
              <div
                key={s.id}
                className="overflow-hidden rounded-xl border border-emerald-500/15 bg-white/[0.02]"
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
                    {doneCount}/{grid.allowed_traits.length}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-emerald-300 transition ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
                {expanded && (
                  <div className="space-y-2 border-t border-emerald-500/10 px-4 py-3">
                    {grid.allowed_traits.map((t) => (
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
                          className="h-9 w-24 rounded-lg border border-purple-800/50 bg-purple-950/30 px-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                        >
                          <option value="">–</option>
                          {grid.scale.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <label className="flex items-start gap-2 pt-1">
                      <MessageSquareText className="mt-2 h-4 w-4 shrink-0 text-emerald-300/70" />
                      <textarea
                        value={remarkDrafts[s.student_id] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRemarkDrafts((prev) => ({ ...prev, [s.student_id]: v }));
                          setRemarkTouched((prev) => new Set(prev).add(s.student_id));
                        }}
                        rows={2}
                        maxLength={500}
                        placeholder="Form teacher remark (optional, max 500 chars)…"
                        aria-label={`Remark for ${s.full_name}`}
                        className="w-full rounded-lg border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleSave(s.student_id)}
                      disabled={saving || grid.subjects.length === 0}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" /> Save for {s.full_name.split(" ")[0]}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
