"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useGlobalTerm } from "@/lib/useGlobalTerm";
import { Select, type SelectOption } from "@/components/ui/Select";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  BookOpen,
  Users,
  Search,
  Pencil,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

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
  gender?: string | null;
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

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseAssessments(template: GradingTemplate | null | undefined): Assessment[] {
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

export default function MyClassesPage() {
  const params = useParams<{ subdomain: string }>();
  const tenantId = (params.subdomain || "").toLowerCase().trim();

  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [hubTemplate, setHubTemplate] = useState<GradingTemplate | null>(null);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Allocation | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTerm, setActiveTerm] = useState<string>("Term 1");
  // Default-plus-override: global admin term until the user picks otherwise.
  const [termTouched, setTermTouched] = useState(false);
  const globalTerm = useGlobalTerm(tenantId);

  useEffect(() => {
    if (!termTouched && globalTerm && activeTerm !== globalTerm.term) {
      setActiveTerm(globalTerm.term);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [globalTerm, termTouched]);
  // Desktop-only: collapsible "My Classes" column to reclaim gradebook width.
  const [classesCollapsed, setClassesCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("staff-classes-collapsed");
      if (saved === "1") setClassesCollapsed(true);
    } catch {
      // ignore — collapse preference is best-effort
    }
  }, []);

  function toggleClassesCollapsed() {
    setClassesCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("staff-classes-collapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

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
      if (!res.ok) throw new Error(data.error || `Failed to load classes (${res.status})`);
      const list = Array.isArray(data.allocations) ? data.allocations : [];
      setAllocations(list);
      setHubTemplate(data.template ?? null);

      // Initialize selectedAllocation: first on desktop, null on mobile
      if (list.length > 0) {
        const isDesktop = typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : false;
        if (isDesktop) {
          setSelected((prev) => prev ?? list[0]);
        } else {
          // mobile: keep null by default (unless user already selected something)
          setSelected((prev) => prev ?? null);
        }
      }
    } catch (err) {
      setAllocations([]);
      setHubTemplate(null);
      setHubError(err instanceof Error ? err.message : "Failed to load classes");
    } finally {
      setHubLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchHub();
  }, [fetchHub]);

  // Keep selected in sync if allocations reload and selected disappears
  useEffect(() => {
    if (!selected) return;
    if (!allocations.find((a) => a.id === selected.id)) {
      setSelected(null);
    }
  }, [allocations, selected]);

  const fetchRoster = useCallback(async () => {
    if (!selected) {
      setBundle(null);
      setRosterError(null);
      return;
    }
    setRosterLoading(true);
    setRosterError(null);
    try {
      const decodedClass = safeDecode(selected.class_name);
      const decodedSubject = safeDecode(selected.subject_name);
      const qs = new URLSearchParams({
        tenant_id: tenantId,
        class_name: decodedClass,
        subject_name: decodedSubject,
        term: activeTerm,
      });
      const res = await fetch(`/api/staff/grading?${qs.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as Bundle & { error?: string };
      if (!res.ok) throw new Error(data.error || `Failed to load roster (${res.status})`);
      setBundle(data);
    } catch (err) {
      setBundle(null);
      setRosterError(err instanceof Error ? err.message : "Failed to load roster");
    } finally {
      setRosterLoading(false);
    }
  }, [selected, activeTerm, tenantId]);

  useEffect(() => {
    void fetchRoster();
  }, [fetchRoster]);

  // Assessments derived from bundle template (preferred) else hub template
  const assessments = useMemo(() => {
    if (bundle?.template) return parseAssessments(bundle.template);
    return parseAssessments(hubTemplate);
  }, [bundle, hubTemplate]);

  const totalMax = useMemo(() => assessments.reduce((acc, a) => acc + (a.max || 0), 0), [assessments]);

  const filteredStudents = useMemo(() => {
    if (!bundle?.students) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return bundle.students;
    return bundle.students.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.student_id.toLowerCase().includes(q),
    );
  }, [bundle, searchTerm]);

  const decodedSelectedClass = selected ? safeDecode(selected.class_name) : "";
  const decodedSelectedSubject = selected ? safeDecode(selected.subject_name) : "";

  return (
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden bg-surface-0 text-text-1">
      {/* Responsive container: mobile stack, desktop split */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden md:flex-row">
        {/* Master List — collapsible on desktop, stack on mobile */}
        <div
          className={[
            "flex min-w-0 flex-col border-line-1 bg-surface-1",
            // Desktop: collapsible rail vs 30% panel
            classesCollapsed
              ? "md:flex md:w-14 md:min-w-[3.5rem] md:max-w-[3.5rem] md:border-r md:shrink-0"
              : "md:flex md:w-[30%] md:min-w-[280px] md:max-w-[380px] md:border-r md:shrink-0",
            // Mobile: full-width when no selection, hidden when selection present
            selected ? "hidden md:flex" : "flex w-full",
          ].join(" ")}
        >
          {classesCollapsed ? (
            <div className="hidden flex-col items-center gap-3 px-2 py-4 md:flex">
              <button
                type="button"
                onClick={toggleClassesCollapsed}
                aria-label="Expand My Classes"
                aria-expanded="false"
                title="Expand My Classes"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-1 bg-surface-2 text-text-2 transition hover:bg-surface-3 hover:text-text-1"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
              <span
                aria-label={`${allocations.length} classes assigned`}
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent-soft px-1.5 text-xs font-semibold text-accent ring-1 ring-accent/30"
              >
                {allocations.length}
              </span>
              <BookOpen className="h-4 w-4 text-text-3" />
            </div>
          ) : (
            <>
          <div className="border-b border-line-1 px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <h1 className="flex min-w-0 items-center gap-2 text-lg font-bold tracking-tight text-text-1">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft ring-1 ring-accent/30">
                  <BookOpen className="h-4 w-4 text-accent" />
                </span>
                <span className="truncate">My Classes</span>
              </h1>
              <button
                type="button"
                onClick={toggleClassesCollapsed}
                aria-label="Collapse My Classes"
                aria-expanded="true"
                title="Collapse My Classes"
                className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-1 bg-surface-2 text-text-2 transition hover:bg-surface-3 hover:text-text-1 md:inline-flex"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-text-3">
              {allocations.length} class{allocations.length !== 1 ? "es" : ""} assigned
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            {hubLoading && (
              <div className="flex items-center gap-2 rounded-xl border border-line-1 bg-surface-1 px-4 py-6 text-sm text-text-3">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading classes…
              </div>
            )}
            {!hubLoading && hubError && (
              <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <span>{hubError}</span>
                  <button
                    type="button"
                    onClick={() => void fetchHub()}
                    className="ml-2 font-medium underline underline-offset-4"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
            {!hubLoading && !hubError && allocations.length === 0 && (
              <div className="rounded-2xl border border-warning/30 bg-warning-soft p-6 text-center">
                <Users className="mx-auto h-6 w-6 text-warning" />
                <h3 className="mt-2 text-sm font-semibold text-text-1">No classes assigned</h3>
                <p className="mt-1 text-xs text-text-3">
                  Your allocations will appear here once an admin assigns you.
                </p>
              </div>
            )}
            {!hubLoading && !hubError && allocations.length > 0 && (
              <div className="space-y-2">
                {allocations.map((a) => {
                  const isActive = selected?.id === a.id;
                  const classDecoded = safeDecode(a.class_name);
                  const subjectDecoded = safeDecode(a.subject_name);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelected(a)}
                      className={[
                        "w-full rounded-xl border px-4 py-3 text-left transition backdrop-blur",
                        isActive
                          ? "bg-surface-3 border-accent/40 ring-1 ring-accent/30"
                          : "border-line-1 bg-surface-1 hover:bg-surface-2",
                      ].join(" ")}
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-text-3">
                        {classDecoded}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-text-1">
                        {classDecoded} • {subjectDecoded}
                      </p>
                      <p className="mt-1 text-xs text-text-3">Assigned as {a.staff_name}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
            </>
          )}
        </div>

        {/* Gradebook & Roster */}
        <div
          className={[
            "flex min-h-0 min-w-0 flex-1 flex-col bg-surface-1",
            // Desktop: always visible — 70% when panel open, fluid when collapsed
            classesCollapsed ? "md:flex md:w-auto" : "md:flex md:w-[70%] md:min-w-0",
            // Mobile: hidden when no selection, full-width when selected
            selected ? "flex w-full" : "hidden md:flex",
          ].join(" ")}
        >
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="max-w-sm rounded-2xl border border-line-1 bg-surface-1 p-8 text-center">
                <Users className="mx-auto h-8 w-8 text-text-3" />
                <h3 className="mt-3 text-sm font-semibold text-text-1">Select a class</h3>
                <p className="mt-1 text-sm text-text-3">
                  Choose a class from the left to view its roster and gradebook.
                </p>
                <p className="mt-3 text-xs text-text-3 md:hidden">
                  Your classes are listed above — tap any card to view students.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Mobile back button */}
              <div className="border-b border-line-1 px-4 py-3 md:hidden">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-1 bg-surface-2 px-3 py-1.5 text-sm font-medium text-text-2 transition hover:bg-surface-3 hover:text-text-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back to My Classes
                </button>
              </div>

              {/* Header Bar */}
              <div className="min-w-0 border-b border-line-1 px-4 py-4 sm:px-6">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-bold tracking-tight text-text-1">
                        {decodedSelectedClass} • {decodedSelectedSubject}
                      </h2>
                      <p className="mt-1 text-xs text-text-3">
                        {bundle ? `${bundle.students.length} student${bundle.students.length !== 1 ? "s" : ""}` : "Roster"} • Term: {activeTerm}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {classesCollapsed && (
                        <button
                          type="button"
                          onClick={toggleClassesCollapsed}
                          aria-label="Expand My Classes"
                          title="Show My Classes"
                          className="hidden items-center gap-1.5 rounded-full border border-line-1 bg-surface-2 px-3 py-2 text-sm font-medium text-text-2 transition hover:bg-surface-3 hover:text-text-1 md:inline-flex"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                          Classes
                        </button>
                      )}
                      <Link
                        href={`/${tenantId}/staff/grading/${encodeURIComponent(selected.class_name)}/${encodeURIComponent(selected.subject_name)}?term=${encodeURIComponent(activeTerm)}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit Grades
                      </Link>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative flex-1 sm:max-w-sm">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search by name or admission no…"
                        className="w-full rounded-xl border border-line-1 bg-surface-3 py-2 pl-9 pr-3 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-text-2">
                      Term
<Select
                          aria-label="Term"
                          value={activeTerm}
                          onChange={(v) => {
                            setTermTouched(true);
                            setActiveTerm(v);
                          }}
                          triggerClassName="w-44"
                          options={TERMS.map((t): SelectOption => ({ value: t, label: t }))}
                        />
                    </label>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {rosterLoading && (
                  <div className="flex items-center gap-2 rounded-xl border border-line-1 bg-surface-1 px-4 py-6 text-sm text-text-3">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading roster…
                  </div>
                )}
                {!rosterLoading && rosterError && (
                  <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <div className="flex-1">
                      <span>{rosterError}</span>
                      <button
                        type="button"
                        onClick={() => void fetchRoster()}
                        className="ml-2 font-medium underline underline-offset-4"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}
                {!rosterLoading && !rosterError && bundle && bundle.students.length === 0 && (
                  <div className="rounded-2xl border border-warning/30 bg-warning-soft p-6 text-center">
                    <Users className="mx-auto h-6 w-6 text-warning" />
                    <h3 className="mt-2 text-sm font-semibold text-text-1">No students in {decodedSelectedClass}</h3>
                    <p className="mt-1 text-xs text-text-3">Ask an admin to add students to this class.</p>
                  </div>
                )}
                {!rosterLoading && !rosterError && bundle && bundle.students.length > 0 && (
                  <div className="min-w-0 overflow-hidden rounded-xl border border-line-1 bg-surface-1">
                    {/* Scroll wrappers: horizontal + vertical — max-h keeps layout stable, scroll stays inside card */}
                    <div className="max-w-full overflow-x-auto">
                      <div className="max-h-[65vh] overflow-y-auto">
                        <table className="w-max min-w-full text-left text-sm md:min-w-[720px]">
                          <thead className="sticky top-0 z-20 bg-surface-2 text-xs uppercase tracking-wide text-text-2">
                            <tr>
                              <th className="px-3 py-3 font-medium border-b border-line-1 whitespace-nowrap">
                                Admission No.
                              </th>
                              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-3 font-medium border-b border-line-1 whitespace-nowrap border-r border-line-2">
                                Full Name
                              </th>
                              <th className="px-3 py-3 font-medium border-b border-line-1 whitespace-nowrap">Gender</th>
                              {assessments.map((a) => (
                                <th
                                  key={a.key}
                                  className="px-3 py-3 font-medium border-b border-line-1 whitespace-nowrap text-center"
                                  title={`${a.category} • Max ${a.max}`}
                                >
                                  <span>{a.key}</span>
                                  <span className="ml-1 text-[10px] font-normal text-text-3">/ {a.max}</span>
                                </th>
                              ))}
                              <th className="px-3 py-3 font-medium border-b border-line-1 whitespace-nowrap text-center">
                                Total
                                <span className="ml-1 text-[10px] font-normal text-text-3">/ {totalMax || "—"}</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line-1">
                            {filteredStudents.length === 0 ? (
                              <tr>
                                <td colSpan={3 + assessments.length + 1} className="px-4 py-8 text-center text-sm text-text-3">
                                  No students match &quot;{searchTerm}&quot;.
                                </td>
                              </tr>
                            ) : (
                              filteredStudents.map((s) => {
                                const scores = bundle.grades[s.student_id] || {};
                                const hasAnyScore = assessments.some((a) => scores[a.key] !== undefined);
                                const totalScored = assessments.reduce((acc, a) => {
                                  const v = scores[a.key];
                                  return acc + (typeof v === "number" ? v : 0);
                                }, 0);
                                return (
                                  <tr key={s.id} className="hover:bg-surface-2">
                                    <td className="px-3 py-3 font-mono text-xs text-text-2 whitespace-nowrap">
                                      {s.student_id}
                                    </td>
                                    <td className="sticky left-0 z-10 bg-surface-2 px-3 py-3 text-text-1 border-r border-line-1 whitespace-nowrap">
                                      {s.full_name}
                                    </td>
                                    <td className="px-3 py-3 text-xs text-text-2 whitespace-nowrap">
                                      {s.gender ? (s.gender.charAt(0).toUpperCase() + s.gender.slice(1).toLowerCase()) : "—"}
                                    </td>
                                    {assessments.map((a) => {
                                      const v = scores[a.key];
                                      const display = v !== undefined && v !== null ? String(v) : "—";
                                      return (
                                        <td
                                          key={a.key}
                                          className={[
                                            "px-3 py-3 text-center text-xs",
                                            v !== undefined ? "text-text-1 font-medium" : "text-text-3",
                                          ].join(" ")}
                                        >
                                          {display}
                                        </td>
                                      );
                                    })}
                                    <td className="px-3 py-3 text-center text-xs font-semibold text-text-2">
                                      {hasAnyScore ? `${totalScored}` : "—"}
                                      <span className="ml-1 font-normal text-text-3">/ {totalMax || "—"}</span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {assessments.length === 0 && (
                      <div className="border-t border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning text-center">
                        No assessment columns — template has no items. Total shows raw sum will be 0.
                      </div>
                    )}
                    <div className="border-t border-line-2 bg-surface-2 px-3 py-2 text-xs text-text-3">
                      Showing {filteredStudents.length} of {bundle.students.length} students • {assessments.length} assessments • Total max {totalMax}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
