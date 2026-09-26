"use client";

import { useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import type { RemarkBand } from "@/types/school";

export const EMPTY_BAND: RemarkBand = { min: 0, max: 0, text: "" };

/** Client-side mirror of the server band rules (server re-validates). */
export function validateBandsClient(bands: RemarkBand[]): string | null {
  if (bands.length > 20) return "At most 20 bands";
  const cleaned = bands.map((b) => ({
    min: Number(b.min),
    max: Number(b.max),
    text: String(b.text || "").trim(),
  }));
  for (let i = 0; i < cleaned.length; i++) {
    const b = cleaned[i];
    if (!Number.isFinite(b.min) || !Number.isFinite(b.max)) return `Band ${i + 1}: min and max must be numbers`;
    if (b.min > b.max) return `Band ${i + 1}: min must be ≤ max`;
    if (!b.text) return `Band ${i + 1}: text is required`;
    if (b.text.length > 500) return `Band ${i + 1}: text exceeds 500 characters`;
  }
  const sorted = [...cleaned].sort((a, b) => a.min - b.min || a.max - b.max);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min <= sorted[i - 1].max) {
      return `Bands overlap: [${sorted[i - 1].min}, ${sorted[i - 1].max}] and [${sorted[i].min}, ${sorted[i].max}]`;
    }
  }
  return null;
}

/** Shared grade-band scheme editor (principal + form-teacher surfaces). */
export default function SchemeBuilder({
  initial,
  onSave,
  accent = "purple",
}: {
  initial: RemarkBand[];
  onSave: (bands: RemarkBand[]) => Promise<void>;
  accent?: "purple" | "emerald";
}) {
  const [bands, setBands] = useState<RemarkBand[]>(() =>
    initial.map((b) => ({ min: Number(b.min) || 0, max: Number(b.max) || 0, text: String(b.text || "") })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const solid = accent === "emerald" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-purple-600 hover:bg-purple-500";
  const inputCls =
    "h-10 rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 text-sm text-white placeholder:text-purple-300/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500";

  function update(idx: number, patch: Partial<RemarkBand>) {
    setBands((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
    setError(null);
  }

  function remove(idx: number) {
    setBands((prev) => prev.filter((_, i) => i !== idx));
    setError(null);
  }

  async function save() {
    const problem = validateBandsClient(bands);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        bands.map((b) => ({ min: Number(b.min), max: Number(b.max), text: String(b.text).trim() })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-purple-300/50">
        Bands map an average % to remark text (inclusive bounds). Gaps are allowed — averages in gaps get no auto-remark and stay manual.
      </p>
      {bands.length === 0 && (
        <p className="rounded-xl border border-dashed border-purple-500/25 px-4 py-6 text-center text-sm text-purple-300/50">
          No bands yet. Add your first band below.
        </p>
      )}
      {bands.map((b, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-3 sm:flex-row sm:items-center">
          <label className="flex flex-1 items-center gap-2 text-xs text-purple-300/60">
            Min %
            <input
              type="number"
              min={0}
              max={100}
              value={Number.isFinite(b.min) ? b.min : 0}
              onChange={(e) => update(i, { min: Number(e.target.value) })}
              aria-label={`Band ${i + 1} min percent`}
              className={`${inputCls} w-full`}
            />
          </label>
          <label className="flex flex-1 items-center gap-2 text-xs text-purple-300/60">
            Max %
            <input
              type="number"
              min={0}
              max={100}
              value={Number.isFinite(b.max) ? b.max : 0}
              onChange={(e) => update(i, { max: Number(e.target.value) })}
              aria-label={`Band ${i + 1} max percent`}
              className={`${inputCls} w-full`}
            />
          </label>
          <input
            type="text"
            value={b.text}
            onChange={(e) => update(i, { text: e.target.value })}
            placeholder="e.g., An excellent result. Keep it up."
            maxLength={500}
            aria-label={`Band ${i + 1} remark text`}
            className={`${inputCls} flex-[2]`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Remove band ${i + 1}`}
            className="inline-flex items-center justify-center self-end rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15 sm:self-center"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setBands((prev) => (prev.length >= 20 ? prev : [...prev, { ...EMPTY_BAND }]))}
          disabled={bands.length >= 20}
          className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/20 px-4 py-2 text-sm text-purple-200 hover:bg-white/5 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Add band
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={`inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${solid}`}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save scheme
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
