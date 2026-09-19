"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Coins,
  Loader2,
  Megaphone,
  Send,
  Users,
} from "lucide-react";
import { toast } from "@/components/ui/toast";

const TERMS = ["Term 1", "Term 2", "Term 3"] as const;

interface ClassRow {
  class_name: string;
  student_count: number;
  graded_count: number;
  published_count: number;
  completion_pct: number;
  status: string;
}

interface MissingSubject {
  subject_name: string;
  staff_name: string;
  staff_email?: string | null;
  staff_phone?: string | null;
  pending_count: number;
  pending_students: Array<{ student_id: string; full_name: string }>;
}

interface MissingData {
  class_name: string;
  term: string;
  subjects: MissingSubject[];
  total_pending: number;
  graded_students: Array<{ student_id: string; full_name: string }>;
}

interface CommandCenterClientProps {
  tenantId: string;
  schoolName: string;
  initialTerm?: string;
}

function buildNudgeLink(staffName: string, className: string, term: string, subject: string, pending: number): string {
  const message =
    `Hello ${staffName}, this is a reminder from ResultApp: grades for ${subject} (${className}, ${term}) ` +
    `are still pending for ${pending} student(s). Please enter them so results can be published on time. Thank you!`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export default function CommandCenterClient({ tenantId, schoolName, initialTerm = "Term 1" }: CommandCenterClientProps) {
  const [term, setTerm] = useState(initialTerm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalStudents, setTotalStudents] = useState(0);
  const [publishedCount, setPublishedCount] = useState(0);
  const [completionPct, setCompletionPct] = useState(0);
  const [session, setSession] = useState("");
  const [balance, setBalance] = useState(0);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [missing, setMissing] = useState<Record<string, MissingData>>({});
  const [missingLoading, setMissingLoading] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const fetchSummary = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ tenant_id: tenantId, term: t });
      const res = await fetch(`/api/admin/results?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data as { success?: boolean }).success === false) {
        throw new Error((data as { error?: string }).error || `Failed to load (${res.status})`);
      }
      const d = data as {
        total_students?: number; published_count?: number; completion_pct?: number;
        academic_session?: string; credit_balance?: number; classes?: ClassRow[];
      };
      setTotalStudents(d.total_students ?? 0);
      setPublishedCount(d.published_count ?? 0);
      setCompletionPct(d.completion_pct ?? 0);
      setSession(d.academic_session ?? "");
      setBalance(d.credit_balance ?? 0);
      setClasses(Array.isArray(d.classes) ? d.classes : []);
      setSelected({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load command center");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchSummary(term);
  }, [term, fetchSummary]);

  const toggleSelect = (className: string) => {
    setSelected((prev) => ({ ...prev, [className]: !prev[className] }));
  };

  const toggleExpand = async (className: string) => {
    if (expanded === className) {
      setExpanded(null);
      return;
    }
    setExpanded(className);
    if (missing[className]) return;
    setMissingLoading(className);
    try {
      const qs = new URLSearchParams({ tenant_id: tenantId, view: "missing", class_name: className, term });
      const res = await fetch(`/api/admin/results?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data as { success?: boolean }).success === false) {
        throw new Error((data as { error?: string }).error || "Failed to load missing grades");
      }
      setMissing((prev) => ({ ...prev, [className]: data as MissingData }));
    } catch (e) {
      toast.error("Could not load missing grades", { description: e instanceof Error ? e.message : "Try again" });
      setExpanded(null);
    } finally {
      setMissingLoading(null);
    }
  };

  async function publishClasses(classNames: string[]) {
    if (classNames.length === 0 || publishing) return;
    // Resolve graded student IDs (never publish students with no grades).
    setPublishing(true);
    try {
      const allIds: string[] = [];
      for (const cn of classNames) {
        let m = missing[cn];
        if (!m) {
          const qs = new URLSearchParams({ tenant_id: tenantId, view: "missing", class_name: cn, term });
          const res = await fetch(`/api/admin/results?${qs.toString()}`, { cache: "no-store" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || (data as { success?: boolean }).success === false) {
            throw new Error((data as { error?: string }).error || `Failed to resolve ${cn}`);
          }
          m = data as MissingData;
          setMissing((prev) => ({ ...prev, [cn]: m as MissingData }));
        }
        for (const s of m.graded_students) allIds.push(s.student_id);
      }
      const uniqueIds = [...new Set(allIds)];
      if (uniqueIds.length === 0) {
        toast.error("Nothing to publish", { description: "Selected classes have no graded students yet." });
        return;
      }
      if (uniqueIds.length > balance) {
        toast.error("Insufficient credits", {
          description: `Need ${uniqueIds.length} credits but balance is ${balance}. Top up first.`,
        });
        return;
      }
      const ok = window.confirm(
        `Publish ${uniqueIds.length} report card(s) for ${term}${session ? ` (${session})` : ""}? ` +
        `This deducts ${uniqueIds.length} credit(s). Re-prints are free.`,
      );
      if (!ok) return;
      const res = await fetch("/api/admin/results/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, term, academic_session: session || undefined, student_ids: uniqueIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data as { success?: boolean }).success === false) {
        throw new Error((data as { error?: string }).error || `Publish failed (${res.status})`);
      }
      const d = data as { published_now?: number; new_balance?: number; already_published?: string[] };
      toast.success(`Published ${d.published_now ?? uniqueIds.length} report card(s)`, {
        description: d.already_published?.length ? `${d.already_published.length} were already published (free).` : `New balance: ${d.new_balance ?? balance} credits.`,
      });
      setSelected({});
      setMissing({});
      await fetchSummary(term);
    } catch (e) {
      toast.error("Publication failed", { description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setPublishing(false);
    }
  }

  const selectedNames = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const readyClasses = useMemo(() => classes.filter((c) => c.status === "Ready to Publish"), [classes]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/${tenantId}/admin`}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-purple-300/60 transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Result Command Center</h1>
          <p className="mt-1 text-sm text-purple-200/60">
            Track completion, nudge staff, and publish report cards for {schoolName}
            {session ? ` • ${session}` : ""}.
          </p>
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-purple-200/70">
          Term
          <select
            id="cc-term"
            name="term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="rounded-xl border border-purple-500/20 bg-[#0B0514] px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          >
            {TERMS.map((t) => (
              <option key={t} value={t} className="bg-[#0B0514]">{t}</option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-purple-500/20 bg-purple-900/[0.04] px-4 py-6 text-sm text-purple-200/70">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading command center…
        </div>
      )}
      {!loading && error && (
        <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <span>{error}</span>
            <button type="button" onClick={() => void fetchSummary(term)} className="ml-2 font-medium underline underline-offset-4">
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Zone A — stats */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/15 bg-purple-600/10">
                  <Users className="h-5 w-5 text-purple-300" />
                </span>
                <p className="text-xs text-purple-200/60">Total Students</p>
              </div>
              <p className="mt-3 text-2xl font-bold text-white">{totalStudents.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-purple-200/60">Published Results</p>
                <span className="text-sm font-semibold text-purple-300">{completionPct}%</span>
              </div>
              <p className="mt-3 text-2xl font-bold text-white">
                {publishedCount.toLocaleString()} <span className="text-sm font-normal text-purple-300/50">/ {totalStudents.toLocaleString()}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.min(100, completionPct)}%` }} />
              </div>
            </div>
            <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/15 bg-purple-600/10">
                  <Coins className="h-5 w-5 text-purple-300" />
                </span>
                <p className="text-xs text-purple-200/60">Available Credits</p>
              </div>
              <p className="mt-3 text-2xl font-bold text-white">{balance.toLocaleString()}</p>
              <Link href={`/${tenantId}/admin/billing`} className="mt-2 inline-block text-xs font-medium text-purple-300 underline decoration-purple-500/30 underline-offset-4 hover:text-white">
                Top up credits →
              </Link>
            </div>
          </div>

          {/* Publish bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-4">
            <p className="text-sm text-purple-200/70">
              {selectedNames.length > 0
                ? `${selectedNames.length} class(es) selected — 1 credit per newly published card, re-prints free.`
                : `${readyClasses.length} class(es) ready to publish. Select classes below or publish all at once.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={publishing || readyClasses.length === 0}
                onClick={() => void publishClasses(readyClasses.map((c) => c.class_name))}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-purple-600 px-5 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish all ready
              </button>
              <button
                type="button"
                disabled={publishing || selectedNames.length === 0}
                onClick={() => void publishClasses(selectedNames)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-purple-500/20 bg-purple-600/10 px-5 text-sm font-medium text-purple-200 transition hover:bg-purple-600/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Publish selected ({selectedNames.length})
              </button>
            </div>
          </div>

          {/* Zone B — class roster */}
          <div className="overflow-hidden rounded-xl border border-purple-500/15 bg-purple-900/[0.04]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-purple-500/10 text-xs uppercase tracking-wide text-purple-300/60">
                    <th className="px-4 py-3 font-medium"><span className="sr-only">Select</span></th>
                    <th className="px-4 py-3 font-medium">Class</th>
                    <th className="px-4 py-3 font-medium">Students</th>
                    <th className="px-4 py-3 font-medium">Graded</th>
                    <th className="px-4 py-3 font-medium">Published</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/10">
                  {classes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-purple-200/50">
                        No classes found. Ask an admin to add students first.
                      </td>
                    </tr>
                  )}
                  {classes.map((c) => {
                    const isReady = c.status === "Ready to Publish";
                    const isOpen = expanded === c.class_name;
                    const m = missing[c.class_name];
                    return (
                      <Fragment key={c.class_name}>
                        <tr className="hover:bg-purple-900/10">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={!!selected[c.class_name]}
                              onChange={() => toggleSelect(c.class_name)}
                              aria-label={`Select ${c.class_name} for publication`}
                              className="h-5 w-5 rounded accent-purple-600"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-white">{c.class_name}</td>
                          <td className="px-4 py-3 text-purple-200/80">{c.student_count}</td>
                          <td className="px-4 py-3 text-purple-200/80">{c.graded_count}</td>
                          <td className="px-4 py-3 text-purple-200/80">{c.published_count}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                              isReady
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                : "border-amber-500/20 bg-amber-500/10 text-amber-300"
                            }`}>
                              {isReady ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                              {c.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => void toggleExpand(c.class_name)}
                              aria-expanded={isOpen}
                              className="inline-flex min-h-[44px] items-center rounded-full border border-purple-500/15 bg-white/[0.02] px-4 text-xs font-medium text-purple-200 transition hover:bg-purple-900/20 hover:text-white"
                            >
                              {isOpen ? "Hide details" : missingLoading === c.class_name ? "Loading…" : "View missing"}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="bg-[#0B0514]/60 px-4 py-4">
                              {!m ? (
                                <p className="flex items-center gap-2 text-sm text-purple-200/60">
                                  <Loader2 className="h-4 w-4 animate-spin" /> Loading missing grades…
                                </p>
                              ) : m.subjects.length === 0 ? (
                                <p className="text-sm text-emerald-300">All subjects have grades — ready to publish {m.graded_students.length} student(s).</p>
                              ) : (
                                <div className="space-y-2">
                                  {m.subjects.map((s) => (
                                    <div key={s.subject_name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-purple-500/10 bg-purple-900/[0.03] px-3 py-2">
                                      <div className="text-sm">
                                        <span className="font-medium text-white">{s.subject_name}</span>
                                        <span className="text-purple-300/60"> • {s.staff_name} • {s.pending_count} pending</span>
                                      </div>
                                      <a
                                        href={buildNudgeLink(s.staff_name, c.class_name, term, s.subject_name, s.pending_count)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 hover:text-emerald-200"
                                      >
                                        <Megaphone className="h-3.5 w-3.5" /> Nudge {s.staff_name.split(" ")[0] || "staff"}
                                      </a>
                                    </div>
                                  ))}
                                  <p className="text-xs text-purple-300/50">
                                    {m.graded_students.length} student(s) fully graded and publishable • {m.total_pending} subject-grade(s) still pending.
                                  </p>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs leading-5 text-purple-300/40">
            Publication deducts 1 credit per newly published report card. Drafts, previews, and re-prints are free.
            Nudges open WhatsApp with a pre-filled message — no messages are sent automatically.
          </p>
        </>
      )}
    </div>
  );
}
