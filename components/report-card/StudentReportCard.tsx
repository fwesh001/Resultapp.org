"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, Lock, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface GradingTemplatePayload {
  id: number | string | null;
  name: string;
  academic_structure: Record<string, unknown> & { components?: Array<{ name: string; weight?: number; items?: Array<{ name: string; max_score?: number; max?: number }>; max_score?: number; max?: number }> };
  behavioral_structure?: { traits?: string[]; scale?: string[] } | null;
  created_at?: string;
}

interface ReportStudent {
  student_id: string;
  full_name: string;
  class_name: string;
  gender?: string | null;
}

interface GradeRow {
  subject_name: string;
  academic_scores: Record<string, number>;
  total: number;
  grade: string;
  remark: string;
}

interface ReportResponse {
  student: ReportStudent | null;
  template: GradingTemplatePayload | null;
  grades: GradeRow[];
  behavioural: Record<string, string>;
  summary: {
    totalScore: number;
    average: number;
    overallGrade: string;
    overallRemark: string;
    subjectsCount: number;
  };
  term: string;
  academic_session: string;
  tenant_id: string;
  student_id: string;
}

interface StudentReportCardProps {
  tenantId: string;
  studentId: string;
  term: string;
  isLocked?: boolean;
  schoolName?: string | null;
}

function gradeFromTotal(total: number): string {
  if (total >= 70) return "A";
  if (total >= 60) return "B";
  if (total >= 50) return "C";
  if (total >= 45) return "D";
  if (total >= 40) return "E";
  return "F";
}

function remarkFromGrade(grade: string): string {
  const map: Record<string, string> = {
    A: "Excellent",
    B: "Very Good",
    C: "Good",
    D: "Pass",
    E: "Pass",
    F: "Fail",
  };
  return map[grade] || "";
}

interface AssessmentMeta {
  key: string;
  max: number;
  category: string;
}

function parseAssessments(template: GradingTemplatePayload | null): AssessmentMeta[] {
  if (!template?.academic_structure?.components) return [];
  const comps = template.academic_structure.components || [];
  const out: AssessmentMeta[] = [];
  for (const comp of comps) {
    const category = (comp.name as string) || "General";
    const items = comp.items as Array<{ name: string; max_score?: number; max?: number }> | undefined;
    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        if (!it.name) continue;
        out.push({
          key: String(it.name).trim(),
          max: Number(it.max_score ?? it.max ?? 0),
          category,
        });
      }
    } else if (comp.name) {
      out.push({
        key: String(comp.name).trim(),
        max: Number((comp as { max_score?: number }).max_score ?? (comp as { max?: number }).max ?? 0),
        category,
      });
    }
  }
  return out;
}

function componentColumns(template: GradingTemplatePayload | null): Array<{ label: string; max: number; category: string; keys: string[] }> {
  if (!template?.academic_structure?.components) return [];
  const comps = template.academic_structure.components || [];
  return comps.map((c) => {
    const name = String(c.name || "").trim() || "Component";
    const items = c.items as Array<{ name: string; max_score?: number; max?: number }> | undefined;
    if (Array.isArray(items) && items.length > 0) {
      const keys = items.map((it) => String(it.name).trim()).filter(Boolean);
      const maxSum = items.reduce((acc, it) => acc + Number(it.max_score ?? it.max ?? 0), 0);
      return { label: name, max: maxSum, category: name, keys };
    }
    const max = Number((c as { max_score?: number }).max_score ?? (c as { max?: number }).max ?? (c.weight as number) ?? 0);
    return { label: name, max, category: name, keys: [name] };
  });
}

