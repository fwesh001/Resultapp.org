"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGlobalTerm } from "@/lib/useGlobalTerm";
import { useParams, useSearchParams } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import Link from "next/link";
import { Select, type SelectOption } from "@/components/ui/Select";
import {
  Loader2,
  AlertCircle,
  BookOpen,
  Users,
  Save,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/toast";
import { useDraftSave } from "@/lib/useDraftSave";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { DraftRecoveryPrompt } from "@/components/ui/DraftRecoveryPrompt";
import { NetworkIndicator } from "@/components/ui/NetworkIndicator";

const TERMS = ["Term 1", "Term 2", "Term 3"] as const;

interface TemplateComponent {
  name: string;
  weight?: number;
  items?: Array<{ name: string; max_score?: number; max?: number }>;
  max_score?: number;
  max?: number;
}

interface GradingTemplate {
  id: number | string;
  name: string;
  academic_structure?: { components?: TemplateComponent[] } | null;
  behavioral_structure?: { traits?: string[]; scale?: string[] } | null;
}

interface Allocation {
  id: string;
  subdomain: string;
  subject_name: string;
  class_name: string;
  staff_name: string;
  created_at?: string;
}

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  class_name: string;
}

interface Bundle {
  template?: GradingTemplate;
  students: Student[];
  grades: Record<string, Record<string, number>>;
  behavioural?: Record<string, Record<string, string>>;
  term: string;
  class_name: string;
  subject_name: string;
}

interface Assessment {
  key: string;
  max: number;
  category: string;
}

/** useParams values may arrive URL-encoded (e.g. "JSS%201"); never throw on stray `%`. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitize(value: string): string {
  return value.replace(/\s+/g, "_");
}

/**
 * Pre-v1 draft key, kept so existing in-progress work is still recoverable.
 * v1 moved to a term-scoped `resultapp|draft|v1|…` key because the old one
 * omitted term and so let one term's draft overwrite another's.
 */
function legacyDraftKey(
  tenantId: string,
  className: string,
  subjectName: string,
  assessmentKey: string,
): string {
  return `draft_${tenantId}_${sanitize(className)}_${sanitize(subjectName)}_${sanitize(assessmentKey)}`;
}

function parseAssessments(template: GradingTemplate | null): Assessment[] {
  if (!template?.academic_structure?.components) return [];
  const components = template.academic_structure.components || [];
  const out: Assessment[] = [];
  for (const comp of components) {
    const category = comp.name || "General";
    if (Array.isArray(comp.items) && comp.items.length > 0) {
      for (const it of comp.items) {
        if (!it.name) continue;
        out.push({
          key: it.name,
          max: Number(it.max_score ?? it.max ?? 0),
          category,
        });
      }
    } else if (comp.name) {
      out.push({
        key: comp.name,
        max: Number(comp.max_score ?? comp.max ?? 0),
        category,
      });
    }
  }
  return out;
}

