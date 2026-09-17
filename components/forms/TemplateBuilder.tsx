"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  GraduationCap,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Item = { id: string; name: string; max_score: string };
type Category = { id: string; name: string; weight: string; items: Item[] };

interface TemplateBuilderProps {
  tenantId: string; // uneditable, injected by server page app/[subdomain]/admin/templates
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateBuilder({ tenantId }: TemplateBuilderProps) {
  const [templateName, setTemplateName] = useState("");
  const [categories, setCategories] = useState<Category[]>([
    { id: uid(), name: "CA", weight: "40", items: [{ id: uid(), name: "Assignment 1", max_score: "10" }, { id: uid(), name: "Test 1", max_score: "30" }] },
    { id: uid(), name: "Exam", weight: "60", items: [] },
  ]);
  const [traits, setTraits] = useState<string[]>(["Punctuality", "Neatness", "Honesty"]);
  const [scale, setScale] = useState<string[]>(["A", "B", "C", "D", "E"]);
  const [traitInput, setTraitInput] = useState("");
  const [scaleInput, setScaleInput] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // derived
  const totalWeight = useMemo(
    () => categories.reduce((s, c) => s + (parseInt(c.weight) || 0), 0),
    [categories]
  );
  const weightOk = totalWeight === 100;
  const weightStatus = weightOk ? "ok" : totalWeight > 100 ? "over" : "under";

  // payload preview (matches schemas.py GradingTemplateCreate)
  const academic_structure = useMemo(() => {
    return {
      components: categories
        .filter((c) => c.name.trim())
        .map((c) => {
          const weight = parseInt(c.weight) || 0;
          const cleanItems = c.items
            .filter((i) => i.name.trim())
            .map((i) => ({ name: i.name.trim(), max_score: parseInt(i.max_score) || 0 }));
          if (cleanItems.length > 0) {
            return { name: c.name.trim(), weight, items: cleanItems };
          }
          // single exam-like without sub-items -> max_score on component? Use weight as placeholder? No, keep weight only
          // For Exam without items, backend expects max_score on component if needed; we emit with weight and no items
          return { name: c.name.trim(), weight, ...(cleanItems.length ? {} : {}) };
        }),
    };
  }, [categories]);

  const behavioral_structure = useMemo(() => {
    if (traits.length === 0 && scale.length === 0) return undefined;
    return { traits, scale };
  }, [traits, scale]);

  const payloadPreview = useMemo(() => {
    return {
      tenant_id: tenantId,
      name: templateName.trim() || "Junior Secondary Standard",
      academic_structure,
      behavioral_structure,
    };
  }, [tenantId, templateName, academic_structure, behavioral_structure]);

  // handlers
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

  function addTrait() {
    const v = traitInput.trim();
    if (!v || traits.includes(v)) return;
    setTraits((prev) => [...prev, v]);
    setTraitInput("");
  }
  function addScale() {
    const v = scaleInput.trim().toUpperCase();
    if (!v || scale.includes(v)) return;
    setScale((prev) => [...prev, v]);
    setScaleInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!templateName.trim() || templateName.trim().length < 3) {
      setError("Template name must be at least 3 characters.");
      return;
    }
    if (categories.length === 0) {
      setError("Add at least one academic category (e.g., CA, Exam).");
      return;
    }
    if (!weightOk) {
      setError(`Total weight must be exactly 100% (currently ${totalWeight}%).`);
      return;
    }
    // validate items
    for (const c of categories) {
      if (!c.name.trim()) {
        setError("All categories need a name.");
        return;
      }
      if (!c.weight || isNaN(parseInt(c.weight)) || parseInt(c.weight) <= 0) {
        setError(`Weight for "${c.name}" must be a positive number.`);
        return;
      }
      for (const it of c.items) {
        if (!it.name.trim() || !it.max_score || isNaN(parseInt(it.max_score)) || parseInt(it.max_score) <= 0) {
          setError(`Item in "${c.name}" needs a name and max score > 0.`);
          return;
        }
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
        const msg = (data as { error?: string; detail?: string })?.error || (data as { detail?: string })?.detail || `Failed (${res.status})`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      setSuccess(`Template "${body.name}" created for ${tenantId}.`);
      // toast + clear per decision 4
      setTemplateName("");
      setCategories([
        { id: uid(), name: "CA", weight: "40", items: [{ id: uid(), name: "Assignment 1", max_score: "10" }] },
        { id: uid(), name: "Exam", weight: "60", items: [] },
      ]);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create template.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header / tenant badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white">
            <GraduationCap className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-medium text-purple-300/60">Tenant</p>
            <p className="font-mono text-sm font-semibold text-purple-100">{tenantId}</p>
          </div>
        </div>
        <span className="rounded-full border border-purple-500/15 bg-purple-900/20 px-3 py-1 text-xs font-medium text-purple-200">
          JSONB • Grading Engine
        </span>
      </div>

      {/* Template Name */}
      <Input
        label="Template Name"
        placeholder='e.g., Junior Secondary Standard'
        value={templateName}
        onChange={(e) => setTemplateName(e.target.value)}
        required
      />

      {/* Academic Builder */}
      <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Academic Components</h3>
          <Button type="button" variant="outline" size="sm" onClick={addCategory} className="gap-1.5 rounded-full border-purple-500/20 bg-purple-950/20 text-purple-200 hover:bg-purple-900/30">
            <Plus className="h-3.5 w-3.5" /> Add Category
          </Button>
        </div>
        <p className="mt-1 text-xs text-purple-300/50">e.g., CA (40) + Exam (60). Inside each, add items with max scores.</p>

        {/* Weight summary */}
        <div
          className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
            weightOk
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : weightStatus === "over"
              ? "border-red-500/20 bg-red-500/10 text-red-300"
              : "border-amber-500/20 bg-amber-500/10 text-amber-300"
          }`}
        >
          {weightOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          Total weight: {totalWeight}% {weightOk ? "✓ balanced" : weightStatus === "over" ? "— over 100%" : "— must be 100%"}
          <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full transition-all ${weightOk ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${Math.min(100, totalWeight)}%` }} />
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {categories.map((cat) => (
            <div key={cat.id} className="rounded-xl border border-purple-500/10 bg-[#0B0514]/40 p-3 sm:p-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-purple-200/70">Category</label>
                  <input
                    value={cat.name}
                    onChange={(e) => updateCategory(cat.id, { name: e.target.value })}
                    placeholder="CA"
                    className="mt-1 flex h-9 w-full rounded-lg border border-purple-800/30 bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
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
                      className="flex h-9 w-full rounded-lg border border-purple-800/30 bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                    <span className="text-xs text-purple-300/50">%</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeCategory(cat.id)}
                  disabled={categories.length <= 1}
                  className="mt-6 flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/15 bg-red-500/5 text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                  aria-label="Remove category"
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
                      placeholder="1st Assignment"
                      className="flex h-8 flex-1 rounded-lg border border-purple-800/20 bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none"
                    />
                    <div className="flex w-28 items-center gap-1">
                      <input
                        value={it.max_score}
                        onChange={(e) => updateItem(cat.id, it.id, { max_score: e.target.value.replace(/[^0-9]/g, "") })}
                        placeholder="10"
                        inputMode="numeric"
                        className="flex h-8 w-full rounded-lg border border-purple-800/20 bg-purple-950/20 px-2 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none"
                      />
                      <span className="text-xs text-purple-300/40">max</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(cat.id, it.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addItem(cat.id)}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-purple-500/15 bg-purple-500/5 px-3 py-1 text-xs font-medium text-purple-300 hover:bg-purple-500/10"
                >
                  <Plus className="h-3 w-3" /> Add Assessment Item
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Behavioral Builder */}
      <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">Behavioral Traits</h3>
        <p className="mt-1 text-xs text-purple-300/50">A–E ratings shown on report card (VHS_01.jpg). Add traits + scale.</p>

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
            placeholder="Add trait e.g., Punctuality"
            className="flex h-9 flex-1 rounded-lg border border-purple-800/30 bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none"
          />
          <Button type="button" onClick={addTrait} size="sm" className="rounded-full bg-purple-600 text-white hover:bg-purple-500">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {traits.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-1 text-xs font-medium text-purple-200">
              {t}
              <button type="button" onClick={() => setTraits((p) => p.filter((x) => x !== t))} className="ml-1 rounded-full bg-white/10 p-0.5 hover:bg-white/20">
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
          {traits.length === 0 && <span className="text-xs text-purple-300/30">No traits yet.</span>}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={scaleInput}
            onChange={(e) => setScaleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addScale();
              }
            }}
            placeholder="Add grade e.g., A"
            maxLength={2}
            className="flex h-9 flex-1 rounded-lg border border-purple-800/30 bg-purple-950/20 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none"
          />
          <Button type="button" onClick={addScale} size="sm" variant="outline" className="rounded-full border-purple-500/20">
            <Plus className="h-3.5 w-3.5" /> Add Scale
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {scale.map((s) => (
            <span key={s} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-900">
              {s}
              <button type="button" onClick={() => setScale((p) => p.filter((x) => x !== s))} className="ml-1 text-zinc-500 hover:text-zinc-900">
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* JSON preview toggle */}
      <div className="rounded-xl border border-white/5 bg-white/5">
        <button
          type="button"
          onClick={() => setShowJson((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-white"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            {showJson ? "Hide JSON preview" : "Show JSON preview"} — visual summary
          </span>
          {showJson ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        {showJson && (
          <pre className="max-h-64 overflow-auto border-t border-white/5 bg-[#0B0514] p-4 font-mono text-xs leading-5 text-emerald-300">
            {JSON.stringify(payloadPreview, null, 2)}
          </pre>
        )}
        {!showJson && (
          <div className="border-t border-white/5 p-3 text-xs leading-5 text-zinc-500">
            <span className="font-medium text-white">{payloadPreview.name}</span> • {academic_structure.components.length} categories •{" "}
            {academic_structure.components.reduce((a, c) => a + (c.items?.length || 0), 0)} items • Behavioral: {traits.length} traits • Scale: {scale.join(", ")}
          </div>
        )}
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
          <span>{success} Check email — template will appear in data-entry grid.</span>
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
            <GraduationCap className="h-4 w-4" /> Save Template for {tenantId}
          </>
        )}
      </Button>
      <p className="text-center text-xs text-zinc-500">
        Tenant ID is fixed to <span className="font-mono font-medium text-purple-300">{tenantId}</span> and injected by the proxy — not editable.
      </p>
    </form>
  );
}
