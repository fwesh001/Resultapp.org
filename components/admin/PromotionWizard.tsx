"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/Button";
import { Select, type SelectOption } from "@/components/ui/Select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  Loader2,
  RotateCcw,
  Sparkles,
  UserMinus,
  Users,
} from "lucide-react";

type Outcome = "promote" | "repeat" | "graduate" | "withdraw";

interface ClassSummary {
  class_name: string;
  count: number;
  graduates: number;
  next_class: string | null;
}

interface PreviewPayload {
  success: boolean;
  from_session: string;
  to_session: string;
  class_map: Record<string, string | null>;
  totals: Record<string, number>;
  by_class: ClassSummary[];
  active_students: number;
  slots_released_now: number;
  slots_released_deferred: number;
  error?: string;
}

interface RosterStudent {
  student_id: string;
  full_name: string;
  class_name: string;
}

/** "Graduate" is spelled out as an option, null means terminal in the map. */
const TERMINAL = "__terminal__";

const OUTCOME_META: Record<
  Outcome,
  { label: string; icon: typeof Users; tone: string; blurb: string }
> = {
  promote: {
    label: "Promote",
    icon: ArrowRight,
    tone: "text-success",
    blurb: "Moves to the next class and keeps their portal access.",
  },
  repeat: {
    label: "Repeat",
    icon: RotateCcw,
    tone: "text-warning",
    blurb: "Stays in the same class. Their earlier promotion date is kept.",
  },
  graduate: {
    label: "Graduate",
    icon: GraduationCap,
    tone: "text-accent",
    blurb: "Leaves the roster. Their slot is released immediately.",
  },
  withdraw: {
    label: "Withdraw",
    icon: UserMinus,
    tone: "text-danger",
    blurb:
      "Leaves the roster. The slot is released at the start of the next session, in case they return.",
  },
};

/**
 * End of Session — cohort promotion wizard.
 *
 * WHY THE CLASS MAP IS EDITABLE RATHER THAN JUST SHOWN
 * -----------------------------------------------------
 * The backend derives the progression heuristically (N < P < J < SS, then
 * numeric) from the classes actually in the roster. That is right for the
 * common Nigerian naming and wrong for anything bespoke — a school running
 * "Year 7"/"Year 8", or one that adds a "JSS 0", gets a map that does not
 * match what they teach. Silently trusting a heuristic to decide which
 * children graduate is not acceptable, so the derived map is presented for
 * review and every target is overridable, including setting a class terminal.
 *
 * Nothing is written until the final Apply. Preview, map edits and per-student
 * overrides all happen against local state; the draft is created on Review and
 * applied on Confirm.
 */
