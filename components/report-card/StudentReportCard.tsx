"use client";

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import { Loader2, AlertCircle, Printer, GraduationCap, Lock, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/Button";

// ---------------------------------------------------------------------------
// Types matching backend schemas
// ---------------------------------------------------------------------------

interface AcademicRecord {
  id: number;
  tenant_id: string;
  student_id: string;
  subject: string;
  term: string;
  template_id: number;
  scores: Record<string, number>;
  total_score: number | null;
  created_at: string;
}

interface BehavioralRecord {
  id: number;
  tenant_id: string;
  student_id: string;
  term: string;
  template_id: number;
  ratings: Record<string, string>;
  created_at: string;
}

interface StudentReportCardProps {
  tenantId: string;
  studentId: string;
  term: string;
  isLocked?: boolean;
}

// ---------------------------------------------------------------------------
// Grade helpers — hardcode Nigerian standard (70=A ... <40=F) per decision 1
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StudentReportCard({ tenantId, studentId, term, isLocked = false }: StudentReportCardProps) {
  const [academic, setAcademic] = useState<AcademicRecord[]>([]);
  const [behavioral, setBehavioral] = useState<BehavioralRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/records?tenant_id=${encodeURIComponent(tenantId)}&student_id=${encodeURIComponent(studentId)}&term=${encodeURIComponent(term)}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data as { error?: string })?.error || `Failed to load records (${res.status})`);
        }
        if (!cancelled) {
          setAcademic(Array.isArray((data as { academic?: unknown }).academic) ? (data as { academic: AcademicRecord[] }).academic : []);
          setBehavioral(Array.isArray((data as { behavioral?: unknown }).behavioral) ? (data as { behavioral: BehavioralRecord[] }).behavioral : []);
        }
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

  // Dynamic assessment keys — union of all score keys across subjects
  const assessmentKeys = useMemo(() => {
    const set = new Set<string>();
    academic.forEach((r) => Object.keys(r.scores || {}).forEach((k) => set.add(k)));
    return Array.from(set);
  }, [academic]);

  // Behavioral traits — union of all rating keys for this term
  const behavioralTraits = useMemo(() => {
    const set = new Set<string>();
    behavioral.forEach((r) => Object.keys(r.ratings || {}).forEach((k) => set.add(k)));
    return Array.from(set);
  }, [behavioral]);

  // For behavioral, we expect one record per term; take first if multiple
  const primaryBehavioral = behavioral[0] || null;
  const grades = ["A", "B", "C", "D", "E"] as const;

  // Print handler
  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500 print:hidden">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading report for {studentId} — {term}…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600 print:hidden">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Action bar — hidden on print AND when locked per Phase 3 spec */}
      {!isLocked && (
        <div className="flex justify-end print:hidden">
          <Button onClick={handlePrint} className="gap-2 rounded-full bg-zinc-900 text-white hover:bg-zinc-800">
            <Printer className="h-4 w-4" /> Print Report Card
          </Button>
        </div>
      )}

      {/* Report sheet wrapper — relative so overlay can be absolute */}
      <div className="relative">
        {/* Blurred content when locked — spec: blur-md select-none pointer-events-none opacity-60 */}
        <div
          className={
            isLocked
              ? "blur-md select-none pointer-events-none opacity-60"
              : ""
          }
        >
          <div
            id="report-card"
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm print:rounded-none print:border-black print:shadow-none"
          >
        {/* Header — mimics VHS_01.jpg STUDENT'S REPORT SHEET */}
        <div className="border-b border-zinc-200 bg-zinc-50 px-6 py-5 text-center print:bg-white print:border-black">
          <div className="flex items-center justify-center gap-3">
            <span className="hidden h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-white print:flex print:border print:border-black print:bg-white print:text-black">
              <GraduationCap className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-base font-bold uppercase tracking-widest text-zinc-900">Student&apos;s Report Sheet</h1>
              <p className="mt-1 font-mono text-xs font-medium uppercase tracking-wide text-zinc-500">
                {tenantId} • resultapp.org
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-left text-xs sm:grid-cols-3">
            <div className="rounded border border-zinc-200 bg-white px-3 py-2 print:border-zinc-400">
              <span className="font-semibold text-zinc-700">Student ID:</span>{" "}
              <span className="font-mono font-medium text-zinc-900">{studentId}</span>
            </div>
            <div className="rounded border border-zinc-200 bg-white px-3 py-2 print:border-zinc-400">
              <span className="font-semibold text-zinc-700">Term:</span>{" "}
              <span className="font-medium text-zinc-900">{term}</span>
            </div>
            <div className="rounded border border-zinc-200 bg-white px-3 py-2 print:border-zinc-400">
              <span className="font-semibold text-zinc-700">Tenant:</span>{" "}
              <span className="font-mono font-medium text-zinc-900">{tenantId}</span>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-4 sm:p-6 print:p-6">
          {/* Academic Records Table */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-800">Academic Records</h2>
            {academic.length === 0 ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:border-black">
                No academic records found for <span className="font-mono font-semibold">{studentId}</span> in {term}.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse border border-zinc-300 text-sm print:border-black">
                  <thead>
                    <tr className="bg-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-700 print:bg-white print:border-black">
                      <th className="border border-zinc-300 px-3 py-2 print:border-black">Subject</th>
                      {assessmentKeys.map((k) => (
                        <th key={k} className="border border-zinc-300 px-3 py-2 text-center print:border-black">
                          {k}
                        </th>
                      ))}
                      <th className="border border-zinc-300 bg-zinc-900 px-3 py-2 text-center text-white print:bg-white print:text-black print:border-black">
                        Total
                      </th>
                      <th className="border border-zinc-300 px-3 py-2 text-center print:border-black">Grade</th>
                      <th className="border border-zinc-300 px-3 py-2 print:border-black">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {academic.map((r) => {
                      const total = r.total_score ?? 0;
                      const grade = gradeFromTotal(total);
                      return (
                        <tr key={`${r.subject}-${r.id}`} className="even:bg-zinc-50 print:even:bg-white">
                          <td className="border border-zinc-300 px-3 py-2 font-medium text-zinc-900 print:border-black">
                            {r.subject}
                          </td>
                          {assessmentKeys.map((k) => (
                            <td key={k} className="border border-zinc-300 px-3 py-2 text-center print:border-black">
                              {r.scores[k] !== undefined ? r.scores[k] : "—"}
                            </td>
                          ))}
                          <td className="border border-zinc-300 px-3 py-2 text-center font-bold text-zinc-900 print:border-black">
                            {total.toFixed(0)}
                          </td>
                          <td className="border border-zinc-300 px-3 py-2 text-center font-bold print:border-black">{grade}</td>
                          <td className="border border-zinc-300 px-3 py-2 text-xs print:border-black">{remarkFromGrade(grade)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-zinc-500 print:text-zinc-700">
                  Grading: 70+=A (Excellent), 60-69=B (Very Good), 50-59=C (Good), 45-49=D (Pass), 40-44=E (Pass), &lt;40=F (Fail)
                </p>
              </div>
            )}
          </div>

          {/* Behavioral and Activities Table */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-800">Behavioral and Activities</h2>
            {behavioral.length === 0 ? (
              <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 print:border-black">
                No behavioral ratings recorded for {term}.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse border border-zinc-300 text-sm print:border-black">
                  <thead>
                    <tr className="bg-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-700 print:bg-white">
                      <th className="border border-zinc-300 px-3 py-2 print:border-black">Trait</th>
                      {grades.map((g) => (
                        <th key={g} className="border border-zinc-300 px-3 py-2 text-center print:border-black">
                          {g}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {behavioralTraits.map((trait) => {
                      const rating = primaryBehavioral?.ratings[trait]?.toUpperCase();
                      return (
                        <tr key={trait} className="even:bg-zinc-50 print:even:bg-white">
                          <td className="border border-zinc-300 px-3 py-2 font-medium text-zinc-900 print:border-black">
                            {trait}
                          </td>
                          {grades.map((g) => (
                            <td key={g} className="border border-zinc-300 px-3 py-2 text-center print:border-black">
                              {rating === g ? (
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white print:border print:border-black print:bg-white print:text-black">
                                  ✓
                                </span>
                              ) : (
                                <span className="text-zinc-300">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer / signature area — clean on print */}
          <div className="flex justify-between border-t border-zinc-200 pt-6 text-xs text-zinc-600 print:border-black">
            <div>
              <div className="h-10 w-40 border-b border-zinc-400" />
              <p className="mt-1 font-medium">Class Teacher</p>
            </div>
            <div className="text-right">
              <div className="h-10 w-40 border-b border-zinc-400" />
              <p className="mt-1 font-medium">Principal</p>
            </div>
          </div>
        </div>
      </div>
        </div>

        {/* Overlay — beautiful dark card, absolutely centered over blurred content */}
        {isLocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/20 p-4 backdrop-blur-[1px] print:hidden">
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
      </div>

      {/* Print styles: hide surrounding UI chrome */}
      <style>{`@media print { body { background: white !important; } @page { size: A4; margin: 10mm; } }`}</style>
    </div>
  );
}
