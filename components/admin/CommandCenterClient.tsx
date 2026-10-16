"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Coins,
  Loader2,
  Send,
  Users,
} from "lucide-react";
import { Select, type SelectOption } from "@/components/ui/Select";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

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
  pending_preview_capped?: boolean;
}

interface CommandCenterClientProps {
  tenantId: string;
  schoolName: string;
  initialTerm?: string;
  /**
   * Which portal this is rendering inside.
   *
   * Present because this component renders two navigation links, and one of them
   * ("Top up credits") points at BILLING — a capability a moderator does not
   * hold. Hardcoding `/${tenantId}/admin/...` here meant the moderator console's
   * Result Command Center offered a link to a page that would 403 them. Hiding
   * nav is UX; this one is simply a broken affordance, so it is now decided from
   * the portal rather than left to 403 at click time.
   */
  portal?: "admin" | "moderator";
}

export default function CommandCenterClient({
  tenantId,
  schoolName,
  initialTerm = "Term 1",
  portal = "admin",
}: CommandCenterClientProps) {
  const base = `/${tenantId}/${portal}`;
  const canSeeBilling = portal === "admin";
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
  const [nudging, setNudging] = useState<string | null>(null);
  const [pendingPublish, setPendingPublish] = useState<{ ids: string[]; message: string } | null>(null);

  /** In-app nudge: dispatches STAFF_GRADING_REMINDER with a grading-hub deep link. */
  async function nudgeStaff(className: string, s: MissingSubject) {
    const key = `${className}::${s.subject_name}`;
    if (nudging) return;
    setNudging(key);
    try {
      const res = await fetch("/api/admin/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          staff_name: s.staff_name,
          staff_email: s.staff_email ?? null,
          subject_name: s.subject_name,
          class_name: className,
          term,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || `Nudge failed (${res.status})`);
      }
      if ((data as { duplicate?: boolean }).duplicate) {
        toast.success("Reminder already sent", {
          description: `${s.staff_name} was already nudged about ${s.subject_name} in the last 24 hours.`,
        });
      } else {
        toast.success(`Nudged ${s.staff_name.split(" ")[0] || "staff"}`, {
          description: `In-app reminder sent for ${s.subject_name} (${s.pending_count} pending).`,
        });
      }
    } catch (e) {
      toast.error("Could not send nudge", { description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setNudging(null);
    }
  }

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
    // Unresolved classes are fetched in ONE batch request (H2), not serially.
    setPublishing(true);
    try {
      const unresolved = classNames.filter((cn) => !missing[cn]);
      let batch: Record<string, MissingData> = {};
      if (unresolved.length > 0) {
        const qs = new URLSearchParams({
          tenant_id: tenantId,
          view: "missing-batch",
          class_names: unresolved.join(","),
          term,
        });
        const res = await fetch(`/api/admin/results?${qs.toString()}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || (data as { success?: boolean }).success === false) {
          throw new Error((data as { error?: string }).error || `Failed to resolve ${unresolved.join(", ")}`);
        }
        batch = (data as { classes?: Record<string, MissingData> }).classes || {};
        for (const cn of unresolved) {
          if (!batch[cn]) throw new Error(`Failed to resolve ${cn}`);
        }
        setMissing((prev) => ({ ...prev, ...batch }));
      }
      const allIds: string[] = [];
      for (const cn of classNames) {
        // Batch-resolved classes are read from the response directly —
        // setMissing above hasn't re-rendered yet (no stale-state skip).
        const resolved = missing[cn] ?? batch[cn];
        if (!resolved) continue;
        for (const s of resolved.graded_students) allIds.push(s.student_id);
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
      setPendingPublish({
        ids: uniqueIds,
        message:
          `Publish ${uniqueIds.length} report card(s) for ${term}${session ? ` (${session})` : ""}? ` +
          `This deducts ${uniqueIds.length} credit(s). Re-prints are free.`,
      });
      return;
    } catch (e) {
      toast.error("Publication failed", { description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setPublishing(false);
    }
  }

  async function runPublish() {
    if (!pendingPublish || publishing) return;
    const { ids: uniqueIds } = pendingPublish;
    setPendingPublish(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/admin/results/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, term, academic_session: session || undefined, student_ids: uniqueIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data as { success?: boolean }).success === false) {
        throw new Error((data as { error?: string }).error || `Publish failed (${res.status})`);
      }
      const d = data as { published_now?: number; new_balance?: number; already_published?: string[]; principal_remarks_applied?: number };
      const remarksNote = (d.principal_remarks_applied ?? 0) > 0 ? ` • ${d.principal_remarks_applied} principal remark(s) applied` : "";
      toast.success(`Published ${d.published_now ?? uniqueIds.length} report card(s)${remarksNote}`, {
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
            href={`${base}`}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-text-2 transition hover:text-text-1"
          >
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-text-1">Result Command Center</h1>
          <p className="mt-1 text-sm text-text-2">
            Track completion, nudge staff, and publish report cards for {schoolName}
            {session ? ` • ${session}` : ""}.
          </p>
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-2">
          Term
<Select
              id="cc-term"
              aria-label="Term"
              value={term}
              onChange={setTerm}
              options={TERMS.map((t): SelectOption => ({ value: t, label: t }))}
            />
        </label>
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-line-1 bg-surface-1 px-4 py-6 text-sm text-text-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading command center…
        </div>
      )}
      {!loading && error && (
        <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
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
            <div className="rounded-xl border border-line-1 bg-surface-1 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-1 bg-accent-soft">
                  <Users className="h-5 w-5 text-accent" />
                </span>
                <p className="text-xs text-text-2">Total Students</p>
              </div>
              <p className="mt-3 text-2xl font-bold text-text-1">{totalStudents.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-line-1 bg-surface-1 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-2">Published Results</p>
                <span className="text-sm font-semibold text-accent">{completionPct}%</span>
              </div>
              <p className="mt-3 text-2xl font-bold text-text-1">
                {publishedCount.toLocaleString()} <span className="text-sm font-normal text-text-3">/ {totalStudents.toLocaleString()}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.min(100, completionPct)}%` }} />
              </div>
            </div>
            <div className="rounded-xl border border-line-1 bg-surface-1 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-1 bg-accent-soft">
                  <Coins className="h-5 w-5 text-accent" />
                </span>
                <p className="text-xs text-text-2">Available Credits</p>
              </div>
              <p className="mt-3 text-2xl font-bold text-text-1">{balance.toLocaleString()}</p>
{/* A moderator still needs to SEE the balance — publishing costs
                  credits, so hiding the number would leave them publishing blind
                  and blaming the platform. What they cannot do is BUY more, so
                  the link becomes a read-only note rather than a 403. */}
              {canSeeBilling ? (
                <Link
                  href={`${base}/billing`}
                  className="mt-2 inline-block text-xs font-medium text-accent underline decoration-accent/30 underline-offset-4 hover:text-text-1"
                >
                  Top up credits &rarr;
                </Link>
              ) : (
                <p className="mt-2 text-xs text-text-3">
                  Ask the school&apos;s administrator to top up.
                </p>
              )}
            </div>
          </div>

          {/* Publish bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-1 bg-surface-1 p-4">
            <p className="text-sm text-text-2">
              {selectedNames.length > 0
                ? `${selectedNames.length} class(es) selected — 1 credit per newly published card, re-prints free.`
                : `${readyClasses.length} class(es) ready to publish. Select classes below or publish all at once.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={publishing || readyClasses.length === 0}
                onClick={() => void publishClasses(readyClasses.map((c) => c.class_name))}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish all ready
              </button>
              <button
                type="button"
                disabled={publishing || selectedNames.length === 0}
                onClick={() => void publishClasses(selectedNames)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line-1 bg-accent-soft px-5 text-sm font-medium text-accent transition hover:bg-surface-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Publish selected ({selectedNames.length})
              </button>
            </div>
          </div>

          {/* Zone B — class roster */}
          <div className="overflow-hidden rounded-xl border border-line-1 bg-surface-1">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line-1 text-xs uppercase tracking-wide text-text-2">
                    <th className="px-4 py-3 font-medium"><span className="sr-only">Select</span></th>
                    <th className="px-4 py-3 font-medium">Class</th>
                    <th className="px-4 py-3 font-medium">Students</th>
                    <th className="px-4 py-3 font-medium">Graded</th>
                    <th className="px-4 py-3 font-medium">Published</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-1">
                  {classes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-text-3">
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
                        <tr className="hover:bg-surface-2">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={!!selected[c.class_name]}
                              onChange={() => toggleSelect(c.class_name)}
                              aria-label={`Select ${c.class_name} for publication`}
                              className="h-5 w-5 rounded accent-accent"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-text-1">{c.class_name}</td>
                          <td className="px-4 py-3 text-text-2">{c.student_count}</td>
                          <td className="px-4 py-3 text-text-2">{c.graded_count}</td>
                          <td className="px-4 py-3 text-text-2">{c.published_count}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                              isReady
                                ? "border-success/40 bg-success-soft text-success"
                                : "border-amber-500/20 bg-warning-soft text-warning"
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
                              className="inline-flex min-h-[44px] items-center rounded-full border border-line-1 bg-surface-1 px-4 text-xs font-medium text-text-2 transition hover:bg-surface-2 hover:text-text-1"
                            >
                              {isOpen ? "Hide details" : missingLoading === c.class_name ? "Loading…" : "View missing"}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="bg-surface-0/60 px-4 py-4">
                              {!m ? (
                                <p className="flex items-center gap-2 text-sm text-text-2">
                                  <Loader2 className="h-4 w-4 animate-spin" /> Loading missing grades…
                                </p>
                              ) : m.subjects.length === 0 ? (
                                <p className="text-sm text-success">All subjects have grades — ready to publish {m.graded_students.length} student(s).</p>
                              ) : (
                                <div className="space-y-2">
                                  {m.subjects.map((s) => (
                                    <div key={s.subject_name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-1 bg-surface-2 px-3 py-2">
                                      <div className="text-sm">
                                        <span className="font-medium text-text-1">{s.subject_name}</span>
                                        <span className="text-text-2"> • {s.staff_name} • {s.pending_count} pending</span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void nudgeStaff(c.class_name, s)}
                                        disabled={nudging === `${c.class_name}::${s.subject_name}`}
                                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-success/40 bg-success-soft px-4 text-xs font-medium text-success transition hover:bg-surface-2 hover:text-success disabled:opacity-50"
                                      >
                                        <Bell className="h-3.5 w-3.5" />
                                        {nudging === `${c.class_name}::${s.subject_name}`
                                          ? "Sending…"
                                          : `Nudge ${s.staff_name.split(" ")[0] || "staff"}`}
                                      </button>
                                    </div>
                                  ))}
                                  <p className="text-xs text-text-3">
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

          <p className="text-xs leading-5 text-text-3">
            Publication deducts 1 credit per newly published report card. Drafts, previews, and re-prints are free.
            Nudges land in the staffer&apos;s in-app inbox and deep-link straight into grading.
          </p>
        </>
      )}

      <ConfirmDialog
        open={pendingPublish !== null}
        onOpenChange={(o) => { if (!o) setPendingPublish(null); }}
        title="Publish report cards?"
        message={pendingPublish?.message}
        variant="default"
        confirmLabel="Publish"
        loading={publishing}
        onConfirm={() => void runPublish()}
      />
    </div>
  );
}
