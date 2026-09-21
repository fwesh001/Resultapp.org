"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Power,
  PowerOff,
  Trash2,
  Loader2,
  AlertCircle,
  BookOpen,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TemplateBuilder } from "@/components/forms/TemplateBuilder";

interface TemplateItem {
  id: number;
  tenant_id: string;
  name: string;
  academic_structure?: { components?: Array<{ items?: unknown[] }> } | null;
  behavioral_structure?: { traits?: string[]; scale?: string[]; scale_labels?: Record<string, string> } | null;
  applies_to_classes?: string[];
  is_active?: boolean;
  created_at?: string;
  updated_at?: string | null;
}

interface Props {
  tenantId: string;
  schoolName?: string;
  classOptions?: string[];
}

export function TemplatesManager({ tenantId, schoolName, classOptions }: Props) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const [knownClasses, setKnownClasses] = useState<string[]>([]);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates?tenant_id=${encodeURIComponent(tenantId)}&include_inactive=true`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed to load (${res.status})`);
      const list = Array.isArray(data) ? data : (data as { templates?: TemplateItem[] }).templates ?? [];
      setTemplates(list as TemplateItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  async function handleToggleActive(t: TemplateItem) {
    setActingId(t.id);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/templates?id=${t.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, is_active: !(t.is_active ?? true) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setNotice(`"${t.name}" ${t.is_active ?? true ? "disabled" : "enabled"}.`);
      await fetchTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActingId(null);
    }
  }

  async function handleDelete(t: TemplateItem) {
    if (!window.confirm(`Disable template "${t.name}"? Staff will stop seeing it. History is preserved.`)) return;
    setActingId(t.id);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/templates?id=${t.id}&tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setNotice(`"${t.name}" disabled.`);
      if (editing?.id === t.id) {
        setEditing(null);
        setShowBuilder(false);
      }
      await fetchTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setActingId(null);
    }
  }

  function startEdit(t: TemplateItem) {
    setEditing(t);
    setShowBuilder(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startCreate() {
    setEditing(null);
    setShowBuilder(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const activeCount = templates.filter((t) => t.is_active ?? true).length;

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* List */}
      <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-5 backdrop-blur-xl sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">
              Templates ({activeCount} active)
            </h2>
            <p className="mt-0.5 text-xs text-purple-300/50">
              Bind each template to classes — empty means all classes.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={showBuilder && !editing ? () => setShowBuilder(false) : startCreate}
            className="shrink-0 gap-1.5 rounded-full bg-purple-600 text-white hover:bg-purple-500"
          >
            <Plus className="h-3.5 w-3.5" /> {showBuilder && !editing ? "Hide Builder" : "New Template"}
          </Button>
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] px-4 py-6 text-sm text-purple-200/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-6 text-center">
              <BookOpen className="mx-auto h-6 w-6 text-purple-300/60" />
              <h3 className="mt-2 text-sm font-semibold text-white">No templates yet</h3>
              <p className="mt-1 text-xs text-purple-200/60">Create your first template with the builder below.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => {
                const active = t.is_active ?? true;
                const itemCount =
                  t.academic_structure?.components?.reduce((s, c) => s + (c.items?.length ?? 0), 0) ?? 0;
                const classes = t.applies_to_classes ?? [];
                return (
                  <div
                    key={t.id}
                    className={[
                      "flex flex-col gap-3 rounded-xl border px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between",
                      active
                        ? "border-purple-500/15 bg-purple-900/[0.04]"
                        : "border-zinc-500/15 bg-white/[0.02] opacity-70",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">{t.name}</p>
                        <span
                          className={
                            active
                              ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/20"
                              : "rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] font-medium text-zinc-400 ring-1 ring-zinc-500/20"
                          }
                        >
                          {active ? "Active" : "Disabled"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-purple-200/50">
                        {itemCount} assessment item{itemCount === 1 ? "" : "s"} •{" "}
                        {classes.length > 0 ? `Classes: ${classes.join(", ")}` : "All classes"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        disabled={!active || actingId === t.id}
                        className="inline-flex items-center gap-1 rounded-full border border-purple-500/15 bg-purple-900/10 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-40"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(t)}
                        disabled={actingId === t.id}
                        className="inline-flex items-center gap-1 rounded-full border border-purple-500/15 bg-purple-900/10 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-40"
                      >
                        {actingId === t.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : active ? (
                          <PowerOff className="h-3 w-3" />
                        ) : (
                          <Power className="h-3 w-3" />
                        )}
                        {active ? "Disable" : "Enable"}
                      </button>
                      {active && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(t)}
                          disabled={actingId === t.id}
                          aria-label={`Disable ${t.name}`}
                          className="inline-flex items-center justify-center rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Builder */}
      {showBuilder && (
        <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-5 backdrop-blur-xl sm:p-6">
          <TemplateBuilder
            key={editing ? `edit-${editing.id}` : "new"}
            tenantId={tenantId}
            schoolName={schoolName}
            templateId={editing?.id ?? null}
            classOptions={classOptions}
            initial={
              editing
                ? {
                    name: editing.name,
                    academic_structure: editing.academic_structure,
                    behavioral_structure: editing.behavioral_structure,
                    applies_to_classes: editing.applies_to_classes ?? [],
                  }
                : null
            }
            onSaved={() => {
              setShowBuilder(false);
              setEditing(null);
              void fetchTemplates();
            }}
            onCancelEdit={() => {
              setEditing(null);
              setShowBuilder(false);
            }}
          />
        </div>
      )}

      <p className="text-center text-xs text-purple-300/40">
        Saved templates appear automatically when staff enter scores.
      </p>
    </div>
  );
}
