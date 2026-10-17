"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

interface AuditEntry {
  id: number | string;
  actor: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  subdomain: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

/** Action -> a sentence the reader recognises, rather than the raw code. */
const ACTION_LABELS: Record<string, string> = {
  "results.publish": "Published report cards",
  "roster.student_purged": "Deleted a student",
  "roster.staff_deleted": "Deleted a staff member",
  "roster.allocation_deleted": "Deleted an allocation",
  "roster.subject_deleted": "Deleted a subject",
  "roster.form_assignment_deleted": "Removed a form teacher",
  "roster.student_updated": "Edited a student",
  "roster.staff_updated": "Edited a staff member",
  "roster.form_assignment_updated": "Reassigned a form teacher",
  "clearance.held": "Placed a financial hold",
  "clearance.released": "Released a financial hold",
  "tenant.profile_updated": "Updated school profile",
  "tenant.email_changed": "Changes the admin login email",
  "moderator.promoted": "Promoted a moderator",
  "moderator.demoted": "Demoted a moderator",
};

const FILTERS = [
  { value: "", label: "All actions" },
  { value: "results", label: "Publishing" },
  { value: "roster", label: "Roster changes" },
  { value: "clearance", label: "Financial holds" },
  { value: "tenant", label: "School settings" },
  { value: "moderator", label: "Moderator changes" },
];

const PAGE_SIZE = 25;

export default function AuditLogClient({
  tenantId,
}: {
  tenantId: string;
  /** Accepted for parity with other admin clients; not currently rendered. */
  schoolName?: string;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        tenant_id: tenantId,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (filter) qs.set("action", filter);

      const res = await fetch(`/api/admin/audit?${qs.toString()}`, { cache: "no-store" });
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { entries?: AuditEntry[]; total?: number; error?: string };
      if (!res.ok) {
        setError(data.error || "Could not load the audit trail.");
        setLoading(false);
        return;
      }
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setTotal(Number(data.total) || 0);
    } catch {
      setError("Could not load the audit trail. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, offset, filter]);

  useEffect(() => {
    load();
  }, [load]);

  function formatWhen(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function detailSummary(d: Record<string, unknown> | null): string {
    if (!d) return "";
    const parts: string[] = [];
    if (typeof d.field === "string") parts.push(`field ${d.field}`);
    if (Array.isArray(d.fields)) parts.push(`fields: ${d.fields.join(", ")}`);
    if (Array.isArray(d.students)) parts.push(`${d.students.length} students`);
    if (Array.isArray(d.cascaded_rows)) {
      const total = d.cascaded_rows.reduce((a: number, b) => a + (Number(b) || 0), 0);
      parts.push(`${total} related rows removed`);
    }
    if (d.hold_reason) parts.push("with reason");
    return parts.join(" · ");
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="audit-filter" className="text-xs font-medium text-text-2">
          Filter
        </label>
        <select
          id="audit-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setOffset(0);
          }}
          className="min-h-[44px] rounded-xl border border-line-1 bg-surface-1 px-3 text-sm text-text-1"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        {total > 0 && (
          <span className="text-xs text-text-3">
            {total} {total === 1 ? "entry" : "entries"}
          </span>
        )}
        <button
          type="button"
          onClick={load}
          className="ml-auto inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line-1 bg-surface-1 px-3 text-xs font-medium text-text-2 transition hover:bg-surface-2"
        >
          Refresh
        </button>
      </div>

      {forbidden ? (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-5 text-sm text-warning">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            The audit trail is visible to the school admin only. Moderators cannot read the log —
            it records what the moderators did.
          </p>
        </div>
      ) : error ? (
        <p className="mt-6 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {error}
        </p>
      ) : loading ? (
        <p className="mt-6 text-sm text-text-3">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-6 text-sm text-text-3">No audit entries yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {entries.map((e) => (
            <li
              key={String(e.id)}
              className="rounded-xl border border-line-1 bg-surface-1 p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-text-1">
                  {ACTION_LABELS[e.action] || e.action}
                </span>
                <span
                  className={
                    e.actor_type === "moderator"
                      ? "rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-[0.7rem] font-medium text-warning"
                      : "rounded-full border border-line-1 bg-surface-2 px-2 py-0.5 text-[0.7rem] font-medium text-text-3"
                  }
                >
                  {e.actor_type === "moderator" ? "moderator" : "admin"}
                </span>
                <span className="ml-auto font-mono text-[0.7rem] text-text-3">
                  {formatWhen(e.created_at)}
                </span>
              </div>
              <p className="mt-1 text-xs text-text-2">
                by <span className="font-mono">{e.actor}</span>
              </p>
              {detailSummary(e.details) ? (
                <p className="mt-1 text-xs text-text-3">{detailSummary(e.details)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-line-1 bg-surface-1 px-4 text-xs font-medium text-text-2 transition hover:bg-surface-2 disabled:opacity-40"
          >
            Newer
          </button>
          <span className="text-xs text-text-3">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-line-1 bg-surface-1 px-4 text-xs font-medium text-text-2 transition hover:bg-surface-2 disabled:opacity-40"
          >
            Older
          </button>
        </div>
      )}
    </div>
  );
}