export function StudentReportCard({ tenantId, studentId, term, isLocked = false, schoolName }: StudentReportCardProps) {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/report?tenant_id=${encodeURIComponent(tenantId)}&student_id=${encodeURIComponent(studentId)}&term=${encodeURIComponent(term)}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as ReportResponse & { error?: string; success?: boolean };
        if (!res.ok) {
          throw new Error((json as { error?: string }).error || `Failed to load report (${res.status})`);
        }
        if (!cancelled) setData(json as ReportResponse);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId, studentId, term]);

  const student = data?.student ?? null;
  const template = data?.template ?? null;
  const grades = data?.grades ?? [];
  const behavioural = data?.behavioural ?? {};
  const summary = data?.summary ?? { totalScore: 0, average: 0, overallGrade: "F", overallRemark: "Fail", subjectsCount: 0 };
  const academicSession = data?.academic_session ?? "";

  const assessments = useMemo(() => parseAssessments(template), [template]);
  const compCols = useMemo(() => componentColumns(template), [template]);

  // Use component-grouped columns if template has 2-4 components with clear labels (e.g. CA, Exam)
  // Otherwise fallback to per-assessment columns
  const useGroupedColumns = compCols.length >= 1 && compCols.length <= 4 && compCols.every((c) => c.keys.length > 0);
  // For grouped mode, we need to compute per-subject subtotal per component (sum of its keys)
  // Keep for render; simple sum (not weighted) because backend total is weighted — for display raw we sum raw scores within group
  // If you want weighted, backend total already is weighted overall; grouped raw helps teachers see breakdown.

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-white/5 px-6 py-8 text-center text-sm text-purple-200 backdrop-blur print:hidden">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading report for {studentId} — {term}…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200 print:hidden">
        <span className="inline-flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </span>
      </div>
    );
  }

  // Student missing — graceful banner but still show admission number
  const showMissingStudent = !student;
  const displayName = student?.full_name ?? "— Unknown Student —";
  const displayClass = student?.class_name ?? "—";
  const displayGender = student?.gender ? student.gender.charAt(0).toUpperCase() + student.gender.slice(1).toLowerCase() : "—";

  return (
    <div className="relative mx-auto max-w-4xl">
      {/* Blurred content when locked */}
      <div className={isLocked ? "blur-[3px] select-none pointer-events-none opacity-60 print:blur-none print:opacity-100" : ""}>
        <div
          id="report-card"
          className="mx-auto max-w-4xl rounded-2xl bg-white p-8 text-slate-950 shadow-2xl md:p-12 print:rounded-none print:p-6 print:shadow-none print:border print:border-slate-300"
        >
          {/* Official School Branding & Header */}
          <div className="mb-6 text-center">
            {schoolName ? (
              <h1 className="font-serif text-2xl font-extrabold uppercase tracking-widest text-slate-900 md:text-3xl">{schoolName}</h1>
            ) : (
              <h1 className="font-serif text-2xl font-extrabold uppercase tracking-widest text-slate-900 md:text-3xl">{tenantId.toUpperCase()}</h1>
            )}
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Official Terminal Academic Report
            </p>
            {academicSession && (
              <span className="mt-3 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                Academic Session: {academicSession} • {term}
              </span>
            )}
            <div className="mx-auto mt-4 h-px w-24 bg-slate-200" />
          </div>

          {/* Bio-Data Grid */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 text-sm grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Full Name</p>
              <p className="mt-1 font-semibold text-slate-900">{displayName}</p>
              {student?.gender && <p className="text-xs text-slate-500">{displayGender}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admission No.</p>
              <p className="mt-1 font-mono font-semibold text-slate-900">{studentId}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Class</p>
              <p className="mt-1 font-semibold text-slate-900">{displayClass}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Term</p>
              <p className="mt-1 font-semibold text-slate-900">{term}</p>
              <p className="text-xs text-slate-500">{academicSession}</p>
            </div>
          </div>

          {showMissingStudent && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No student record found for admission number <span className="font-mono font-semibold">{studentId}</span> in <span className="font-semibold">{tenantId}</span>. Please check the admission number or contact the school admin. Showing blank report for lookup.
            </div>
          )}

          {/* Academic Performance Table */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">Academic Performance</h2>
            {grades.length === 0 ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                No academic records found for <span className="font-mono font-semibold">{studentId}</span> in {term}. {student ? "Scores have not been entered yet." : ""}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse border border-slate-300 text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
                      <th className="border border-slate-300 px-3 py-2">Subject</th>
                      {useGroupedColumns ? (
                        compCols.map((col) => (
                          <th key={col.label} className="border border-slate-300 px-3 py-2 text-center">
                            {col.label} <span className="font-normal normal-case text-slate-500">({col.max})</span>
                          </th>
                        ))
                      ) : assessments.length > 0 ? (
                        assessments.map((a) => (
                          <th key={a.key} className="border border-slate-300 px-3 py-2 text-center">
                            {a.key} <span className="font-normal normal-case text-slate-500">({a.max})</span>
                          </th>
                        ))
                      ) : (
                        <th className="border border-slate-300 px-3 py-2 text-center">Scores</th>
                      )}
                      <th className="border border-slate-300 bg-slate-900 px-3 py-2 text-center text-white">Total (100)</th>
                      <th className="border border-slate-300 px-3 py-2 text-center">Grade</th>
                      <th className="border border-slate-300 px-3 py-2">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grades.map((row) => (
                      <tr key={row.subject_name} className="even:bg-slate-50">
                        <td className="border border-slate-300 px-3 py-2 font-medium text-slate-900">{row.subject_name}</td>
                        {useGroupedColumns ? (
                          compCols.map((col) => {
                            // Sum raw scores for keys in this component
                            const sum = col.keys.reduce((acc, k) => {
                              const v = row.academic_scores[k];
                              return acc + (typeof v === "number" ? v : Number(v) || 0);
                            }, 0);
                            const hasAny = col.keys.some((k) => row.academic_scores[k] !== undefined);
                            return (
                              <td key={col.label} className="border border-slate-300 px-3 py-2 text-center">
                                {hasAny ? sum : "—"}
                              </td>
                            );
                          })
                        ) : assessments.length > 0 ? (
                          assessments.map((a) => (
                            <td key={a.key} className="border border-slate-300 px-3 py-2 text-center">
                              {row.academic_scores[a.key] !== undefined ? row.academic_scores[a.key] : "—"}
                            </td>
                          ))
                        ) : (
                          <td className="border border-slate-300 px-3 py-2 text-center font-mono text-xs">
                            {Object.keys(row.academic_scores).length ? JSON.stringify(row.academic_scores) : "—"}
                          </td>
                        )}
                        <td className="border border-slate-300 px-3 py-2 text-center font-bold text-slate-900">{Number(row.total).toFixed(0)}</td>
                        <td className="border border-slate-300 px-3 py-2 text-center font-bold">{row.grade || gradeFromTotal(Number(row.total))}</td>
                        <td className="border border-slate-300 px-3 py-2 text-xs">{row.remark || remarkFromGrade(row.grade || gradeFromTotal(Number(row.total)))}</td>
                      </tr>
                    ))}
                    {/* Summary row */}
                    <tr className="bg-slate-900 text-white">
                      <td className="border border-slate-300 px-3 py-2 font-bold" colSpan={1}>
                        Summary
                      </td>
                      <td
                        className="border border-slate-300 px-3 py-2 text-center font-semibold"
                        colSpan={useGroupedColumns ? compCols.length : assessments.length > 0 ? assessments.length : 1}
                      >
                        {summary.subjectsCount} Subject{summary.subjectsCount !== 1 ? "s" : ""}
                      </td>
                      <td className="border border-slate-300 px-3 py-2 text-center font-bold">
                        {summary.totalScore.toFixed(0)}
                      </td>
                      <td className="border border-slate-300 px-3 py-2 text-center font-bold">{summary.overallGrade}</td>
                      <td className="border border-slate-300 px-3 py-2 text-xs font-medium">
                        Avg {summary.average.toFixed(1)} • {summary.overallRemark}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">
                  Grading: 70+=A (Excellent), 60–69=B (Very Good), 50–59=C (Good), 45–49=D (Pass), 40–44=E (Pass), &lt;40=F (Fail) • Total out of 100 • Overall Grade from Average
                </p>
              </div>
            )}
          </div>

          {/* Behavioural Domain & Official Signatures — two-column split */}
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {/* Left: Affective & Psychomotor Traits */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800">Affective &amp; Psychomotor Traits</h3>
              {Object.keys(behavioural).length === 0 ? (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  No behavioural ratings recorded for {term}.
                </p>
              ) : (
                <div className="mt-3 overflow-hidden rounded-lg border border-slate-300">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
                        <th className="border-b border-slate-300 px-3 py-2">Trait</th>
                        <th className="border-b border-slate-300 px-3 py-2 text-center">Grade (A–E)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(behavioural).map(([trait, grade]) => (
                        <tr key={trait} className="even:bg-slate-50">
                          <td className="border-t border-slate-200 px-3 py-2 font-medium text-slate-900">{trait}</td>
                          <td className="border-t border-slate-200 px-3 py-2 text-center font-bold tracking-widest text-slate-900">{String(grade).toUpperCase()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">Scale: A=Excellent, B=Very Good, C=Good, D=Fair, E=Needs Improvement</p>
                </div>
              )}
            </div>

            {/* Right: Official Remarks & Signatures */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800">Official Remarks &amp; Signatures</h3>
              <div className="mt-3 space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Form Teacher&apos;s Remark</p>
                  <div className="mt-2 min-h-[48px] rounded border border-dashed border-slate-300 bg-white p-2 text-sm text-slate-400">
                    {/* Leave blank for handwritten remark */}
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-4">
                    <div className="flex-1">
                      <div className="h-8 border-b border-slate-400" />
                      <p className="mt-1 text-xs font-medium text-slate-700">Class Teacher&apos;s Signature</p>
                    </div>
                    <div className="w-28">
                      <div className="h-8 border-b border-slate-400" />
                      <p className="mt-1 text-xs text-slate-500">Date</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Principal&apos;s Remark</p>
                  <div className="mt-2 min-h-[48px] rounded border border-dashed border-slate-300 bg-white p-2 text-sm text-slate-400" />
                  <div className="mt-3 flex items-end justify-between gap-4">
                    <div className="flex-1">
                      <div className="h-8 border-b border-slate-400" />
                      <p className="mt-1 text-xs font-medium text-slate-700">Principal&apos;s Signature</p>
                    </div>
                    <div className="w-28">
                      <div className="h-8 border-b border-slate-400" />
                      <p className="mt-1 text-xs text-slate-500">Date</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer meta */}
          <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500">
            <span className="font-mono">
              {tenantId} • {studentId} • {term} • {academicSession}
            </span>
            <span>ResultApp • Secure Terminal Report</span>
          </div>
        </div>
      </div>

      {/* Locked overlay — print hidden */}
      {isLocked && (
        <div className="absolute inset-0 flex items-center justify-center p-4 print:hidden">
          <div className="w-full max-w-sm rounded-2xl border border-red-500/50 bg-zinc-900 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/30">
              <Lock className="h-6 w-6 text-red-400" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">Subscription Payment Required</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Report card generation is locked. Upgrade your subscription to print and download official report sheets for {term}.
            </p>
            <Button
              onClick={() => (window.location.href = `/${tenantId}/admin/billing`)}
              className="mt-5 w-full gap-2 rounded-full bg-red-600 font-semibold text-white hover:bg-red-500"
              size="lg"
            >
              <CreditCard className="h-4 w-4" /> Upgrade to Print
            </Button>
            <p className="mt-3 text-xs text-zinc-500">Need help? contact@resultapp.org</p>
          </div>
        </div>
      )}

      {/* Print-first CSS Optimization */}
      <style>{`
        @media print {
          html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { size: A4; margin: 10mm; }
          .print\\:hidden { display: none !important; }
          #report-card { box-shadow: none !important; border: 1px solid #cbd5e1 !important; }
        }
      `}</style>
    </div>
  );
}
