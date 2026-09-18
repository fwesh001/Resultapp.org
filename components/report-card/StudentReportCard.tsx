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
  breakdown: Record<string, number | null>;
  total: number;
  grade: string;
  remark: string;
  classAverage?: number | null;
  subjectPosition?: number | null;
  subjectPositionOrdinal?: string | null;
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
    noInClass?: number;
    overallPosition?: number | null;
    overallPositionOrdinal?: string | null;
  };
  term: string;
  academic_session: string;
  tenant_id: string;
  student_id: string;
  attendance?: { present: number | null; outOf: number | null };
  termMeta?: { termEnding: string | null; newTermBegins: string | null };
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

function formatDash(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
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
  const grades = data?.grades ?? [];
  const behavioural = data?.behavioural ?? {};
  const summary = data?.summary ?? {
    totalScore: 0,
    average: 0,
    overallGrade: "F",
    overallRemark: "Fail",
    subjectsCount: 0,
    noInClass: 0,
    overallPosition: null,
    overallPositionOrdinal: null,
  };
  const academicSession = data?.academic_session ?? "";
  const attendance = data?.attendance ?? { present: null, outOf: null };
  const termMeta = data?.termMeta ?? { termEnding: null, newTermBegins: null };

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

  const showMissingStudent = !student;
  const displayName = student?.full_name ?? "— Unknown Student —";
  const displayClass = student?.class_name ?? "—";
  const displayGender = student?.gender ? student.gender.charAt(0).toUpperCase() + student.gender.slice(1).toLowerCase() : "—";
  const noInClass = summary.noInClass ?? 0;
  const overallPos = summary.overallPositionOrdinal ?? (summary.overallPosition ? `${summary.overallPosition}` : "—");
  const attendanceText =
    attendance.present !== null && attendance.outOf !== null
      ? `${attendance.present} / ${attendance.outOf}`
      : attendance.present !== null
        ? `${attendance.present}`
        : "—";
  const termEnding = termMeta.termEnding ?? "—";
  const newTermBegins = termMeta.newTermBegins ?? "—";

  return (
    <div className="relative mx-auto max-w-4xl">
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
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Official Terminal Academic Report</p>
            {academicSession && (
              <span className="mt-3 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                Academic Session: {academicSession} • {term}
              </span>
            )}
            <div className="mx-auto mt-4 h-px w-24 bg-slate-200" />
          </div>

          {/* Bio-Data Header Upgrade — professional standard */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 text-sm grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="col-span-2 md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Full Name</p>
              <p className="mt-1 font-semibold text-slate-900">{displayName}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sex / Gender</p>
              <p className="mt-1 font-semibold text-slate-900">{displayGender}</p>
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
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">No. in Class</p>
              <p className="mt-1 font-semibold text-slate-900">{noInClass ? String(noInClass) : "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Position</p>
              <p className="mt-1 font-semibold text-slate-900">{overallPos !== "—" && noInClass ? `${overallPos} of ${noInClass}` : "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance</p>
              <p className="mt-1 font-semibold text-slate-900">{attendanceText}</p>
              <p className="text-xs text-slate-500">Present / Out of</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Term Ending</p>
              <p className="mt-1 font-semibold text-slate-900">{formatDash(termEnding)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New Term Begins</p>
              <p className="mt-1 font-semibold text-slate-900">{formatDash(newTermBegins)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session</p>
              <p className="mt-1 font-semibold text-slate-900">{academicSession || "—"}</p>
            </div>
          </div>

          {showMissingStudent && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No student record found for admission number <span className="font-mono font-semibold">{studentId}</span> in <span className="font-semibold">{tenantId}</span>. Please check the admission number or contact the school admin. Showing blank report for lookup.
            </div>
          )}

          {/* Granular Academic Records Table — traditional columns */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">Academic Records</h2>
            {grades.length === 0 ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                No academic records found for <span className="font-mono font-semibold">{studentId}</span> in {term}. {student ? "Scores have not been entered yet." : ""}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse border border-slate-300 text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
                      <th className="border border-slate-300 px-2 py-2">SUBJECT</th>
                      <th className="border border-slate-300 px-2 py-2 text-center">A1</th>
                      <th className="border border-slate-300 px-2 py-2 text-center">A2</th>
                      <th className="border border-slate-300 px-2 py-2 text-center">T1</th>
                      <th className="border border-slate-300 px-2 py-2 text-center">T2</th>
                      <th className="border border-slate-300 px-2 py-2 text-center">EXAM</th>
                      <th className="border border-slate-300 bg-slate-900 px-2 py-2 text-center text-white">TOTAL (100)</th>
                      <th className="border border-slate-300 px-2 py-2 text-center">CLASS AVERAGE</th>
                      <th className="border border-slate-300 px-2 py-2 text-center">POSITION</th>
                      <th className="border border-slate-300 px-2 py-2">REMARKS</th>
                      <th className="border border-slate-300 px-2 py-2 text-center">SIGN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grades.map((row) => {
                      const bd = row.breakdown || {};
                      const a1 = bd.A1 ?? row.academic_scores["A1"] ?? row.academic_scores["A 1"] ?? row.academic_scores["Assignment 1"];
                      const a2 = bd.A2 ?? row.academic_scores["A2"] ?? row.academic_scores["Assignment 2"];
                      const t1 = bd.T1 ?? row.academic_scores["T1"] ?? row.academic_scores["Test 1"];
                      const t2 = bd.T2 ?? row.academic_scores["T2"] ?? row.academic_scores["Test 2"];
                      const exam = bd.Exam ?? row.academic_scores["Exam"] ?? row.academic_scores["EXAM"];
                      const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
                      return (
                        <tr key={row.subject_name} className="even:bg-slate-50">
                          <td className="border border-slate-300 px-2 py-2 font-medium text-slate-900">{row.subject_name}</td>
                          <td className="border border-slate-300 px-2 py-2 text-center">{fmt(a1)}</td>
                          <td className="border border-slate-300 px-2 py-2 text-center">{fmt(a2)}</td>
                          <td className="border border-slate-300 px-2 py-2 text-center">{fmt(t1)}</td>
                          <td className="border border-slate-300 px-2 py-2 text-center">{fmt(t2)}</td>
                          <td className="border border-slate-300 px-2 py-2 text-center">{fmt(exam)}</td>
                          <td className="border border-slate-300 px-2 py-2 text-center font-bold text-slate-900">{Number(row.total).toFixed(0)}</td>
                          <td className="border border-slate-300 px-2 py-2 text-center">
                            {row.classAverage !== null && row.classAverage !== undefined ? Number(row.classAverage).toFixed(1) : "—"}
                          </td>
                          <td className="border border-slate-300 px-2 py-2 text-center font-bold">
                            {row.subjectPositionOrdinal ?? (row.subjectPosition ? String(row.subjectPosition) : "—")}
                          </td>
                          <td className="border border-slate-300 px-2 py-2 text-xs">{row.remark || remarkFromGrade(row.grade || gradeFromTotal(Number(row.total)))}</td>
                          <td className="border border-slate-300 px-2 py-2 text-center text-xs text-slate-400">—</td>
                        </tr>
                      );
                    })}
                    {/* Footer summary rows */}
                    <tr className="bg-slate-50 font-bold">
                      <td className="border border-slate-300 px-2 py-2 text-right" colSpan={6}>
                        TOTAL:
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-bold text-slate-900">{summary.totalScore.toFixed(0)}</td>
                      <td className="border border-slate-300 px-2 py-2 text-center" colSpan={4}>
                        {summary.subjectsCount} Subjects
                      </td>
                    </tr>
                    <tr className="bg-slate-900 text-white font-bold">
                      <td className="border border-slate-300 px-2 py-2 text-right" colSpan={6}>
                        AVERAGE:
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center">{summary.average.toFixed(1)}</td>
                      <td className="border border-slate-300 px-2 py-2 text-center" colSpan={2}>
                        {summary.overallGrade} — {summary.overallRemark}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center text-xs font-normal opacity-80" colSpan={2}>
                        {summary.overallPositionOrdinal ? `${summary.overallPositionOrdinal} of ${summary.noInClass ?? "—"}` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">
                  Grading: 70+=A (Excellent), 60–69=B (Very Good), 50–59=C (Good), 45–49=D (Pass), 40–44=E (Pass), &lt;40=F (Fail) • Total = A1+A2+T1+T2+Exam (100) • Class Average = Mean • Position = Standard Competition Ranking (1,2,2,4)
                </p>
              </div>
            )}
          </div>

          {/* Affective Domain & Official Signatures — two-column split */}
          <div className="mt-8 grid gap-6 md:grid-cols-2">
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
                  <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <p className="font-semibold text-slate-700">Rating Key:</p>
                    <p className="text-slate-500">A=Excellent • B=Very Good • C=Good • D=Fair • E=Needs Improvement</p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800">Official Remarks &amp; Signatures</h3>
              <div className="mt-3 space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Class Teacher / Master&apos;s Remarks</p>
                  <div className="mt-2 min-h-[48px] rounded border border-dashed border-slate-300 bg-white p-2 text-sm text-slate-400" />
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Principal&apos;s Remarks</p>
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

          <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500">
            <span className="font-mono">
              {tenantId} • {studentId} • {term} • {academicSession}
            </span>
            <span>ResultApp • Secure Terminal Report</span>
          </div>
        </div>
      </div>

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

      <style>{`
        @media print {
          html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { size: A4; margin: 10mm; }
          .print\\:hidden { display: none !important; }
          #report-card { box-shadow: none !important; border: 1px solid #cbd5e1 !important; }
          table { border-collapse: collapse !important; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
