"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Wallet,
  ShieldAlert,
  RotateCcw,
  Users,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select, type SelectOption } from "@/components/ui/Select";

/**
 * Financial Clearance — the bursary dashboard (revenue recovery).
 *
 * A bursar marks students "Owing" for a given term; the public Result Checker
 * then withholds that student's grades until they are cleared. This is a soft
 * block: the school still publishes and manages results normally.
 *
 * Two behaviours here are load-bearing and easy to break:
 *
 *  1. TOGGLES ARE STAGED, NOT IMMEDIATE. Clicking a switch does not write.
 *     Changes accumulate in `pending` and only reach the server when Apply is
 *     pressed, because a bursar working down a column of 40 students would
 *     otherwise fire 40 round-trips and — worse — a mid-list network failure
 *     would leave the holds half-applied with no record of what was intended.
 *
 *  2. "UNCHECK DEFAULTERS" DESELECTS, IT DOES NOT CLEAR. The point of this
 *     screen is to review the owing list, so the intended workflow is:
 *     Select All -> Uncheck defaulters -> Apply. That leaves precisely the
 *     defaulters selected, ready to be marked Cleared. Implementations that
 *     read this button as "clear everyone currently owing" invert the
 *     admin's intent and release debt in one click.
 */

const TERMS: SelectOption[] = [
  { value: "Term 1", label: "Term 1" },
  { value: "Term 2", label: "Term 2" },
  { value: "Term 3", label: "Term 3" },
];

export interface ClearanceRow {
  student_id: string;
  full_name: string;
  class_name: string;
  gender: string | null;
  is_financially_cleared: boolean;
  hold_reason: string | null;
  held_by: string | null;
  held_at: string | null;
  cleared_at: string | null;
  has_override: boolean;
}

interface ClearanceResponse {
  success: boolean;
  subdomain: string;
  term: string;
  academic_session: string;
  total: number;
  owing: number;
  cleared: number;
  students: ClearanceRow[];
}

/** Reasons offered by default; the field also accepts free text. */
const HOLD_REASONS: SelectOption[] = [
  { value: "School fees unpaid", label: "School fees unpaid" },
  { value: "Outstanding school fees (Term)", label: "Outstanding school fees (Term)" },
  { value: "Part payment — balance outstanding", label: "Part payment — balance outstanding" },
  { value: "Other outstanding fees", label: "Other outstanding fees" },
];

