"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { LifeBuoy, Loader2, AlertCircle, Search, ChevronDown, ChevronUp, Paperclip, Star, RefreshCw } from "lucide-react";
import { Select, type SelectOption } from "@/components/ui/Select";

type TicketStatus = "open" | "in_progress" | "resolved";
type TicketType = "bug" | "feedback";

interface SupportTicket {
  id: string;
  type: TicketType;
  payload: Record<string, unknown>;
  tenant_id: string | null;
  submitter_email: string | null;
  submitter_role: string | null;
  submitter_kind: "admin" | "staff" | "anonymous";
  submitter_id: string | null;
  status: TicketStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUSES: Array<TicketStatus | "all"> = ["all", "open", "in_progress", "resolved"];
const TYPES: Array<TicketType | "all"> = ["all", "bug", "feedback"];

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  in_progress: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  resolved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const TYPE_BADGE: Record<TicketType, string> = {
  bug: "bg-red-500/15 text-red-300 border-red-500/30",
  feedback: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

const KIND_BADGE: Record<SupportTicket["submitter_kind"], string> = {
  admin: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  staff: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  anonymous: "bg-zinc-700/40 text-zinc-400 border-zinc-600/40",
};

const NEXT_STATUS: Record<TicketStatus, TicketStatus> = {
  open: "in_progress",
  in_progress: "resolved",
  resolved: "open",
};

const ACTION_LABEL: Record<TicketStatus, string> = {
  open: "Start",
  in_progress: "Resolve",
  resolved: "Reopen",
};

/** Payload values are untrusted strings — only ever render them as text. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function summaryOf(t: SupportTicket): string {
  return t.type === "bug" ? text(t.payload.what) : text(t.payload.idea);
}

function detailOf(t: SupportTicket): string {
  return t.type === "bug" ? text(t.payload.expected) : "";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 2592000) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [type, setType] = useState<TicketType | "all">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (status !== "all") qs.set("status", status);
      if (type !== "all") qs.set("type", type);
      if (query.trim()) qs.set("search", query.trim());

      const res = await fetch(`/api/superadmin/tickets?${qs.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        tickets?: SupportTicket[];
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setTickets(data.tickets || []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [page, status, type, query]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetToFirstPage() {
    setPage(1);
  }

  async function advance(ticket: SupportTicket) {
    const next = NEXT_STATUS[ticket.status];
    setBusyId(ticket.id);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/tickets/${encodeURIComponent(ticket.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { ticket?: SupportTicket; error?: string };
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      // Trust the server's row so resolved_at/resolved_by stay authoritative.
      if (data.ticket) {
        setTickets((prev) => prev.map((t) => (t.id === ticket.id ? data.ticket as SupportTicket : t)));
      } else {
        setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status: next } : t)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update ticket");
    } finally {
      setBusyId(null);
    }
  }

  const maxPage = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-purple-500/20 bg-purple-900/20">
            <LifeBuoy className="h-5 w-5 text-purple-300" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">Support Tickets</h1>
            <p className="text-sm text-zinc-400">
              Bug reports and feedback from every tenant, newest first.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-purple-500/30 px-3 py-2 text-sm text-purple-200 transition hover:bg-purple-900/30"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-purple-500/20 bg-white/[0.02] p-4">
        <div>
          <label htmlFor="f-status" className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
            Status
          </label>
<Select
              id="f-status"
              aria-label="Status"
              value={status}
              onChange={(v) => { setStatus(v as typeof status); resetToFirstPage(); }}
              options={STATUSES.map((s): SelectOption => ({ value: s, label: s === "all" ? "All statuses" : s.replace("_", " ") }))}
            />
        </div>
        <div>
          <label htmlFor="f-type" className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
            Type
          </label>
          <Select
            id="f-type"
            aria-label="Type"
            value={type}
            onChange={(v) => { setType(v as typeof type); resetToFirstPage(); }}
            options={TYPES.map((t): SelectOption => ({ value: t, label: t === "all" ? "All types" : t }))}
          />
        </div>
        <form
          className="flex-1"
          onSubmit={(e) => { e.preventDefault(); resetToFirstPage(); setQuery(search); }}
        >
          <label htmlFor="f-search" className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
            Search email, tenant or message
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="f-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="vhs, a@school.org, timeout…"
                className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] py-2 pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500"
            >
              Search
            </button>
          </div>
        </form>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tickets…
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-purple-500/20">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-purple-500/20 bg-white/[0.02] text-xs uppercase tracking-wide text-zinc-400">
                <th className="w-10 px-4 py-3"><span className="sr-only">Expand</span></th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Summary</th>
                <th className="px-4 py-3">Submitter</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Age</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const isOpen = expanded === t.id;
                const shot = text(t.payload.screenshot_url);
                const rating = typeof t.payload.rating === "number" ? t.payload.rating : null;
                return (
                  <Fragment key={t.id}>
                    <tr className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : t.id)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? "Hide details" : "Show details"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/5 hover:text-white"
                        >
                          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${TYPE_BADGE[t.type]}`}>
                          {t.type}
                        </span>
                      </td>
                      <td className="max-w-[320px] px-4 py-3 text-zinc-300">
                        <span className="line-clamp-2">{summaryOf(t) || <span className="text-zinc-600">—</span>}</span>
                        <span className="mt-1 flex items-center gap-2">
                          {shot && (
                            <span className="inline-flex items-center gap-1 text-xs text-purple-300">
                              <Paperclip className="h-3 w-3" /> file
                            </span>
                          )}
                          {rating !== null && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-amber-300">
                              <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {rating}/5
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-zinc-300">{t.submitter_email || <span className="text-zinc-600">—</span>}</div>
                        <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-xs ${KIND_BADGE[t.submitter_kind]}`}>
                          {t.submitter_kind}{t.submitter_role ? ` · ${t.submitter_role}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {t.tenant_id || <span className="font-sans text-zinc-600">anonymous</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${STATUS_BADGE[t.status]}`}>
                          {t.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400" title={new Date(t.created_at).toLocaleString()}>
                        {relativeTime(t.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void advance(t)}
                          disabled={busyId === t.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 px-3 py-1.5 text-xs text-purple-200 transition hover:bg-purple-900/30 disabled:opacity-50"
                        >
                          {busyId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {ACTION_LABEL[t.status]}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-white/5 bg-black/20">
                        <td colSpan={8} className="px-6 py-5">
                          <dl className="grid gap-5 md:grid-cols-2">
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                {t.type === "bug" ? "What happened?" : "Idea"}
                              </dt>
                              <dd className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">
                                {summaryOf(t) || "—"}
                              </dd>
                            </div>
                            {t.type === "bug" && (
                              <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                  What did you expect?
                                </dt>
                                <dd className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">
                                  {detailOf(t) || "—"}
                                </dd>
                              </div>
                            )}
                          </dl>

                          {shot && (
                            <p className="mt-4">
                              <a
                                href={shot}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1.5 text-sm text-purple-300 underline underline-offset-4 hover:text-purple-200"
                              >
                                <Paperclip className="h-4 w-4" /> View attachment
                              </a>
                            </p>
                          )}

                          <dl className="mt-5 grid gap-x-8 gap-y-2 text-xs text-zinc-500 sm:grid-cols-2">
                            <div><span className="text-zinc-600">Ticket:</span> <span className="font-mono">{t.id}</span></div>
                            <div><span className="text-zinc-600">Created:</span> {new Date(t.created_at).toLocaleString()}</div>
                            {t.submitter_id && (
                              <div><span className="text-zinc-600">Submitter ID:</span> <span className="font-mono">{t.submitter_id}</span></div>
                            )}
                            {t.resolved_at && (
                              <div>
                                <span className="text-zinc-600">Resolved:</span> {new Date(t.resolved_at).toLocaleString()}
                                {t.resolved_by ? ` by ${t.resolved_by}` : ""}
                              </div>
                            )}
                          </dl>

                          {t.resolution_note && (
                            <p className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200">
                              {t.resolution_note}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                    No tickets match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <span>
            Page {page} of {maxPage} · {total} ticket{total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-purple-500/30 px-3 py-1.5 transition hover:bg-purple-900/30 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
              disabled={page >= maxPage}
              className="rounded-lg border border-purple-500/30 px-3 py-1.5 transition hover:bg-purple-900/30 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
