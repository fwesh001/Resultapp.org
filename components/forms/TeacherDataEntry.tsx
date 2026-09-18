"use client";

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  GraduationCap,
  BookOpen,
  Save,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

// ---------------------------------------------------------------------------
// Types – matches backend schemas.py + grading template JSONB
// ---------------------------------------------------------------------------

interface TemplateAcademicItem {
  name: string;
  max_score: number;
  max?: number;
}

interface TemplateComponent {
  name: string;
  weight: number;
  items?: TemplateAcademicItem[];
  max_score?: number;
  max?: number;
}

interface GradingTemplateRead {
  id: number;
  tenant_id: string;
  name: string;
  academic_structure: { components?: TemplateComponent[] } & Record<string, unknown>;
  behavioral_structure?: { traits?: string[]; scale?: string[] } | null;
  created_at: string;
}

interface TeacherDataEntryProps {
  tenantId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseComponents(template: GradingTemplateRead | null): TemplateComponent[] {
  if (!template) return [];
  const comps = (template.academic_structure as { components?: TemplateComponent[] })?.components;
  if (Array.isArray(comps)) return comps;
  return [];
}

function flatItems(components: TemplateComponent[]) {
  // For display and max enforcement, flatten each item with its category context
  return components.flatMap((c) => {
    if (Array.isArray(c.items) && c.items.length > 0) {
      return c.items.map((it) => ({
        key: it.name,
        label: it.name,
        max: Number(it.max_score ?? (it as { max?: number }).max ?? 0),
        category: c.name,
        weight: c.weight,
      }));
    }
    // No sub-items: the component itself is a single score (e.g., Exam)
    return [
      {
        key: c.name,
        label: c.name,
        max: Number((c as TemplateComponent).max_score ?? (c as { max?: number }).max ?? 0),
        category: c.name,
        weight: c.weight,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeacherDataEntry({ tenantId }: TeacherDataEntryProps) {
  // State 1: templates
  const [templates, setTemplates] = useState<GradingTemplateRead[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  // State 2: standard inputs
  const [studentId, setStudentId] = useState("");
  const [subject, setSubject] = useState("");
  const [term, setTerm] = useState("Term 1");

  // State 3: dynamic scores
  const [scores, setScores] = useState<Record<string, string>>({});

  // submit states
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => templates.find((t) => String(t.id) === selectedId) || null,
    [templates, selectedId]
  );

  const components = useMemo(() => parseComponents(selected), [selected]);
  const items = useMemo(() => flatItems(components), [components]);

  // Fetch templates on mount / tenant change
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingTemplates(true);
      setTemplatesError(null);
      try {
        const res = await fetch(`/api/templates?tenant_id=${encodeURIComponent(tenantId)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data as { error?: string })?.error || `Failed to load templates (${res.status})`);
        }
        // FastAPI returns array directly
        const list = Array.isArray(data) ? data : (data as { data?: GradingTemplateRead[] })?.data || [];
        if (!cancelled) {
          setTemplates(list);
          // auto-select first if none selected
          if (list.length > 0 && !selectedId) {
            setSelectedId(String(list[0].id));
          }
        }
      } catch (e) {
        if (!cancelled) setTemplatesError(e instanceof Error ? e.message : "Failed to load templates");
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset scores when template changes
  useEffect(() => {
    setScores({});
    setError(null);
    setSuccess(null);
    setFieldErrors({});
  }, [selectedId]);

  function handleScoreChange(key: string, raw: string, max: number) {
    // Allow empty for clearing
    let cleaned = raw.replace(/[^0-9]/g, "");
    if (cleaned !== "" && max > 0) {
      const n = parseInt(cleaned, 10);
      if (n > max) cleaned = String(max);
    }
    setScores((prev) => ({ ...prev, [key]: cleaned }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const c = { ...prev };
        delete c[key];
        return c;
      });
    }
    if (error) setError(null);
    if (success) setSuccess(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setFieldErrors({});

    // Basic required validation
    const nextFieldErrors: Record<string, string> = {};
    if (!selected) nextFieldErrors.template = "Select a grading template";
    if (!studentId.trim()) nextFieldErrors.studentId = "Student ID is required";
    if (!subject.trim()) nextFieldErrors.subject = "Subject is required";
    if (!term.trim()) nextFieldErrors.term = "Term is required";

    // Validate dynamic scores: must be present and within max
    for (const it of items) {
      const v = scores[it.key];
      if (v === undefined || v === "") {
        nextFieldErrors[it.key] = "Required";
      } else {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || isNaN(n)) nextFieldErrors[it.key] = "Must be a number";
        else if (n < 0) nextFieldErrors[it.key] = "Cannot be negative";
        else if (it.max > 0 && n > it.max) nextFieldErrors[it.key] = `Max ${it.max}`;
      }
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError("Please fix the highlighted fields.");
      return;
    }

    // Build scores dict numeric
    const scoresDict: Record<string, number> = {};
    for (const it of items) {
      const v = scores[it.key];
      // already validated present
      scoresDict[it.key] = parseInt(v, 10);
    }

    const body = {
      tenant_id: tenantId,
      student_id: studentId.trim(),
      subject: subject.trim(),
      term: term.trim(),
      template_id: selected ? selected.id : parseInt(selectedId, 10),
      scores: scoresDict,
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/records/academic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (data as { error?: string; detail?: string })?.error ||
          (data as { detail?: string })?.detail ||
          JSON.stringify(data);
        // 409 -> already exists, map to global + field
        if (res.status === 409) {
          throw new Error(
            typeof msg === "string" && msg.toLowerCase().includes("already exists")
              ? "Record already exists for this student / subject / term."
              : (msg as string) || "Record already exists."
          );
        }
        if (res.status === 422) {
          // backend validation (exceeds max) -> try to map to fields
          const detail = (data as { detail?: unknown })?.detail;
          const detailStr = Array.isArray(detail)
            ? (detail as Array<{ msg?: string; loc?: unknown }>).map((d) => d.msg).join("; ")
            : String(msg);
          throw new Error(detailStr);
        }
        throw new Error(typeof msg === "string" ? msg : `Failed (${res.status})`);
      }

      const total = (data as { total_score?: number })?.total_score;
      setSuccess(
        total !== undefined
          ? `Saved for ${body.student_id} — weighted total ${total}`
          : `Saved for ${body.student_id}.`
      );
      // Keep form active, clear Student ID + scores, retain template/subject/term per decision 3
      setStudentId("");
      setScores({});
      setFieldErrors({});
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save record.";
      // if 409, keep inline
      if (msg.toLowerCase().includes("already exists")) {
        setError(msg);
      } else {
        setError(msg);
      }
      console.error("[TeacherDataEntry] submit error", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Tenant badge */}
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white">
          <GraduationCap className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-medium text-purple-300/60">Tenant</p>
          <p className="font-mono text-sm font-semibold text-purple-100">{tenantId}</p>
        </div>
        <span className="ml-auto rounded-full border border-purple-500/15 bg-purple-900/20 px-3 py-1 text-xs font-medium text-purple-200">
          Staff Entry • Academic
        </span>
      </div>

      {/* State 1: Template dropdown */}
      <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 sm:p-5">
        <label className="text-sm font-medium text-purple-100">
          Grading Template <span className="text-red-400">*</span>
        </label>
        {loadingTemplates ? (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-purple-800/20 bg-purple-950/20 px-3 py-3 text-sm text-purple-300/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
          </div>
        ) : templatesError ? (
          <div className="mt-2 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{templatesError}</span>
          </div>
        ) : templates.length === 0 ? (
          <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300">
            No templates yet. Create one at <span className="font-mono">/admin/templates</span> first.
          </div>
        ) : (
          <>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="mt-2 flex h-10 w-full rounded-xl border border-purple-800/30 bg-purple-950/20 px-3 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              {templates.map((t) => {
                const comps = parseComponents(t);
                const weightSummary = comps.map((c) => `${c.name}:${c.weight}`).join(" / ");
                return (
                  <option key={t.id} value={String(t.id)} className="bg-[#0B0514]">
                    {t.name} {weightSummary ? `— ${weightSummary}` : ""}
                  </option>
                );
              })}
            </select>
            {fieldErrors.template && <p className="mt-1 text-xs text-red-400">{fieldErrors.template}</p>}
            {selected && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {components.map((c) => (
                  <span key={c.name} className="rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-1 font-medium text-purple-200">
                    {c.name}: {c.weight}%{c.items?.length ? ` • ${c.items.length} items` : ""}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* State 2: Standard inputs */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Input
            label="Student ID"
            placeholder="e.g., STU001"
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              if (fieldErrors.studentId) setFieldErrors((p) => ({ ...p, studentId: "" }));
              if (error) setError(null);
            }}
            error={fieldErrors.studentId}
            required
            disabled={submitting}
          />
        </div>
        <div>
          <Input
            label="Subject"
            placeholder="Mathematics"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              if (fieldErrors.subject) setFieldErrors((p) => ({ ...p, subject: "" }));
            }}
            error={fieldErrors.subject}
            required
            disabled={submitting}
          />
          <p className="mt-1 text-xs text-purple-300/40">Free-text — supports electives.</p>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-purple-100">
          Term <span className="text-red-400">*</span>
        </label>
        <select
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="mt-2 flex h-10 w-full rounded-xl border border-purple-800/30 bg-purple-950/20 px-3 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          disabled={submitting}
        >
          <option value="Term 1" className="bg-[#0B0514]">
            Term 1
          </option>
          <option value="Term 2" className="bg-[#0B0514]">
            Term 2
          </option>
          <option value="Term 3" className="bg-[#0B0514]">
            Term 3
          </option>
        </select>
        {fieldErrors.term && <p className="mt-1 text-xs text-red-400">{fieldErrors.term}</p>}
      </div>

      {/* State 3: Dynamic Grid */}
      {selected ? (
        <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Scores — {selected.name}</h3>
            <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-300">
              {items.length} field{items.length !== 1 ? "s" : ""}
            </span>
          </div>

          {items.length === 0 ? (
            <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300">
              This template has no assessment items. Edit it in Admin → Templates.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {components.map((cat) => {
                const catItems =
                  Array.isArray(cat.items) && cat.items.length > 0
                    ? cat.items
                    : [{ name: cat.name, max_score: (cat as unknown as { max_score?: number }).max_score ?? 0 } as { name: string; max_score: number }];
                return (
                  <div key={cat.name} className="rounded-xl border border-purple-500/10 bg-[#0B0514]/40 p-3 sm:p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">{cat.name}</p>
                      <span className="rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-1 text-xs font-medium text-purple-200">
                        {cat.weight}% weight
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {catItems.map((it) => {
                        const max = Number((it as { max_score?: number }).max_score ?? (it as { max?: number }).max ?? 0);
                        const val = scores[it.name] ?? "";
                        const n = val === "" ? NaN : parseInt(val, 10);
                        const over = Number.isFinite(n) && max > 0 && n > max;
                        return (
                          <div key={it.name} className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-purple-200/70">
                              {it.name} <span className="font-normal text-purple-300/40">/ {max}</span>
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={val}
                              onChange={(e) => handleScoreChange(it.name, e.target.value, max)}
                              placeholder={`0–${max}`}
                              disabled={submitting}
                              className={`flex h-10 w-full rounded-xl border bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:outline-none focus:ring-1 disabled:opacity-50 ${
                                fieldErrors[it.name] || over
                                  ? "border-red-500/60 focus:border-red-500 focus:ring-red-500"
                                  : "border-purple-800/30 focus:border-purple-500 focus:ring-purple-500"
                              }`}
                            />
                            {(fieldErrors[it.name] || over) && (
                              <p className="text-xs text-red-400">{fieldErrors[it.name] || `Max ${max}`}</p>
                            )}
                            {!fieldErrors[it.name] && !over && (
                              <p className="text-xs text-purple-300/30">Max {max}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Live preview dict */}
          <details className="mt-4 rounded-xl border border-white/5 bg-white/5">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white">Preview scores dict</summary>
            <pre className="max-h-40 overflow-auto border-t border-white/5 bg-[#0B0514] p-4 font-mono text-xs leading-5 text-emerald-300">
              {JSON.stringify(
                Object.fromEntries(
                  Object.entries(scores)
                    .filter(([, v]) => v !== "")
                    .map(([k, v]) => [k, parseInt(v, 10)])
                ),
                null,
                2
              )}
            </pre>
          </details>
        </div>
      ) : (
        !loadingTemplates && (
          <div className="rounded-xl border border-white/5 bg-white/5 p-4 text-center text-sm text-zinc-500">
            Select a template to generate the dynamic grid.
          </div>
        )
      )}

      {/* Global error / success */}
      {error && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <Button
        type="submit"
        disabled={submitting || loadingTemplates || !selected}
        className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
        size="lg"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving…
          </>
        ) : (
          <>
            <Save className="h-4 w-4" /> Save Academic Record
          </>
        )}
      </Button>
      <p className="text-center text-xs text-zinc-500">
        On save → <span className="font-mono">POST /api/records/academic</span> →{" "}
        <span className="font-mono">/api/v1/records/academic</span> (tenant:{" "}
        <span className="font-mono font-medium text-purple-300">{tenantId}</span>)
      </p>
    </form>
  );
}
