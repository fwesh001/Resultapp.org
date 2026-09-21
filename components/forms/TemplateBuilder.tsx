"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Calculator,
  HeartHandshake,
  GraduationCap,
  Loader2,
  Save,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Item = { id: string; name: string; max_score: string };
type Category = { id: string; name: string; weight: string; items: Item[] };
type Grade = { id: string; grade: string; label: string };

interface TemplateBuilderProps {
  tenantId: string; // uneditable, injected by server page app/[subdomain]/admin/templates
  schoolName?: string; // friendly display name for copy
  /** Edit mode: id of the template being edited (PUT instead of POST). */
  templateId?: number | null;
  /** Initial values for edit mode (parent remounts via key on change). */
  initial?: {
    name?: string;
    academic_structure?: { components?: Array<{ name?: string; weight?: number | string; items?: Array<{ name?: string; max_score?: number | string; max?: number | string }> }> } | null;
    behavioral_structure?: { traits?: string[]; scale?: string[]; scale_labels?: Record<string, string> } | null;
    applies_to_classes?: string[];
  } | null;
  /** Known class names for the applies-to suggestions (optional; free-text always allowed). */
  classOptions?: string[];
  /** Called after a successful save in edit mode (parent refreshes list). */
  onSaved?: () => void;
  /** Called when the user cancels edit mode. */
  onCancelEdit?: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// Nigerian standard defaults (mirrors the physical report sheet)
// ---------------------------------------------------------------------------

const DEFAULT_TRAITS = [
  "Punctuality",
  "Honesty",
  "Self-Control",
  "Attentiveness in Class",
  "Neatness",
  "Determination",
  "Relationship with others",
  "Leadership",
  "Participation in School Activities",
  "Games/Sport",
  "Handling of Tools/Materials",
  "Fluency",
  "Carrying out Assignment",
];

const DEFAULT_GRADES: Grade[] = [
  { id: "g-a", grade: "A", label: "Excellent" },
  { id: "g-b", grade: "B", label: "Good" },
  { id: "g-c", grade: "C", label: "Fair" },
  { id: "g-d", grade: "D", label: "Poor" },
  { id: "g-e", grade: "E", label: "V.Poor" },
];

function defaultCategories(): Category[] {
  return [
    {
      id: uid(),
      name: "Continuous Assessment",
      weight: "40",
      items: [
        { id: uid(), name: "Assignment", max_score: "10" },
        { id: uid(), name: "Test", max_score: "30" },
      ],
    },
    {
      id: uid(),
      name: "Examination",
      weight: "60",
      items: [{ id: uid(), name: "Exam", max_score: "60" }],
    },
  ];
}

function defaultGrades(): Grade[] {
  return DEFAULT_GRADES.map((g) => ({ ...g, id: uid() }));
}

const inputClass =
  "flex h-9 w-full rounded-lg border border-purple-800/30 bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateBuilder({ tenantId, schoolName }: TemplateBuilderProps) {
  const [activeTab, setActiveTab] = useState<"academic" | "traits">("academic");
  const [templateName, setTemplateName] = useState("");
  const [categories, setCategories] = useState<Category[]>(defaultCategories);
  const [traits, setTraits] = useState<string[]>(DEFAULT_TRAITS);
  const [grades, setGrades] = useState<Grade[]>(defaultGrades);
  const [traitInput, setTraitInput] = useState("");
  const [gradeInput, setGradeInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // derived — academic weights
  const totalWeight = useMemo(
    () => categories.reduce((s, c) => s + (parseInt(c.weight) || 0), 0),
    [categories]
  );
  const weightOk = totalWeight === 100;
  const weightStatus = weightOk ? "ok" : totalWeight > 100 ? "over" : "under";

  const itemsSum = (c: Category) =>
    c.items.reduce((s, i) => s + (parseInt(i.max_score) || 0), 0);

  // submission data (matches backend GradingTemplateCreate)
  const academic_structure = useMemo(() => {
    return {
      components: categories
        .filter((c) => c.name.trim())
        .map((c) => ({
          name: c.name.trim(),
          weight: parseInt(c.weight) || 0,
          items: c.items
            .filter((i) => i.name.trim())
            .map((i) => ({ name: i.name.trim(), max_score: parseInt(i.max_score) || 0 })),
        })),
    };
  }, [categories]);

  const behavioral_structure = useMemo(() => {
    if (traits.length === 0 && grades.length === 0) return undefined;
    const scale_labels: Record<string, string> = {};
    for (const g of grades) {
      if (g.grade.trim()) scale_labels[g.grade.trim().toUpperCase()] = g.label.trim();
    }
    return {
      traits,
      scale: grades.map((g) => g.grade.trim().toUpperCase()).filter(Boolean),
      ...(Object.keys(scale_labels).length > 0 ? { scale_labels } : {}),
    };
  }, [traits, grades]);

  // handlers — categories & items
  function addCategory() {
    setCategories((prev) => [...prev, { id: uid(), name: "", weight: "", items: [] }]);
  }
  function updateCategory(id: string, patch: Partial<Category>) {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removeCategory(id: string) {
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }
  function addItem(catId: string) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId ? { ...c, items: [...c.items, { id: uid(), name: "", max_score: "" }] } : c
      )
    );
  }
  function updateItem(catId: string, itemId: string, patch: Partial<Item>) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : c
      )
    );
  }
  function removeItem(catId: string, itemId: string) {
    setCategories((prev) =>
      prev.map((c) => (c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c))
    );
  }

  // handlers — traits & rating scale
  function addTrait() {
    const v = traitInput.trim();
    if (!v || traits.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    setTraits((prev) => [...prev, v]);
    setTraitInput("");
  }
  function addGrade() {
    const grade = gradeInput.trim().toUpperCase();
    const label = labelInput.trim();
    if (!grade || !label) return;
    if (grades.some((g) => g.grade.toUpperCase() === grade)) return;
    setGrades((prev) => [...prev, { id: uid(), grade, label }]);
    setGradeInput("");
    setLabelInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!templateName.trim() || templateName.trim().length < 3) {
      setError("Please give your template a name (at least 3 characters).");
      return;
    }
    if (categories.length === 0) {
      setError("Add at least one scoring section (e.g. Continuous Assessment, Examination).");
      return;
    }
    if (!weightOk) {
      setError(`Section weights must add up to 100% (currently ${totalWeight}%).`);
      return;
    }
    for (const c of categories) {
      if (!c.name.trim()) {
        setError("Every scoring section needs a name.");
        return;
      }
      if (!c.weight || isNaN(parseInt(c.weight)) || parseInt(c.weight) <= 0) {
        setError(`Weight for "${c.name}" must be a number above 0.`);
        return;
      }
      for (const it of c.items) {
        if (!it.name.trim() || !it.max_score || isNaN(parseInt(it.max_score)) || parseInt(it.max_score) <= 0) {
          setError(`Each item under "${c.name}" needs a name and a maximum score above 0.`);
          return;
        }
      }
    }
    for (const g of grades) {
      if (!g.grade.trim() || !g.label.trim()) {
        setError("Every rating needs a grade letter and a meaning (e.g. A = Excellent).");
        return;
      }
    }

    const body = {
      tenant_id: tenantId,
      name: templateName.trim(),
      academic_structure,
      behavioral_structure,
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { error?: string; detail?: string })?.error || (data as { detail?: string })?.detail || `Could not save (error ${res.status})`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      setSuccess(`"${body.name}" is ready to use.`);
      setTemplateName("");
      setCategories(defaultCategories());
      setTraits(DEFAULT_TRAITS);
      setGrades(defaultGrades());
      setActiveTab("academic");
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the template. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const itemCount = academic_structure.components.reduce((a, c) => a + (c.items?.length || 0), 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* School badge */}
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white">
          <GraduationCap className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-medium text-purple-300/60">Setting up for</p>
          <p className="text-sm font-semibold text-purple-100">{schoolName || tenantId}</p>
        </div>
      </div>

      {/* Template name */}
      <Input
        label="Template name"
        placeholder="e.g. 2025/2026 Standard Template"
        value={templateName}
        onChange={(e) => setTemplateName(e.target.value)}
        required
      />

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-2">
        <button
          type="button"
          onClick={() => setActiveTab("academic")}
          className={
            activeTab === "academic"
              ? "flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-3 py-2.5 text-sm font-semibold text-white"
              : "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-purple-200/70 transition hover:bg-white/5 hover:text-white"
          }
        >
          <Calculator className="h-4 w-4" />
          <span className="hidden sm:inline">Academic Scoring Structure</span>
          <span className="sm:hidden">Scores</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("traits")}
          className={
            activeTab === "traits"
              ? "flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-3 py-2.5 text-sm font-semibold text-white"
              : "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-purple-200/70 transition hover:bg-white/5 hover:text-white"
          }
        >
          <HeartHandshake className="h-4 w-4" />
          <span className="hidden sm:inline">Behavioural &amp; Psychomotor Traits</span>
          <span className="sm:hidden">Traits</span>
        </button>
      </div>

      {/* Tab 1 — Academic scoring */}
      {activeTab === "academic" && (
        <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">How are scores divided?</h3>
              <p className="mt-0.5 text-xs text-purple-300/50">
                Set the weight of each section. The weights must add up to 100%.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCategory}
              className="shrink-0 gap-1.5 rounded-full border-purple-500/20 bg-purple-950/20 text-purple-200 hover:bg-purple-900/30"
            >
              <Plus className="h-3.5 w-3.5" /> Add Section
            </Button>
          </div>

          {/* Total weight indicator */}
          <div
            className={`mt-3 rounded-xl border px-3 py-2.5 ${
              weightOk
                ? "border-emerald-500/20 bg-emerald-500/10"
                : weightStatus === "over"
                  ? "border-red-500/20 bg-red-500/10"
                  : "border-amber-500/20 bg-amber-500/10"
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-medium">
              {weightOk ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-amber-300" />
              )}
              <span className={weightOk ? "text-emerald-300" : weightStatus === "over" ? "text-red-300" : "text-amber-300"}>
                Total: {totalWeight}% {weightOk ? "— perfectly balanced" : weightStatus === "over" ? "— too high, reduce a section" : "— add more weight to reach 100%"}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full transition-all ${weightOk ? "bg-emerald-400" : weightStatus === "over" ? "bg-red-400" : "bg-amber-400"}`}
                style={{ width: `${Math.min(100, totalWeight)}%` }}
              />
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {categories.map((cat) => {
              const sum = itemsSum(cat);
              const weight = parseInt(cat.weight) || 0;
              const balanced = sum > 0 && sum === weight;
              return (
                <div key={cat.id} className="rounded-xl border border-purple-500/10 bg-[#0B0514]/40 p-3 sm:p-4">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-purple-200/70">Section name</label>
                      <input
                        value={cat.name}
                        onChange={(e) => updateCategory(cat.id, { name: e.target.value })}
                        placeholder="e.g. Continuous Assessment"
                        className={`${inputClass} mt-1`}
                      />
                    </div>
                    <div className="w-24 sm:w-28">
                      <label className="text-xs font-medium text-purple-200/70">Weight</label>
                      <div className="mt-1 flex items-center gap-1">
                        <input
                          value={cat.weight}
                          onChange={(e) => updateCategory(cat.id, { weight: e.target.value.replace(/[^0-9]/g, "") })}
                          placeholder="40"
                          inputMode="numeric"
                          className={inputClass}
                        />
                        <span className="text-xs text-purple-300/50">%</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCategory(cat.id)}
                      disabled={categories.length <= 1}
                      className="mt-6 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-500/15 bg-red-500/5 text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                      aria-label={`Remove ${cat.name || "section"}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Items */}
                  <div className="mt-3 space-y-2">
                    {cat.items.map((it) => (
                      <div key={it.id} className="flex gap-2">
                        <input
                          value={it.name}
                          onChange={(e) => updateItem(cat.id, it.id, { name: e.target.value })}
                          placeholder="e.g. Assignment"
                          aria-label="Assessment item name"
                          className="flex h-8 flex-1 rounded-lg border border-purple-800/20 bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none"
                        />
                        <div className="flex w-28 items-center gap-1">
                          <input
                            value={it.max_score}
                            onChange={(e) => updateItem(cat.id, it.id, { max_score: e.target.value.replace(/[^0-9]/g, "") })}
                            placeholder="10"
                            inputMode="numeric"
                            aria-label="Maximum score"
                            className="flex h-8 w-full rounded-lg border border-purple-800/20 bg-purple-950/20 px-2 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none"
                          />
                          <span className="text-xs text-purple-300/40">max</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(cat.id, it.id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10"
                          aria-label={`Remove ${it.name || "item"}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => addItem(cat.id)}
                        className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-purple-500/15 bg-purple-500/5 px-3 py-1 text-xs font-medium text-purple-300 hover:bg-purple-500/10"
                      >
                        <Plus className="h-3 w-3" /> Add Assessment Item
                      </button>
                      {cat.items.length > 0 && (
                        <span className={`text-xs ${balanced ? "text-emerald-300/80" : "text-purple-300/40"}`}>
                          Items add up to {sum} (weight {weight}%)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2 — Behavioural & psychomotor traits */}
      {activeTab === "traits" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-white">Student traits</h3>
            <p className="mt-1 text-xs text-purple-300/50">
              These appear on the report sheet just like the physical report. Add your own or remove any you don&apos;t use.
            </p>

            <div className="mt-3 flex gap-2">
              <input
                value={traitInput}
                onChange={(e) => setTraitInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTrait();
                  }
                }}
                placeholder="Add a trait, e.g. Team Spirit"
                className={`${inputClass} h-9 flex-1`}
              />
              <Button type="button" onClick={addTrait} size="sm" className="rounded-full bg-purple-600 text-white hover:bg-purple-500">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {traits.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-1 text-xs font-medium text-purple-200">
                  {t}
                  <button
                    type="button"
                    onClick={() => setTraits((p) => p.filter((x) => x !== t))}
                    className="ml-1 rounded-full bg-white/10 p-0.5 hover:bg-white/20"
                    aria-label={`Remove ${t}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {traits.length === 0 && <span className="text-xs text-purple-300/30">No traits yet — add your first one above.</span>}
            </div>
          </div>

          <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-white">Rating scale</h3>
            <p className="mt-1 text-xs text-purple-300/50">
              Staff grade each trait with these ratings. Give every grade a clear meaning.
            </p>

            <div className="mt-3 space-y-2">
              {grades.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <span className="flex h-9 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-zinc-900">
                    {g.grade || "–"}
                  </span>
                  <input
                    value={g.grade}
                    onChange={(e) =>
                      setGrades((prev) => prev.map((x) => (x.id === g.id ? { ...x, grade: e.target.value.toUpperCase().slice(0, 2) } : x)))
                    }
                    placeholder="A"
                    maxLength={2}
                    aria-label="Grade letter"
                    className="h-9 w-16 rounded-lg border border-purple-800/30 bg-purple-950/20 px-2 text-center text-sm font-semibold text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none"
                  />
                  <span className="text-sm text-purple-300/50">=</span>
                  <input
                    value={g.label}
                    onChange={(e) => setGrades((prev) => prev.map((x) => (x.id === g.id ? { ...x, label: e.target.value } : x)))}
                    placeholder="Excellent"
                    aria-label={`Meaning of grade ${g.grade || "rating"}`}
                    className="flex h-9 flex-1 rounded-lg border border-purple-800/30 bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setGrades((prev) => prev.filter((x) => x.id !== g.id))}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10"
                    aria-label={`Remove grade ${g.grade || "rating"}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={gradeInput}
                onChange={(e) => setGradeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGrade();
                  }
                }}
                placeholder="Grade, e.g. F"
                maxLength={2}
                aria-label="New grade letter"
                className={`${inputClass} h-9 sm:w-32`}
              />
              <input
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGrade();
                  }
                }}
                placeholder="Meaning, e.g. Fail"
                aria-label="New grade meaning"
                className={`${inputClass} h-9 flex-1`}
              />
              <Button type="button" onClick={addGrade} size="sm" variant="outline" className="rounded-full border-purple-500/20">
                <Plus className="h-3.5 w-3.5" /> Add Rating
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Plain-language summary */}
      <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-4 text-xs leading-6 text-purple-200/70">
        <span className="font-semibold text-white">{templateName.trim() || "Your template"}</span>
        {" — "}
        {categories.length} scoring section{categories.length === 1 ? "" : "s"} ({totalWeight}% total) • {itemCount} assessment item{itemCount === 1 ? "" : "s"} • {traits.length} trait{traits.length === 1 ? "" : "s"} • Ratings: {grades.map((g) => g.grade || "–").join(", ") || "none yet"}
      </div>

      {/* Errors / success */}
      {error && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success} Staff will see it when entering scores.</span>
        </div>
      )}

      <Button
        type="submit"
        disabled={submitting || !weightOk}
        className="w-full gap-2 rounded-full bg-purple-600 font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
        size="lg"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving template…
          </>
        ) : (
          <>
            <Save className="h-4 w-4" /> Save Template
          </>
        )}
      </Button>
      <p className="text-center text-xs text-purple-300/40">
        This template will be saved for {schoolName || tenantId} and used on every report card.
      </p>
    </form>
  );
}
