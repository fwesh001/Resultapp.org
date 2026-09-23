"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, Pencil, Send, AlertCircle, CheckCircle2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface NotificationTemplate {
  event_type: string;
  category: "BILLING" | "SYSTEM" | "ONBOARDING" | "SECURITY";
  title_template: string;
  body_template: string;
  default_color: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ["BILLING", "SYSTEM", "ONBOARDING", "SECURITY"] as const;

const CATEGORY_BADGE: Record<string, string> = {
  BILLING: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  SYSTEM: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  ONBOARDING: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  SECURITY: "bg-red-500/15 text-red-300 border-red-500/30",
};

/** Superadmin Notifications — system templates CRUD + manual broadcast. */
export default function NotificationsPage() {
  const [tab, setTab] = useState<"templates" | "broadcast">("templates");
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Broadcast form state
  const [bTitle, setBTitle] = useState("");
  const [bMessage, setBMessage] = useState("");
  const [bCategory, setBCategory] = useState<(typeof CATEGORIES)[number]>("SYSTEM");
  const [bCta, setBCta] = useState("");
  const [bAudience, setBAudience] = useState<"all" | "tenant">("all");
  const [bSubdomain, setBSubdomain] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ notification_id: number; recipient_count: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/notifications/templates", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setTemplates((data as { templates?: NotificationTemplate[] }).templates || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "templates") void loadTemplates();
  }, [tab, loadTemplates]);

  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/superadmin/notifications/templates/${encodeURIComponent(editing.event_type)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title_template: editing.title_template,
            body_template: editing.body_template,
            category: editing.category,
            default_color: editing.default_color,
            is_active: editing.is_active,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Save failed (${res.status})`);
      const updated = (data as { template?: NotificationTemplate }).template;
      if (updated) setTemplates((prev) => prev.map((t) => (t.event_type === updated.event_type ? updated : t)));
      setEditing(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const [bRole, setBRole] = useState<"all" | "admin_only">("all");
  const [showBroadcastConfirm, setShowBroadcastConfirm] = useState(false);

  async function sendBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (bAudience === "all") {
      setShowBroadcastConfirm(true);
      return;
    }
    await runBroadcast();
  }

  async function runBroadcast() {
    setShowBroadcastConfirm(false);
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const res = await fetch("/api/superadmin/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: bTitle.trim(),
          message: bMessage.trim(),
          category: bCategory,
          cta_link: bCta.trim() || null,
          tenant_id: bAudience === "tenant" ? bSubdomain.trim().toLowerCase() : null,
          target_role: bRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Broadcast failed (${res.status})`);
      setSendResult({
        notification_id: (data as { notification_id?: number }).notification_id || 0,
        recipient_count: (data as { recipient_count?: number }).recipient_count || 0,
      });
      setBTitle("");
      setBMessage("");
      setBCta("");
      setBSubdomain("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Broadcast failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-purple-500/20 bg-purple-900/20">
          <Bell className="h-5 w-5 text-purple-300" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Notifications</h1>
          <p className="text-sm text-zinc-400">System templates for automated triggers + manual broadcasts.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-purple-500/20" role="tablist" aria-label="Notifications sections">
        {(["templates", "broadcast"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "border-b-2 border-purple-500 px-4 py-2.5 text-sm font-medium text-purple-300"
                : "px-4 py-2.5 text-sm text-zinc-400 transition hover:text-white"
            }
          >
            {t === "templates" ? "System Templates" : "Manual Broadcast"}
          </button>
        ))}
      </div>

      {tab === "templates" && (
        <section aria-label="System templates">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</p>
          ) : error ? (
            <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-purple-500/20">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-purple-500/20 bg-white/[0.02] text-xs uppercase tracking-wide text-zinc-400">
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Title template</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.event_type} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs text-white">{t.event_type}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${CATEGORY_BADGE[t.category] || "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"}`}>
                          {t.category}
                        </span>
                      </td>
                      <td className="max-w-[280px] truncate px-4 py-3 text-zinc-300">{t.title_template}</td>
                      <td className="px-4 py-3">
                        <span className={t.is_active ? "text-emerald-300" : "text-zinc-500"}>
                          {t.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => { setEditing({ ...t }); setSaveError(null); }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 px-3 py-1.5 text-xs text-purple-200 transition hover:bg-purple-900/30"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {templates.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">No templates found. Run the Phase 1 seed script.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "broadcast" && (
        <section aria-label="Manual broadcast" className="rounded-xl border border-purple-500/20 bg-white/[0.02] p-5">
          <form onSubmit={sendBroadcast} className="space-y-4">
            <div>
              <label htmlFor="b-title" className="mb-1 block text-sm font-medium text-zinc-200">Title</label>
              <input
                id="b-title" value={bTitle} onChange={(e) => setBTitle(e.target.value)} required maxLength={200}
                placeholder="Scheduled maintenance on Saturday"
                className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="b-message" className="mb-1 block text-sm font-medium text-zinc-200">Message</label>
              <textarea
                id="b-message" value={bMessage} onChange={(e) => setBMessage(e.target.value)} required maxLength={2000} rows={4}
                placeholder="The portal will be unavailable 2–4am WAT…"
                className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="b-category" className="mb-1 block text-sm font-medium text-zinc-200">Category</label>
                <select
                  id="b-category" value={bCategory} onChange={(e) => setBCategory(e.target.value as typeof bCategory)}
                  className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none"
                >
                  {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div>
                <label htmlFor="b-cta" className="mb-1 block text-sm font-medium text-zinc-200">CTA link <span className="font-normal text-zinc-500">(optional)</span></label>
                <input
                  id="b-cta" value={bCta} onChange={(e) => setBCta(e.target.value)} maxLength={500} placeholder="https://…"
                  className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-zinc-200">Audience</legend>
              <div className="flex flex-wrap gap-4 text-sm text-zinc-300">
                <label className="flex items-center gap-2">
                  <input type="radio" name="audience" checked={bAudience === "all"} onChange={() => setBAudience("all")} className="accent-purple-500" />
                  All Schools (platform-wide)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="audience" checked={bAudience === "tenant"} onChange={() => setBAudience("tenant")} className="accent-purple-500" />
                  Specific subdomain
                </label>
              </div>
              {bAudience === "tenant" && (
                <input
                  aria-label="Subdomain"
                  value={bSubdomain} onChange={(e) => setBSubdomain(e.target.value)} required
                  placeholder="vhs" pattern="[a-z0-9-]{3,30}"
                  className="mt-3 w-full max-w-xs rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
                />
              )}
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-zinc-200">Audience Role</legend>
              <div className="flex flex-wrap gap-4 text-sm text-zinc-300">
                <label className="flex items-center gap-2">
                  <input type="radio" name="audience-role" checked={bRole === "all"} onChange={() => setBRole("all")} className="accent-purple-500" />
                  All Users (Admin + Staff)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="audience-role" checked={bRole === "admin_only"} onChange={() => setBRole("admin_only")} className="accent-purple-500" />
                  Tenant Admins Only
                </label>
              </div>
            </fieldset>
            {sendError && (
              <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" /> {sendError}
              </p>
            )}
            {sendResult && (
              <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Dispatched #{sendResult.notification_id} to {sendResult.recipient_count} recipient(s).
              </p>
            )}
            <button
              type="submit" disabled={sending}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Dispatching…" : "Dispatch now"}
            </button>
          </form>
        </section>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Edit ${editing.event_type}`}>
          <div className="absolute inset-0 bg-black/70" onClick={() => setEditing(null)} aria-hidden="true" />
          <form
            onSubmit={saveTemplate}
            className="relative max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-purple-500/20 bg-[#140A24] p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-mono text-sm font-semibold text-white">{editing.event_type}</h2>
                <p className="text-xs text-zinc-400">Use {"{{variable}}"} placeholders — e.g. {"{{school_name}}, {{credits}}, {{subdomain}}"}.</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close editor" className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div>
              <label htmlFor="e-title" className="mb-1 block text-sm font-medium text-zinc-200">Title template</label>
              <input
                id="e-title" value={editing.title_template}
                onChange={(e) => setEditing({ ...editing, title_template: e.target.value })}
                required maxLength={500}
                className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="e-body" className="mb-1 block text-sm font-medium text-zinc-200">Body template</label>
              <textarea
                id="e-body" value={editing.body_template}
                onChange={(e) => setEditing({ ...editing, body_template: e.target.value })}
                required maxLength={2000} rows={4}
                className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="e-category" className="mb-1 block text-sm font-medium text-zinc-200">Category</label>
                <select
                  id="e-category" value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value as NotificationTemplate["category"] })}
                  className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none"
                >
                  {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div>
                <label htmlFor="e-color" className="mb-1 block text-sm font-medium text-zinc-200">Default color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color" value={editing.default_color}
                    onChange={(e) => setEditing({ ...editing, default_color: e.target.value })}
                    aria-label="Pick default color"
                    className="h-10 w-12 cursor-pointer rounded-lg border border-purple-500/20 bg-[#0B0514]"
                  />
                  <input
                    id="e-color" value={editing.default_color}
                    onChange={(e) => setEditing({ ...editing, default_color: e.target.value })}
                    pattern="#[0-9A-Fa-f]{6}" maxLength={7}
                    className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 font-mono text-sm text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox" checked={editing.is_active}
                onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                className="accent-purple-500"
              />
              Active (inactive templates are skipped by dispatch)
            </label>
            {saveError && (
              <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" /> {saveError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50">
                {saving ? "Saving…" : "Save template"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