export default function SmartStaffHubPage() {
  const params = useParams<{ subdomain: string }>();
  const searchParams = useSearchParams();
  const rawTenant = params.subdomain || "";
  const tenantId = rawTenant.toLowerCase().trim();
  // Nudge deep-link guard (?action=grade&subject=&class?/&term?) — fires once.
  const deepLinkHandled = useRef(false);

  // Hub state
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [template, setTemplate] = useState<GradingTemplate | null>(null);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState<string | null>(null);
  // Default-plus-override: global admin term until the user picks otherwise.
  const [term, setTerm] = useState<string>("Term 1");
  const [termTouched, setTermTouched] = useState(false);
  const globalTerm = useGlobalTerm(tenantId);

  useEffect(() => {
    if (!termTouched && globalTerm && term !== globalTerm.term) {
      setTerm(globalTerm.term);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [globalTerm, termTouched]);

  // Modal state — one assessment at a time
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [activeSubject, setActiveSubject] = useState<string | null>(null);
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [dismissedRestoreKey, setDismissedRestoreKey] = useState<string | null>(null);

  const { isOnline } = useOnlineStatus();

  // Offline-first draft persistence. Term is part of the scope, so a Term 1
  // draft can never be restored over Term 2 marks.
  const decodedActiveClass = activeClass ? safeDecode(activeClass) : "";
  const decodedActiveSubject = activeSubject ? safeDecode(activeSubject) : "";
  const draftScope = useMemo(
    () => ({
      tenantId,
      term,
      className: decodedActiveClass,
      subjectName: decodedActiveSubject,
      assessmentKey: activeAssessment?.key ?? "",
    }),
    [tenantId, term, decodedActiveClass, decodedActiveSubject, activeAssessment?.key],
  );
  const legacyKeys = useMemo(
    () =>
      activeClass && activeSubject && activeAssessment
        ? [legacyDraftKey(tenantId, safeDecode(activeClass), safeDecode(activeSubject), activeAssessment.key)]
        : [],
    [tenantId, activeClass, activeSubject, activeAssessment],
  );
  const draft = useDraftSave<Record<string, string>>({
    scope: draftScope,
    value: drafts,
    enabled: Boolean(activeClass && activeSubject && activeAssessment),
    legacyKeys,
  });

  function applyDraft(base: Record<string, string>, incoming: Record<string, string>) {
    const known = new Set((bundle?.students ?? []).map((s) => s.student_id));
    const next: Record<string, string> = { ...base };
    for (const [sid, val] of Object.entries(incoming)) {
      // Ignore students no longer on the roster so a stale draft cannot
      // reintroduce (or submit) someone who has been removed.
      if (known.size > 0 && !known.has(sid)) continue;
      if (typeof val === "string") next[sid] = val;
    }
    return next;
  }

  function handleRestore() {
    const found = draft.readDraft();
    if (restoreKey) setDismissedRestoreKey(restoreKey);
    if (!found) return;
    setDrafts((prev) => applyDraft(prev, found.values));
    draft.consumeRestore();
    toast.success("Draft restored", {
      description: found.legacy
        ? "Recovered from an earlier version of the app."
        : "Your unsaved scores are back. Press Save to publish them.",
    });
  }

  function handleDiscardDraft() {
    draft.clearDraft();
    if (restoreKey) setDismissedRestoreKey(restoreKey);
    draft.consumeRestore();
    toast.info("Draft discarded", { description: "Keeping the values stored on the server." });
  }

  // The prompt's open state is derived, not set from an effect: dismissing
  // records the specific draft key so a different draft can still prompt later.
  const restoreKey = draft.pendingRestore?.key ?? null;
  const showRestorePrompt = Boolean(activeAssessment && restoreKey && restoreKey !== dismissedRestoreKey);

  const assessments = useMemo(() => parseAssessments(template), [template]);

  const fetchHub = useCallback(async () => {
    if (!tenantId) return;
    setHubLoading(true);
    setHubError(null);
    try {
      const qs = new URLSearchParams({ tenant_id: tenantId });
      const res = await fetch(`/api/staff/grading?${qs.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as {
        allocations?: Allocation[];
        template?: GradingTemplate | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `Failed to load hub (${res.status})`);
      setAllocations(Array.isArray(data.allocations) ? data.allocations : []);
      setTemplate(data.template ?? null);
    } catch (err) {
      setAllocations([]);
      setTemplate(null);
      setHubError(err instanceof Error ? err.message : "Failed to load hub");
    } finally {
      setHubLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchHub();
  }, [fetchHub]);

  // Nudge CTA deep-link: ?action=grade&subject=X[&class=Y][&term=Z] auto-opens
  // the grading modal for the matching allocation (first assessment).
  // Silent no-op for missing/invalid params or unmatched allocations.
  useEffect(() => {
    if (deepLinkHandled.current || hubLoading) return;
    if ((searchParams.get("action") || "").trim().toLowerCase() !== "grade") return;
    const subjectQ = (searchParams.get("subject") || "").trim().toLowerCase();
    if (!subjectQ || allocations.length === 0 || assessments.length === 0) return;
    const classQ = (searchParams.get("class") || "").trim().toLowerCase();
    const match =
      (classQ
        ? allocations.find(
            (a) =>
              safeDecode(a.subject_name).toLowerCase() === subjectQ &&
              safeDecode(a.class_name).toLowerCase() === classQ,
          )
        : undefined) ??
      allocations.find((a) => safeDecode(a.subject_name).toLowerCase() === subjectQ);
    if (!match) return;
    deepLinkHandled.current = true;
    const termQ = (searchParams.get("term") || "").trim();
    if ((TERMS as readonly string[]).includes(termQ)) {
      setTerm(termQ);
      setTermTouched(true);
    }
    openAssessment(match.class_name, match.subject_name, assessments[0]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [hubLoading, allocations, assessments, searchParams]);

  const fetchBundleForActive = useCallback(async () => {
    if (!activeClass || !activeSubject || !activeAssessment) return;
    setBundleLoading(true);
    setBundleError(null);
    try {
      const decodedClass = safeDecode(activeClass);
      const decodedSubject = safeDecode(activeSubject);
      const qs = new URLSearchParams({
        tenant_id: tenantId,
        class_name: decodedClass,
        subject_name: decodedSubject,
        term,
      });
      const res = await fetch(`/api/staff/grading?${qs.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as Bundle & { error?: string };
      if (!res.ok) throw new Error(data.error || `Failed to load students (${res.status})`);
      setBundle(data);
      // Seed from server grades only. Any device draft is offered separately via
      // the DraftRecoveryPrompt — never silently merged, which could overwrite
      // a colleague's marks with this device's stale copy.
      const existing = data.grades || {};
      const baseDrafts: Record<string, string> = {};
      for (const s of data.students || []) {
        const v = existing[s.student_id]?.[activeAssessment.key];
        if (v !== undefined && v !== null) baseDrafts[s.student_id] = String(v);
      }
      setDrafts(baseDrafts);
      setFieldErrors({});
    } catch (err) {
      setBundle(null);
      setBundleError(err instanceof Error ? err.message : "Failed to load students");
    } finally {
      setBundleLoading(false);
    }
  }, [activeClass, activeSubject, activeAssessment, tenantId, term]);

  useEffect(() => {
    if (activeAssessment && activeClass && activeSubject) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchBundleForActive();
    }
  }, [activeAssessment, activeClass, activeSubject, fetchBundleForActive]);

  // Autosave to the device is handled by `useDraftSave` (debounced, term-scoped,
  // private-mode tolerant) — no manual localStorage effect here.

  function openAssessment(
    className: string,
    subjectName: string,
    assessment: Assessment,
  ) {
    setActiveClass(className);
    setActiveSubject(subjectName);
    setActiveAssessment(assessment);
    // drafts will be seeded in fetchBundleForActive
  }

  function handleCloseAttempt(nextOpen: boolean) {
    if (nextOpen) return;
    if (!activeAssessment || !activeClass || !activeSubject) {
      setActiveAssessment(null);
      setActiveClass(null);
      setActiveSubject(null);
      return;
    }
    // Dirty state check against in-memory state (what the hook persists).
    const saved = bundle?.grades || {};
    const hasUnsaved = Object.entries(drafts).some(([sid, raw]) => {
      const trimmed = String(raw).trim();
      if (trimmed === "") return false;
      const savedVal = saved[sid]?.[activeAssessment.key];
      return savedVal === undefined || String(savedVal) !== trimmed;
    });
    if (hasUnsaved) {
      setShowDiscardConfirm(true);
      return;
    }
    discardAndClose();
  }

  function discardAndClose() {
    setShowDiscardConfirm(false);
    setActiveAssessment(null);
    setActiveClass(null);
    setActiveSubject(null);
    setBundle(null);
    setDrafts({});
    setFieldErrors({});
  }

  async function handleSave() {
    if (!activeAssessment || !bundle || !activeClass || !activeSubject) return;
    const decodedClass = safeDecode(activeClass);
    const decodedSubject = safeDecode(activeSubject);
    const scores = Object.entries(drafts)
      .filter(([, raw]) => String(raw).trim() !== "")
      .map(([student_id, raw]) => ({ student_id, score: parseFloat(String(raw)) }))
      .filter((s) => !isNaN(s.score));

    if (scores.length === 0) return;

    // Fast pre-check only. `navigator.onLine` is link-layer: a captive portal or
    // a WiFi connection with no upstream still reports true, so the catch block
    // below remains the real safety net and must keep the draft either way.
    if (isOnline === false) {
      toast.warning("You're offline", {
        description:
          "Your scores are saved on this device. Reconnect and press Save to publish them.",
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/staff/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          term,
          subject_name: decodedSubject,
          class_name: decodedClass,
          assessment_key: activeAssessment.key,
          scores,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      // Only now is the draft redundant: a confirmed 200 from the backend.
      // Also clears any legacy key so it cannot resurface later.
      draft.clearDraft();
      toast.success(`Saved ${activeAssessment.key} for ${scores.length} student${scores.length === 1 ? "" : "s"}`);
      // Close modal and refetch hub? Keep closed
      setActiveAssessment(null);
      setActiveClass(null);
      setActiveSubject(null);
      setBundle(null);
      setDrafts({});
      setFieldErrors({});
      // Optional: refetch bundle cache for that class would show updated counts next open
    } catch (err) {
      // Draft deliberately NOT cleared. If navigator.onLine lied (captive
      // portal, dead upstream) this is the only thing standing between the
      // teacher and lost work.
      toast.error("Could not save scores", {
        description:
          (err instanceof Error ? err.message : "Please try again") +
          " — your work is still saved on this device.",
      });
    } finally {
      setSaving(false);
    }
  }

  const hasFieldError = Object.values(fieldErrors).some(Boolean);
  const enteredCount = Object.values(drafts).filter((v) => String(v).trim() !== "").length;
  const modalOpen = activeAssessment !== null && activeClass !== null && activeSubject !== null;

  return (
    <div className="min-h-screen bg-[#0B0514] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/${tenantId}/staff`}
            className="inline-flex items-center gap-1.5 text-sm text-purple-300/60 transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
                <Logo size="sm" alt="" className="rounded-lg" />
                Smart Staff Hub
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-purple-200/60">
                Failsafe grading workflow — select a class, pick an assessment pill, and enter scores. Drafts auto-save to your browser; we’ll confirm before discarding unsaved work.
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-900/10 px-2.5 py-1 text-xs text-purple-300/70">
                <ShieldCheck className="h-3 w-3" /> {tenantId}.resultapp.org • {term}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-purple-200/70">
              Term
<Select
                  aria-label="Term"
                  value={term}
                  onChange={(v) => {
                    setTermTouched(true);
                    setTerm(v);
                  }}
                  triggerClassName="w-44"
                  options={TERMS.map((t): SelectOption => ({ value: t, label: t }))}
                />
            </label>
          </div>
        </div>

        {/* Hub loading / error */}
        {hubLoading && (
          <div className="flex items-center gap-2 rounded-xl border border-purple-500/20 bg-purple-900/[0.04] px-4 py-6 text-sm text-purple-200/70 backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your allocations…
          </div>
        )}
        {!hubLoading && hubError && (
          <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <div className="flex-1">
              <span>{hubError}</span>
              <button
                type="button"
                onClick={() => void fetchHub()}
                className="ml-2 font-medium underline underline-offset-4 hover:text-red-200"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Empty states */}
        {!hubLoading && !hubError && allocations.length === 0 && (
          <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-8 text-center backdrop-blur">
            <Users className="mx-auto h-8 w-8 text-amber-300" />
            <h3 className="mt-3 text-sm font-semibold text-white">No allocations yet</h3>
            <p className="mt-1 text-sm text-purple-200/60">
              Your Principal hasn&apos;t assigned any classes. Please check back later or contact admin.
            </p>
          </div>
        )}

        {!hubLoading && !hubError && allocations.length > 0 && !template && (
          <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-6 text-center">
            <AlertCircle className="mx-auto h-6 w-6 text-amber-300" />
            <h3 className="mt-2 text-sm font-semibold text-white">No grading template</h3>
            <p className="mt-1 text-sm text-purple-200/60">
              Ask an admin to create a grading template before entering scores. Pills will appear once a template exists.
            </p>
          </div>
        )}

        {/* Grid */}
        {!hubLoading && !hubError && allocations.length > 0 && template && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allocations.map((a) => {
              const classDecoded = safeDecode(a.class_name);
              const subjectDecoded = safeDecode(a.subject_name);
              return (
                <div
                  key={a.id}
                  className="rounded-2xl border border-purple-500/20 bg-purple-900/[0.04] p-5 backdrop-blur transition hover:bg-purple-900/10"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/15 ring-1 ring-purple-500/20">
                    <BookOpen className="h-5 w-5 text-purple-300" />
                  </div>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-purple-300/60">
                    {classDecoded}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-white">
                    {classDecoded} • {subjectDecoded}
                  </h3>
                  <p className="mt-1 text-xs text-purple-200/50">Assigned as {a.staff_name}</p>

                  {assessments.length === 0 ? (
                    <p className="mt-3 rounded-xl border border-amber-500/15 bg-amber-500/10 p-2 text-xs text-amber-300">
                      Template has no assessment items.
                    </p>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {assessments.map((ass) => (
                        <button
                          key={ass.key}
                          type="button"
                          onClick={() => openAssessment(a.class_name, a.subject_name, ass)}
                          className="rounded-full border border-purple-500/15 bg-purple-900/20 px-3 py-1.5 text-xs font-medium text-purple-200 transition hover:bg-purple-800/30 hover:text-white"
                        >
                          {ass.key} <span className="font-normal text-purple-300/60">(Max: {ass.max})</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <Link
                    href={`/${tenantId}/staff/grading/${encodeURIComponent(a.class_name)}/${encodeURIComponent(a.subject_name)}?term=${encodeURIComponent(term)}`}
                    className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full border border-purple-500/15 bg-white/[0.02] py-2 text-xs font-medium text-purple-200 transition hover:bg-purple-900/20 hover:text-white"
                  >
                    Open full sheet
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 rounded-xl border border-purple-500/10 bg-purple-900/[0.03] p-4">
          <p className="text-xs leading-5 text-purple-300/40">
            Workload derived from <span className="font-mono text-purple-200">tenant_allocations</span>. Pills are parsed from the active grading template&apos;s{" "}
            <span className="font-mono">academic_structure</span>.
          </p>
        </div>
      </div>

      {/* Failsafe Grading Modal — centered large, scrollable body */}
      <Modal
        open={modalOpen}
        onOpenChange={handleCloseAttempt}
        title={
          activeAssessment ? `Entering scores for ${activeAssessment.key} • Max: ${activeAssessment.max}` : ""
        }
        description={`${decodedActiveClass} • ${decodedActiveSubject} • ${term}`}
        size="lg"
        className="border-purple-500/20 bg-[#0B0514] text-white"
      >
        {activeAssessment && (
          <div className="space-y-3">
            {bundleLoading && (
              <div className="flex items-center gap-2 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] px-4 py-4 text-sm text-purple-200/70">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading students…
              </div>
            )}
            {!bundleLoading && bundleError && (
              <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <span>{bundleError}</span>
                  <button
                    type="button"
                    onClick={() => void fetchBundleForActive()}
                    className="ml-2 font-medium underline underline-offset-4"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
            {!bundleLoading && !bundleError && bundle && bundle.students.length === 0 && (
              <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 text-center text-sm text-amber-300">
                No students in {decodedActiveClass} yet. Ask an admin to register students first.
              </div>
            )}
            {!bundleLoading && !bundleError && bundle && bundle.students.length > 0 && (
              <>
                <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1 sm:max-h-[60vh]">
                  {bundle.students.map((s) => {
                    const err = fieldErrors[s.student_id];
                    const val = drafts[s.student_id] ?? "";
                    return (
                      <div key={s.id} className="flex items-center gap-3 rounded-xl border border-purple-500/10 bg-purple-900/[0.02] px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-white">
                          {s.full_name}{" "}
                          <span className="font-mono text-xs text-purple-300/40">{s.student_id}</span>
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={activeAssessment.max}
                          value={val}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setDrafts((prev) => ({ ...prev, [s.student_id]: raw }));
                            const n = parseFloat(raw);
                            const over = raw.trim() !== "" && !isNaN(n) && n > activeAssessment.max;
                            setFieldErrors((prev) => ({
                              ...prev,
                              [s.student_id]: over ? `Max is ${activeAssessment.max}` : undefined,
                            }));
                          }}
                          placeholder="–"
                          aria-label={`Score for ${s.full_name}`}
                          className={
                            err
                              ? "h-10 w-24 shrink-0 rounded-xl border border-red-500/60 bg-[#0B0514] px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                              : "h-10 w-24 shrink-0 rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 text-sm text-white placeholder:text-purple-300/30 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                {hasFieldError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-300">
                    <AlertCircle className="h-3.5 w-3.5" /> Some scores exceed the maximum — fix the red fields to save.
                  </p>
                )}
<p className="text-xs text-purple-300/40">
                    Drafts auto-save to this device for{" "}
                    <span className="font-semibold text-purple-200/60">{term}</span>. Closing will prompt if unsaved.
                  </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-purple-300/30">
                    Draft auto-saves to this device for{" "}
                    <span className="font-semibold text-purple-200/60">{term}</span>
                  </p>
                  <NetworkIndicator
                    isOnline={isOnline}
                    isPendingWrite={draft.isPendingWrite}
                    persistenceAvailable={draft.persistenceAvailable}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || hasFieldError || enteredCount === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 py-3 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" /> Save {enteredCount} score{enteredCount === 1 ? "" : "s"}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={(o) => { if (!o) setShowDiscardConfirm(false); }}
        title="Discard unsaved scores?"
        message="You have unsaved scores. Close anyway?"
        variant="default"
        confirmLabel="Discard"
        onConfirm={discardAndClose}
      />

      {/* Draft recovery — offered instead of silently merging over server marks. */}
      <DraftRecoveryPrompt
        open={showRestorePrompt}
        onOpenChange={(o) => { if (!o && restoreKey) setDismissedRestoreKey(restoreKey); }}
        entryCount={Object.values(draft.pendingRestore?.values ?? {}).filter((v) => String(v).trim() !== "").length}
        savedAt={draft.pendingRestore?.savedAt ?? null}
        term={draft.pendingRestore?.term ?? term}
        legacy={draft.pendingRestore?.legacy}
        onRestore={handleRestore}
        onDiscard={handleDiscardDraft}
      />
    </div>
  );
}