export default function PromotionWizard({ tenantId }: { tenantId: string }) {
  const [fromSession, setFromSession] = useState("");
  const [toSession, setToSession] = useState("");
  const [sessionTouched, setSessionTouched] = useState(false);

  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [classMap, setClassMap] = useState<Record<string, string | null>>({});

  /** Lowercased student_id -> forced outcome. Anything absent is derived. */
  const [overrides, setOverrides] = useState<Record<string, Outcome>>({});
  /** Per-class bulk override, applied on top of everything else. */
  const [classOverrides, setClassOverrides] = useState<Record<string, Outcome>>({});

  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  /** The drafted run being confirmed. A ref, not state — nothing renders from it. */
  const runIdRef = useRef<string | null>(null);

  // ---- session defaults ---------------------------------------------------
  useEffect(() => {
    if (sessionTouched || fromSession) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/tenant/${encodeURIComponent(tenantId)}?cacheBust=1`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          current_session?: string;
          currentSession?: string;
        };
        const current = String(
          data.current_session || data.currentSession || ""
        ).trim();
        if (cancelled || !current) return;
        setFromSession(current);
        // "Next session" derived from the label: 2026/2027 -> 2027/2028.
        const start = parseInt(current.split("/")[0], 10);
        setToSession(
          Number.isFinite(start) ? `${start + 1}/${start + 2}` : current
        );
      } catch {
        /* The admin can type both fields by hand; this is a convenience only. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, fromSession, sessionTouched]);

  // ---- preview ------------------------------------------------------------
  const loadPreview = useCallback(async () => {
    if (!fromSession || !toSession || fromSession === toSession) {
      setError("Choose two different sessions.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        tenant_id: tenantId,
        from_session: fromSession,
        to_session: toSession,
      });
      const res = await fetch(`/api/admin/end-of-session/preview?${qs}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as PreviewPayload;
      if (!res.ok || data.success === false) {
        setError(data.error || "Could not load the preview.");
        return;
      }
      setPreview(data);
      setClassMap(data.class_map || {});

      // The roster for inline overrides. The allocations roster endpoint is the
      // one that already returns every student with class_name.
      const rres = await fetch(
        `/api/admin/allocations?tenant_id=${encodeURIComponent(
          tenantId
        )}&entity_type=students&limit=1000&page=1`,
        { cache: "no-store" }
      );
      if (rres.ok) {
        const rdata = (await rres.json().catch(() => ({}))) as {
          data?: Array<Record<string, unknown>>;
        };
        const rows = (rdata.data || []).map((r) => ({
          student_id: String(r.student_id ?? ""),
          full_name: String(r.full_name ?? ""),
          class_name: String(r.class_name ?? ""),
        }));
        setRoster(rows.filter((r) => r.student_id));
      }
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, fromSession, toSession]);

  const classes = useMemo(
    () => Object.keys(classMap).sort(),
    [classMap]
  );

  /** Class options for a map target, including the terminal choice. */
  const targetOptions = useMemo((): SelectOption[] => {
    const opts: SelectOption[] = classes.map((c) => ({ value: c, label: c }));
    opts.push({
      value: TERMINAL,
      label: "None — students graduate",
    });
    return opts;
  }, [classes]);

  const mapEdited = useMemo(() => {
    if (!preview) return false;
    const derived = preview.class_map || {};
    return classes.some((c) => (classMap[c] ?? null) !== (derived[c] ?? null));
    // `preview` itself, not `preview?.class_map`: the array is compared against
    // a local so the memo depends on the map it reads rather than on a field
    // path, which keeps the dependency honest when preview flips to null.
  }, [classMap, preview, classes]);

  /** Resolve one student's outcome: class bulk -> individual -> derived map. */
  const outcomeFor = useCallback(
    (student: RosterStudent): Outcome => {
      const key = student.student_id.toLowerCase();
      if (overrides[key]) return overrides[key];
      if (classOverrides[student.class_name]) {
        return classOverrides[student.class_name];
      }
      const target = classMap[student.class_name];
      return target === null || target === undefined ? "graduate" : "promote";
    },
    [overrides, classOverrides, classMap]
  );

  const tally = useMemo(() => {
    const counts: Record<Outcome, number> = {
      promote: 0,
      repeat: 0,
      graduate: 0,
      withdraw: 0,
    };
    for (const s of roster) counts[outcomeFor(s)] += 1;
    return counts;
  }, [roster, outcomeFor]);

  const outcomeOptionsFor = useMemo((): SelectOption[] => {
    return (Object.keys(OUTCOME_META) as Outcome[]).map((k) => ({
      value: k,
      label: OUTCOME_META[k].label,
    }));
  }, []);

  function setClassOutcome(cls: string, outcome: string) {
    setClassOverrides((prev) => {
      const next = { ...prev };
      if (!outcome) delete next[cls];
      else next[cls] = outcome as Outcome;
      return next;
    });
  }

  // ---- draft + apply ------------------------------------------------------
  /**
   * Create the draft run, then show the confirmation.
   *
   * Only explicit overrides travel. Everything else the backend derives from
   * the class map, which keeps the payload small AND means the stored plan can
   * never disagree with the roster that was previewed.
   */
  async function createDraft() {
    setWorking(true);
    setError(null);
    try {
      const decisions = Object.entries(overrides).map(([sid, outcome]) => {
        const s = roster.find((r) => r.student_id.toLowerCase() === sid);
        return {
          outcome,
          student_id: s?.student_id || sid,
          from_class: s?.class_name,
          reason: null,
        };
      });

      const res = await fetch("/api/admin/end-of-session/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          from_session: fromSession,
          to_session: toSession,
          class_map: classMap,
          decisions,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        run_id?: string;
        error?: string;
      };
      if (!res.ok || !data.run_id) {
        setError(data.error || "Could not create the run.");
        return;
      }
      runIdRef.current = data.run_id;
      setConfirming(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  async function handleApply() {
    if (!runIdRef.current) {
      setConfirming(false);
      setError("That run expired. Review again to create a fresh one.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/end-of-session/run/${encodeURIComponent(
          runIdRef.current
        )}/apply?tenant_id=${encodeURIComponent(tenantId)}`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success === false) {
        setError(
          (data.error as string) ||
            "Could not apply. Nothing was changed — you can safely try again."
        );
        setConfirming(false);
        return;
      }
      setResult(data);
      setConfirming(false);
      toast.success(
        data.already_applied
          ? "That session close was already applied"
          : "Session closed",
        { description: `${fromSession} → ${toSession}` }
      );
    } catch {
      setError("Could not reach the server. Nothing was changed.");
      setConfirming(false);
    } finally {
      setWorking(false);
    }
  }

  // ---- render -------------------------------------------------------------
  if (result) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success-soft p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-1">
          <CheckCircle2 className="h-5 w-5 text-success" /> Session closed
        </h2>
        <p className="mt-1 text-sm text-text-2">
          {fromSession} → {toSession}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["promoted", result.promoted],
              ["repeated", result.repeated],
              ["graduated", result.graduated],
              ["withdrawn", result.withdrawn],
            ] as const
          ).map(([label, val]) => (
            <div
              key={label}
              className="rounded-xl border border-line-1 bg-surface-1 px-3 py-2"
            >
              <dt className="text-[0.7rem] uppercase tracking-wide text-text-2">
                {label}
              </dt>
              <dd className="text-lg font-semibold text-text-1">{String(val ?? 0)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-text-2">
          Slots released now: <strong>{String(result.slots_released_now ?? 0)}</strong>.
          Withdrawal refunds parked until{" "}
          <strong>{String(result.to_session ?? toSession)}</strong>.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={() => {
            setResult(null);
            setPreview(null);
            setOverrides({});
            setClassOverrides({});
            runIdRef.current = null;
          }}
        >
          Close another session
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1 — sessions */}
      <section className="rounded-2xl border border-line-1 bg-surface-1 p-5">
        <h2 className="text-sm font-semibold text-text-1">1. Sessions</h2>
        <p className="mt-1 text-xs text-text-2">
          The session being closed, and the one students move into.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-xs text-text-2">
            From session
            <input
              value={fromSession}
              onChange={(e) => {
                setSessionTouched(true);
                setFromSession(e.target.value);
              }}
              placeholder="2026/2027"
              className="mt-1 w-full rounded-xl border border-line-1 bg-surface-0 px-3 py-2 text-sm text-text-1"
            />
          </label>
          <label className="block text-xs text-text-2">
            To session
            <input
              value={toSession}
              onChange={(e) => {
                setSessionTouched(true);
                setToSession(e.target.value);
              }}
              placeholder="2027/2028"
              className="mt-1 w-full rounded-xl border border-line-1 bg-surface-0 px-3 py-2 text-sm text-text-1"
            />
          </label>
        </div>
        <Button
          type="button"
          onClick={() => void loadPreview()}
          disabled={loading}
          className="mt-4"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {preview ? "Refresh preview" : "Preview the cohort"}
        </Button>
      </section>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {preview && (
        <>
          {/* 2 — class map */}
          <section className="rounded-2xl border border-line-1 bg-surface-1 p-5">
            <h2 className="text-sm font-semibold text-text-1">
              2. Review the class progression
            </h2>
            <p className="mt-1 text-xs text-text-2">
              Worked out from the classes on your roster, in the order
              Nursery → Primary → JSS → SS. <strong>Check it.</strong> A class set
              to <em>None</em> graduates its students. Change anything that does
              not match what you teach.
            </p>
            {mapEdited && (
              <p className="mt-2 text-xs font-medium text-warning">
                You have edited this map. It overrides the automatic progression.
              </p>
            )}
            <div className="mt-4 space-y-2">
              {classes.map((cls) => {
                const summary = preview.by_class.find((c) => c.class_name === cls);
                const isTerminal = (classMap[cls] ?? null) === null;
                return (
                  <div
                    key={cls}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-line-1 bg-surface-0 px-3 py-2"
                  >
                    <span className="min-w-[7rem] font-medium text-text-1">
                      {cls}
                    </span>
                    <span className="text-xs text-text-2">
                      {summary?.count ?? 0} student
                      {summary?.count === 1 ? "" : "s"}
                    </span>
                    <ArrowRight className="h-4 w-4 text-text-2" aria-hidden />
                    <div className="min-w-[12rem] flex-1">
                      <Select
                        aria-label={`Next class for ${cls}`}
                        options={targetOptions}
                        value={
                          classMap[cls] === null || classMap[cls] === undefined
                            ? TERMINAL
                            : String(classMap[cls])
                        }
                        onChange={(v) =>
                          setClassMap((prev) => ({
                            ...prev,
                            [cls]: v === TERMINAL ? null : v,
                          }))
                        }
                        hideLabel
                      />
                    </div>
                    {isTerminal && (
                      <span className="text-xs font-medium text-accent">
                        graduates
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {mapEdited && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="mt-3"
                onClick={() => setClassMap(preview.class_map || {})}
              >
                Reset to the automatic map
              </Button>
            )}
          </section>

          {/* 3 — outcomes */}
          <section className="rounded-2xl border border-line-1 bg-surface-1 p-5">
            <h2 className="text-sm font-semibold text-text-1">
              3. Flag the exceptions
            </h2>
            <p className="mt-1 text-xs text-text-2">
              Everyone defaults to the outcome their class maps to. Set a whole
              class at once, or override individual students below.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(OUTCOME_META) as Outcome[]).map((k) => {
                const Icon = OUTCOME_META[k].icon;
                return (
                  <div
                    key={k}
                    className="rounded-xl border border-line-1 bg-surface-0 px-3 py-2"
                  >
                    <div className={`flex items-center gap-1.5 text-xs font-medium ${OUTCOME_META[k].tone}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {OUTCOME_META[k].label} · {tally[k]}
                    </div>
                    <p className="mt-1 text-[0.7rem] leading-4 text-text-2">
                      {OUTCOME_META[k].blurb}
                    </p>
                  </div>
                );
              })}
            </div>

            {preview.by_class.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-medium text-text-2">
                  Whole-class overrides
                </p>
                <div className="mt-2 space-y-2">
                  {preview.by_class.map((c) => (
                    <div
                      key={c.class_name}
                      className="flex items-center gap-3"
                    >
                      <span className="min-w-[7rem] text-xs text-text-1">
                        {c.class_name}
                      </span>
                      <div className="min-w-[12rem]">
                        <Select
                          aria-label={`Default outcome for ${c.class_name}`}
                          options={[
                            { value: "", label: "From the class map" },
                            ...outcomeOptionsFor,
                          ]}
                          value={classOverrides[c.class_name] || ""}
                          onChange={(v) => setClassOutcome(c.class_name, v)}
                          hideLabel
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {roster.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-medium text-text-2">
                  Individual overrides ({Object.keys(overrides).length})
                </p>
                <div className="mt-2 max-h-96 space-y-1 overflow-y-auto pr-1">
                  {roster.map((s) => {
                    const key = s.student_id.toLowerCase();
                    const derived = outcomeFor(s);
                    const touched = Boolean(overrides[key]);
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${
                          touched
                            ? "bg-warning-soft ring-1 ring-warning/25"
                            : "bg-surface-0"
                        }`}
                      >
                        <span className="min-w-[10rem] truncate text-xs text-text-1">
                          {s.full_name}
                        </span>
                        <span className="min-w-[5rem] font-mono text-[0.7rem] text-text-2">
                          {s.student_id}
                        </span>
                        <span className="min-w-[4rem] text-[0.7rem] text-text-2">
                          {s.class_name}
                        </span>
                        <div className="min-w-[9rem]">
                          <Select
                            aria-label={`Outcome for ${s.full_name}`}
                            options={[
                              {
                                value: "",
                                label: OUTCOME_META[derived].label,
                              },
                              ...outcomeOptionsFor,
                            ]}
                            value={overrides[key] || ""}
                            onChange={(v) =>
                              setOverrides((prev) => {
                                const next = { ...prev };
                                if (!v) delete next[key];
                                else next[key] = v as Outcome;
                                return next;
                              })
                            }
                            hideLabel
                          />
                        </div>
                        {touched && (
                          <button
                            type="button"
                            onClick={() =>
                              setOverrides((prev) => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              })
                            }
                            className="text-[0.7rem] text-text-2 underline hover:text-text-1"
                          >
                            reset
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* 4 — confirm */}
          <section className="rounded-2xl border border-line-1 bg-surface-1 p-5">
            <h2 className="text-sm font-semibold text-text-1">4. Close the session</h2>
            <p className="mt-1 text-xs text-text-2">
              This writes a plan you can review before anything is committed.
            </p>
            <Button
              type="button"
              className="mt-4"
              disabled={working}
              onClick={() => void createDraft()}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Review and close
            </Button>
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o) setConfirming(false);
        }}
        title={`Close ${fromSession} and move to ${toSession}?`}
        message={
          `${preview?.active_students ?? 0} students will be reclassified: ` +
          `${tally.promote} promoted, ${tally.repeat} repeating, ${tally.graduate} graduated, ${tally.withdraw} withdrawn. ` +
          `Your slot ledger changes now: ${tally.graduate} slot(s) released immediately. ` +
          `${tally.withdraw} further slot(s) are released at the start of ${toSession}, ` +
          `in case those students come back. This cannot be undone.`
        }
        note="This changes every student's class and moves money in your slot ledger. It cannot be undone."
        confirmLabel="Close the session"
        variant="danger"
        loading={working}
        onConfirm={() => void handleApply()}
      />
    </div>
  );
}