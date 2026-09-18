"use client";

import * as React from "react";
import { useEffect, useState } from "react";
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

interface GroupedItem {
  key: string;
  originalName: string;
  max: number;
  weightPct: number;
}

interface GroupedGroup {
  label: string;
  keys: string[];
  items: GroupedItem[];
  maxSum: number;
  weightSum: number;
}

interface GroupedTemplate {
  groups: GroupedGroup[];
  totalMax: number;
  totalWeight: number;
}

interface ReportResponse {
  student: ReportStudent | null;
  template: GradingTemplatePayload | null;
  groupedTemplate?: GroupedTemplate | null;
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
  school?: { school_name?: string | null; address?: string | null; new_term_begins?: string | null } | null;
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

function formatTermDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  // Try ISO YYYY-MM-DD or YYYY/MM/DD
  const d = new Date(s);
  if (!isNaN(d.getTime()) && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) {
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mon = months[d.getMonth()] ?? "";
    const year = d.getFullYear();
    return `${day} ${mon} ${year}`;
  }
  // If already formatted like 09 Jan 2026 keep as is
  if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(s)) return s;
  return s;
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
  const schoolFromReport = data?.school ?? null;
  // Prefer report school address, else fallback to prop schoolName's tenant address via page wrapper? For now use report
  const schoolAddress = (schoolFromReport?.address ?? "").trim() || "";
  const rawResumption = (schoolFromReport?.new_term_begins ?? data?.termMeta?.newTermBegins ?? null) as string | null;
  const newTermBeginsDisplay = rawResumption ? formatTermDate(rawResumption) : "—";

  const groupedTemplate = (data as ReportResponse)?.groupedTemplate ?? null;
  const hasGrouped = !!(groupedTemplate && groupedTemplate.groups && groupedTemplate.groups.length > 0);
  const flatGroupedItems: GroupedItem[] = hasGrouped ? groupedTemplate!.groups.flatMap((g) => g.items) : [];
  const totalSubCols = hasGrouped ? flatGroupedItems.length : 5;

  function formatGroupedHeader(item: GroupedItem): string {
    const maxStr = Number(item.max).toFixed(0).replace(/\.0$/, "");
    const pctStr = Number(item.weightPct).toFixed(1).replace(/\.0$/, "");
    // Show both compactly as A1 (10 • 10%) per spec, fallback to single if redundant
    if (item.max > 0 && item.weightPct > 0) {
      // If max string equals pct string and you want compact, still show both per spec
      return `${item.key} (${maxStr} • ${pctStr}%)`;
    }
    if (item.max > 0) return `${item.key} (${maxStr})`;
    if (item.weightPct > 0) return `${item.key} (${pctStr}%)`;
    return item.key;
  }

  function getScoreForGroupedItem(row: GradeRow, item: GroupedItem): unknown {
    const bd = row.breakdown || {};
    // Try canonical key first, then originalName, then direct academic_scores lookups
    if (bd[item.key] !== undefined && bd[item.key] !== null) return bd[item.key];
    if (item.originalName && row.academic_scores[item.originalName] !== undefined) return row.academic_scores[item.originalName];
    if (row.academic_scores[item.key] !== undefined) return row.academic_scores[item.key];
    // Fallback case-insensitive search
    const lowKey = item.key.toLowerCase();
    for (const [k, v] of Object.entries(row.academic_scores)) {
      if (k.toLowerCase() === lowKey) return v;
      if (item.originalName && k.toLowerCase() === item.originalName.toLowerCase()) return v;
    }
    // Also try breakdown alias fallback
    const canon = item.key;
    if (bd[canon] !== undefined) return bd[canon];
    return undefined;
  }

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

  return (
    <div className="relative mx-auto max-w-4xl">
      <div className={isLocked ? "blur-[3px] select-none pointer-events-none opacity-60 print:blur-none print:opacity-100" : ""}>
        <div
          id="report-card"
          className="mx-auto max-w-4xl rounded-2xl bg-white p-4 md:p-6 text-slate-950 shadow-2xl print:rounded-none print:p-0 print:shadow-none print:border-none"
        >
          {/* Official School Branding & Header — traditional */}
          <div className="mb-3 text-center">
            {schoolName ? (
              <h1 className="font-serif text-xl font-extrabold uppercase tracking-widest text-slate-900 md:text-2xl">{schoolName}</h1>
            ) : (
              <h1 className="font-serif text-xl font-extrabold uppercase tracking-widest text-slate-900 md:text-2xl">{tenantId.toUpperCase()}</h1>
            )}
            {schoolAddress ? (
              <p className="mt-1 text-[11px] font-medium tracking-wide text-slate-600">{schoolAddress}</p>
            ) : null}
            <div className="mx-auto mt-2 h-px w-20 bg-slate-200" />
          </div>

          {/* Top-Center Student Name — uppercase bold, centered, allow wrap */}
          <div className="mb-3 text-center">
            <p className="font-bold uppercase tracking-wide text-slate-900 text-sm md:text-base leading-tight break-words">{displayName.toUpperCase()}</p>
          </div>

          {/* Redesigned Two-Row Bio-Data Grid — compact */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 mb-3 text-xs grid grid-cols-3 gap-2">
            {/* First Row: CLASS | ADMISSION NO. | SEX */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-none">Class</p>
              <p className="mt-0.5 font-semibold text-slate-900 leading-tight truncate">{displayClass}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-none">Admission No.</p>
              <p className="mt-0.5 font-mono font-semibold text-slate-900 leading-tight truncate">{studentId}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-none">Sex</p>
              <p className="mt-0.5 font-semibold text-slate-900 leading-tight">{displayGender}</p>
            </div>
            {/* Second Row: NO. IN CLASS | POSITION | NEW TERM BEGINS */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-none">No. in Class</p>
              <p className="mt-0.5 font-semibold text-slate-900 leading-tight">{noInClass ? String(noInClass) : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-none">Position</p>
              <p className="mt-0.5 font-semibold text-slate-900 leading-tight">{overallPos !== "—" && noInClass ? `${overallPos} of ${noInClass}` : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-none">New Term Begins</p>
              <p className="mt-0.5 font-semibold text-slate-900 leading-tight">{newTermBeginsDisplay}</p>
            </div>
          </div>

          {showMissingStudent && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No student record found for admission number <span className="font-mono font-semibold">{studentId}</span> in <span className="font-semibold">{tenantId}</span>. Please check the admission number or contact the school admin.
            </div>
          )}

          {/* Tightened Academic Records Table */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-800">Academic Records</h2>
            {grades.length === 0 ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No academic records found for <span className="font-mono font-semibold">{studentId}</span> in {term}. {student ? "Scores have not been entered yet." : ""}
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse border border-slate-300 text-xs">
                  <thead>
                    {hasGrouped ? (
                      <>
                        <tr className="bg-slate-100 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                          <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle">
                            SUBJECT
                          </th>
                          {groupedTemplate!.groups.map((g) => (
                            <th
                              key={g.label}
                              colSpan={g.items.length}
                              className="border border-slate-300 px-2 py-1 text-center align-middle"
                            >
                              {g.label}
                            </th>
                          ))}
                          <th rowSpan={2} className="border border-slate-300 bg-slate-900 px-2 py-1 text-center text-white align-middle">
                            TOTAL (100)
                          </th>
                          <th rowSpan={2} className="border border-slate-300 px-2 py-1 text-center align-middle">
                            CLASS AVERAGE
                          </th>
                          <th rowSpan={2} className="border border-slate-300 px-2 py-1 text-center align-middle">
                            POSITION
                          </th>
                          <th rowSpan={2} className="border border-slate-300 px-2 py-1 align-middle">
                            REMARKS
                          </th>
                          <th rowSpan={2} className="border border-slate-300 px-2 py-1 text-center align-middle">
                            SIGN
                          </th>
                        </tr>
                        <tr className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                          {flatGroupedItems.map((it) => (
                            <th key={`${it.key}-${it.originalName}`} className="border border-slate-300 px-1 py-1 text-center whitespace-nowrap">
                              {formatGroupedHeader(it)}
                            </th>
                          ))}
                        </tr>
                      </>
                    ) : (
                      <tr className="bg-slate-100 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                        <th className="border border-slate-300 px-2 py-1">SUBJECT</th>
                        <th className="border border-slate-300 px-2 py-1 text-center">A1</th>
                        <th className="border border-slate-300 px-2 py-1 text-center">A2</th>
                        <th className="border border-slate-300 px-2 py-1 text-center">T1</th>
                        <th className="border border-slate-300 px-2 py-1 text-center">T2</th>
                        <th className="border border-slate-300 px-2 py-1 text-center">EXAM</th>
                        <th className="border border-slate-300 bg-slate-900 px-2 py-1 text-center text-white">TOTAL (100)</th>
                        <th className="border border-slate-300 px-2 py-1 text-center">CLASS AVERAGE</th>
                        <th className="border border-slate-300 px-2 py-1 text-center">POSITION</th>
                        <th className="border border-slate-300 px-2 py-1">REMARKS</th>
                        <th className="border border-slate-300 px-2 py-1 text-center">SIGN</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {grades.map((row) => {
                      const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
                      return (
                        <tr key={row.subject_name} className="even:bg-slate-50">
                          <td className="border border-slate-300 px-2 py-1 font-medium text-slate-900">{row.subject_name}</td>
                          {hasGrouped ? (
                            flatGroupedItems.map((it) => {
                              const v = getScoreForGroupedItem(row, it);
                              return (
                                <td key={`${row.subject_name}-${it.key}-${it.originalName}`} className="border border-slate-300 px-2 py-1 text-center">
                                  {fmt(v)}
                                </td>
                              );
                            })
                          ) : (
                            <>
                              {(() => {
                                const bd = row.breakdown || {};
                                const a1 = bd.A1 ?? row.academic_scores["A1"] ?? row.academic_scores["A 1"] ?? row.academic_scores["Assignment 1"];
                                const a2 = bd.A2 ?? row.academic_scores["A2"] ?? row.academic_scores["Assignment 2"];
                                const t1 = bd.T1 ?? row.academic_scores["T1"] ?? row.academic_scores["Test 1"];
                                const t2 = bd.T2 ?? row.academic_scores["T2"] ?? row.academic_scores["Test 2"];
                                const exam = bd.Exam ?? row.academic_scores["Exam"] ?? row.academic_scores["EXAM"];
                                return (
                                  <>
                                    <td className="border border-slate-300 px-2 py-1 text-center">{fmt(a1)}</td>
                                    <td className="border border-slate-300 px-2 py-1 text-center">{fmt(a2)}</td>
                                    <td className="border border-slate-300 px-2 py-1 text-center">{fmt(t1)}</td>
                                    <td className="border border-slate-300 px-2 py-1 text-center">{fmt(t2)}</td>
                                    <td className="border border-slate-300 px-2 py-1 text-center">{fmt(exam)}</td>
                                  </>
                                );
                              })()}
                            </>
                          )}
                          <td className="border border-slate-300 px-2 py-1 text-center font-bold text-slate-900">{Number(row.total).toFixed(0)}</td>
                          <td className="border border-slate-300 px-2 py-1 text-center">
                            {row.classAverage !== null && row.classAverage !== undefined ? Number(row.classAverage).toFixed(1) : "—"}
                          </td>
                          <td className="border border-slate-300 px-2 py-1 text-center font-bold">
                            {row.subjectPositionOrdinal ?? (row.subjectPosition ? String(row.subjectPosition) : "—")}
                          </td>
                          <td className="border border-slate-300 px-2 py-1 text-[11px]">{row.remark || remarkFromGrade(row.grade || gradeFromTotal(Number(row.total)))}</td>
                          <td className="border border-slate-300 px-2 py-1 text-center text-[11px] text-slate-400">—</td>
                        </tr>
                      );
                    })}
                    {/* Footer summary rows — tight, colSpan dynamic */}
                    <tr className="bg-slate-50 font-bold text-xs">
                      <td className="border border-slate-300 px-2 py-1 text-right" colSpan={hasGrouped ? 1 + totalSubCols : 6}>
                        TOTAL:
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-center font-bold text-slate-900">{summary.totalScore.toFixed(0)}</td>
                      <td className="border border-slate-300 px-2 py-1 text-center text-[11px]" colSpan={4}>
                        {summary.subjectsCount} Subjects
                      </td>
                    </tr>
                    <tr className="bg-slate-900 text-white text-xs font-bold">
                      <td className="border border-slate-300 px-2 py-1 text-right" colSpan={hasGrouped ? 1 + totalSubCols : 6}>
                        AVERAGE:
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-center">{summary.average.toFixed(1)}</td>
                      <td className="border border-slate-300 px-2 py-1 text-center text-[11px]" colSpan={2}>
                        {summary.overallGrade} — {summary.overallRemark}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-center text-[11px] font-normal opacity-80" colSpan={2}>
                        {summary.overallPositionOrdinal ? `${summary.overallPositionOrdinal} of ${summary.noInClass ?? "—"}` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] leading-tight text-slate-500">
                  Grading: 70+=A (Excellent), 60–69=B (Very Good), 50–59=C (Good), 45–49=D (Pass), 40–44=E (Pass), &lt;40=F (Fail) • Total = A1+A2+T1+T2+Exam (100) • Class Average = Mean • Position = Standard Competition Ranking (1,2,2,4)
                </p>
              </div>
            )}
          </div>

          {/* Compact Affective & Psychomotor Traits — 3-column grid */}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-800">Affective &amp; Psychomotor Traits</h3>
              {Object.keys(behavioural).length === 0 ? (
                <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600">
                  No behavioural ratings recorded for {term}.
                </p>
              ) : (
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-300">
                  <div className="grid grid-cols-3 gap-px bg-slate-300">
                    {Object.entries(behavioural).map(([trait, grade]) => (
                      <div key={trait} className="flex items-center justify-between bg-white px-2 py-1 text-xs">
                        <span className="truncate font-medium text-slate-900">{trait}</span>
                        <span className="ml-2 font-bold tracking-widest text-slate-900">{String(grade).toUpperCase()}</span>
                      </div>
                    ))}
                  </div>
                  <p className="bg-slate-50 px-2 py-1 text-[10px] leading-tight text-slate-500">Key: A=Excellent • B=Very Good • C=Good • D=Fair • E=Needs Improvement</p>
                </div>
              )}
            </div>

            {/* Side-by-Side Signatures & Remarks — compact 2-column horizontal */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-800">Official Remarks &amp; Signatures</h3>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-none">Class Teacher / Master&apos;s Remarks</p>
                  <div className="mt-1.5 min-h-[36px] rounded border border-dashed border-slate-300 bg-white p-1.5 text-xs text-slate-400" />
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div className="flex-1">
                      <div className="h-6 border-b border-slate-400" />
                      <p className="mt-0.5 text-[10px] font-medium leading-none text-slate-700">Class Teacher&apos;s Signature</p>
                    </div>
                    <div className="w-20">
                      <div className="h-6 border-b border-slate-400" />
                      <p className="mt-0.5 text-[10px] leading-none text-slate-500">Date</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-none">Principal&apos;s Remarks</p>
                  <div className="mt-1.5 min-h-[36px] rounded border border-dashed border-slate-300 bg-white p-1.5 text-xs text-slate-400" />
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div className="flex-1">
                      <div className="h-6 border-b border-slate-400" />
                      <p className="mt-0.5 text-[10px] font-medium leading-none text-slate-700">Principal&apos;s Signature</p>
                    </div>
                    <div className="w-20">
                      <div className="h-6 border-b border-slate-400" />
                      <p className="mt-0.5 text-[10px] leading-none text-slate-500">Date</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center border-t border-slate-200 pt-2 text-[11px] font-medium text-slate-600">
            <a
              href="https://resultapp.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-800 hover:underline print:text-slate-600 print:no-underline"
            >
              Powered by ResultApp.org
            </a>
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
          @page { size: A4 portrait; margin: 5mm; }
          .print\\:hidden { display: none !important; }
          #report-card { box-shadow: none !important; border: none !important; padding: 0 !important; }
          tr { break-inside: avoid; }
        }
        @media print {
          body { zoom: 88%; }
        }
        @supports (-moz-appearance: none) {
          @media print {
            html { transform: scale(0.88); transform-origin: top center; }
            body { zoom: 1; }
          }
        }
      `}</style>
    </div>
  );
}