export default function ClearanceManager({
  tenantId,
  schoolName,
}: {
  tenantId: string;
  schoolName: string;
}) {
  const [term, setTerm] = useState("Term 1");
  const [classFilter, setClassFilter] = useState("All");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<ClearanceRow[]>([]);
  const [academicSession, setAcademicSession] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Student id -> desired value. Empty means "no change staged". */
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const [reasonModal, setReasonModal] = useState<{ ids: string[]; cleared: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({ tenantId, term });
      if (classFilter !== "All") qs.set("className", classFilter);
      if (search.trim()) qs.set("search", search.trim());

      const res = await fetch(`/api/admin/clearance?${qs.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as Partial<ClearanceResponse> & {
        error?: string;
      };

      if (!res.ok) {
        setLoadError(data.error || `Could not load clearance (${res.status})`);
        setRows([]);
        return;
      }

      setRows(data.students ?? []);
      setAcademicSession(data.academic_session ?? "");
      // Any staged-but-unapplied change belongs to the previous term/filter.
      // Carrying it across would apply a Term 1 decision to a Term 2 roster.
      setPending({});
      setSelected(new Set());
    } catch {
      setLoadError("Network error — could not reach the clearance service");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, term, classFilter, search]);

  useEffect(() => {
    // Debounce so typing in the search box does not fire a request per keystroke.
    const t = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const classes = useMemo(() => {
    const set = new Set(rows.map((r) => r.class_name).filter(Boolean));
    return ["All", ...Array.from(set).sort()];
  }, [rows]);

  /** Effective status = staged override if present, else server value. */
  const effective = useCallback(
    (r: ClearanceRow): boolean =>
      pending[r.student_id] !== undefined ? pending[r.student_id] : r.is_financially_cleared,
    [pending],
  );

  const stagedCount = Object.keys(pending).length;
  const owingCount = rows.filter((r) => !effective(r)).length;

  const toggle = (id: string, next: boolean) =>
    setPending((p) => ({ ...p, [id]: next }));

  const selectAll = () => setSelected(new Set(rows.map((r) => r.student_id)));
  const clearSelection = () => setSelected(new Set());

  /**
   * Deselect every currently-owing student, leaving the cleared ones selected.
   * Read the comment at the top of the file: this is a SELECTION change only.
   */
  const uncheckDefaulters = () =>
    setSelected(new Set(rows.filter((r) => effective(r)).map((r) => r.student_id)));

  const selectDefaulters = () =>
    setSelected(new Set(rows.filter((r) => !effective(r)).map((r) => r.student_id)));

  const requestChange = (ids: string[], cleared: boolean) => {
    if (ids.length === 0) return;
    // Clearing a hold needs no reason; applying a hold does.
    if (!cleared) {
      setPending((p) => {
        const next = { ...p };
        for (const id of ids) next[id] = false;
        return next;
      });
      setReason("");
      setReasonModal({ ids, cleared });
      return;
    }
    setPending((p) => {
      const next = { ...p };
      for (const id of ids) next[id] = true;
      return next;
    });
  };

  const applyPending = async () => {
    const ids = Object.keys(pending);
    if (ids.length === 0) return;

    // Group by target value so each direction is one request rather than one
    // per student.
    const toClear = ids.filter((id) => pending[id] === true);
    const toHold = ids.filter((id) => pending[id] === false);

    setSubmitting(true);
    try {
      for (const [batch, cleared] of [
        [toClear, true],
        [toHold, false],
      ] as const) {
        if (batch.length === 0) continue;
        const res = await fetch("/api/admin/clearance", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId,
            term,
            student_ids: batch,
            is_financially_cleared: cleared,
            hold_reason: cleared ? undefined : reason.trim() || "School fees unpaid",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; updated?: number };
        if (!res.ok) {
          toast.error("Clearance update failed", {
            description: data.error || `Request failed (${res.status})`,
          });
          // Reload so the UI reflects what is actually persisted, not intent.
          await load();
          return;
        }
      }

      toast.success(
        `Updated ${ids.length} student${ids.length === 1 ? "" : "s"}`,
        {
          description: `${schoolName} · ${term}${academicSession ? ` · ${academicSession}` : ""}`,
        },
      );
      await load();
    } catch {
      toast.error("Network error while saving clearance");
    } finally {
      setSubmitting(false);
      setReasonModal(null);
    }
  };

  /** Clear the selected students. Separate from applyPending because a
   *  clear needs no reason dialog — it writes straight through. */
  const clearSelected = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/clearance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          term,
          student_ids: ids,
          is_financially_cleared: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error("Could not clear students", {
          description: data.error || `Request failed (${res.status})`,
        });
      } else {
        toast.success(`Cleared ${ids.length} student${ids.length === 1 ? "" : "s"}`, {
          description: `${schoolName} · ${term}`,
        });
      }
      await load();
    } catch {
      toast.error("Network error while clearing students");
    } finally {
      setSubmitting(false);
    }
  }, [selected, tenantId, term, schoolName, load]);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
          <Wallet className="h-6 w-6 text-purple-400" aria-hidden="true" />
          Financial Clearance
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-purple-200/60">
          Place students on an Administrative Hold when school fees are unpaid. Their
          result stays published but is withheld from the public Result Checker until you
          clear them. Holds are per-term — clearing Term 1 does not clear Term 2.
        </p>
      </header>

      {/* Summary */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-purple-500/15 bg-purple-900/10 p-4">
          <p className="text-xs uppercase tracking-wide text-purple-300/50">Students</p>
          <p className="mt-1 text-2xl font-semibold text-white">{loading ? "—" : rows.length}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <p className="text-xs uppercase tracking-wide text-emerald-300/70">Cleared</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-200">
            {loading ? "—" : rows.length - owingCount}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
          <p className="text-xs uppercase tracking-wide text-amber-300/70">On Hold</p>
          <p className="mt-1 text-2xl font-semibold text-amber-200">{loading ? "—" : owingCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          aria-label="Term"
          label="Term"
          value={term}
          onChange={setTerm}
          className="sm:w-40"
          options={TERMS}
        />
        <Select
          aria-label="Filter by class"
          label="Class"
          value={classFilter}
          onChange={setClassFilter}
          className="sm:w-48"
          options={classes.map((c): SelectOption => ({ value: c, label: c === "All" ? "All Classes" : c }))}
        />
        <div className="relative flex-1">
          <label htmlFor="clearance-search" className="mb-1.5 block text-sm font-medium text-purple-100">
            Search
          </label>
          <Search
            className="pointer-events-none absolute bottom-3.5 left-3 h-4 w-4 text-purple-300/40"
            aria-hidden="true"
          />
          <input
            id="clearance-search"
            type="search"
            placeholder="Name or admission number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 pl-10 pr-3 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          />
        </div>
      </div>

      {academicSession && (
        <p className="mb-4 text-xs text-purple-300/50">
          Academic session: <span className="font-mono text-purple-200">{academicSession}</span>
        </p>
      )}

      {/* Bulk bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-purple-500/15 bg-purple-900/10 p-3">
        <Button size="sm" variant="secondary" onClick={allSelected ? clearSelection : selectAll}>
          {allSelected ? "Clear selection" : "Select All"}
        </Button>
        <Button size="sm" variant="secondary" onClick={uncheckDefaulters}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Uncheck defaulters
        </Button>
        <Button size="sm" variant="secondary" onClick={selectDefaulters}>
          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Select defaulters only
        </Button>

        <span className="ml-auto text-xs text-purple-300/60">
          {selected.size} selected
          {stagedCount > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-amber-300">{stagedCount} unsaved</span>
            </>
          )}
        </span>

        <Button
          size="sm"
          onClick={() => setConfirmBulk(true)}
          disabled={selected.size === 0}
          title={
            selected.size === 0
              ? "Select students first"
              : `Mark ${selected.size} student${selected.size === 1 ? "" : "s"} as Cleared`
          }
        >
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Mark selected as Cleared
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => requestChange(Array.from(selected), false)}
          disabled={selected.size === 0}
        >
          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Put on Hold
        </Button>
      </div>

      {stagedCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
          <p className="text-xs text-amber-100">
            {stagedCount} change{stagedCount === 1 ? "" : "s"} staged but not saved.
          </p>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPending({});
                setReasonModal(null);
              }}
            >
              Discard
            </Button>
            <Button size="sm" onClick={() => void applyPending()} disabled={submitting}>
              {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Apply changes
            </Button>
          </div>
        </div>
      )}

      {/* Roster */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/10 p-10 text-sm text-purple-300/70">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading roster…
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-6 text-sm text-red-200">
          {loadError}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-purple-500/15 bg-purple-900/10 p-8 text-sm text-purple-300/70">
          <Users className="h-5 w-5 shrink-0" aria-hidden="true" />
          No students match this filter. Register students on the Allocations page first.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-purple-500/15">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-purple-500/15 bg-purple-900/20 text-xs uppercase tracking-wide text-purple-300/60">
              <tr>
                <th scope="col" className="w-10 px-4 py-3">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col" className="px-4 py-3">Student</th>
                <th scope="col" className="px-4 py-3">Class</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Reason</th>
                <th scope="col" className="px-4 py-3 text-right">Toggle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-purple-500/10">
              {rows.map((r) => {
                const cleared = effective(r);
                const dirty = pending[r.student_id] !== undefined;
                const isSel = selected.has(r.student_id);
                return (
                  <tr
                    key={r.student_id}
                    className={isSel ? "bg-purple-500/5" : undefined}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.student_id);
                            else next.delete(r.student_id);
                            return next;
                          })
                        }
                        aria-label={`Select ${r.full_name}`}
                        className="h-4 w-4 rounded border-purple-700 bg-purple-950/40 accent-purple-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-purple-50">{r.full_name}</p>
                      <p className="font-mono text-xs text-purple-300/50">{r.student_id}</p>
                    </td>
                    <td className="px-4 py-3 text-purple-200/70">{r.class_name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          cleared
                            ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200"
                            : "inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200"
                        }
                      >
                        {cleared ? "Cleared" : "Owing"}
                      </span>
                      {dirty && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-300/70">
                          unsaved
                        </span>
                      )}
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-xs text-purple-300/60">
                      {!cleared ? r.hold_reason ?? "—" : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={cleared}
                        aria-label={`${cleared ? "Clear" : "Hold"} ${r.full_name}`}
                        onClick={() => toggle(r.student_id, !cleared)}
                        className={
                          cleared
                            ? "relative inline-flex h-6 w-11 items-center rounded-full bg-emerald-500/80 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                            : "relative inline-flex h-6 w-11 items-center rounded-full bg-amber-500/80 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                        }
                      >
                        <span
                          className={
                            cleared
                              ? "ml-auto mr-0.5 block h-5 w-5 rounded-full bg-white transition"
                              : "ml-0.5 block h-5 w-5 rounded-full bg-white transition"
                          }
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Hold reason — required for every hold */}
      <Modal
        open={!!reasonModal}
        onOpenChange={(o) => !o && setReasonModal(null)}
        title="Reason for hold"
        description={
          reasonModal
            ? `${reasonModal.ids.length} student${reasonModal.ids.length === 1 ? "" : "s"} will be placed on an Administrative Hold for ${term}. This reason is shown to the bursary, not to the family.`
            : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            aria-label="Hold reason"
            label="Reason"
            value={HOLD_REASONS.some((r) => r.value === reason) ? reason : ""}
            onChange={setReason}
            placeholder="Choose a reason"
            options={HOLD_REASONS}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="hold-reason-custom" className="text-sm font-medium text-purple-100">
              Note (optional)
            </label>
            <textarea
              id="hold-reason-custom"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. N50,000 balance outstanding since Term 1"
              className="rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReasonModal(null)}>
              Cancel
            </Button>
            <Button onClick={() => void applyPending()} disabled={submitting}>
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Save hold
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Clear ${selected.size} student${selected.size === 1 ? "" : "s"}?`}
        message="They will be able to view their published result on the public Result Checker again."
        note="Clearing a hold never costs credits and does not alter the published result."
        confirmLabel="Yes, clear them"
        variant="danger"
        loading={submitting}
        onConfirm={async () => {
          setConfirmBulk(false);
          await clearSelected();
        }}
      />
    </div>
  );
}