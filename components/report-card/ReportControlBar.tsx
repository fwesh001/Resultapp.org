"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";
import { toTitleCase } from "@/lib/format";
import { Select, type SelectOption } from "@/components/ui/Select";

const TERMS = ["Term 1", "Term 2", "Term 3"] as const;

/** Dispatched by StudentReportCard once the report payload resolves. */
export const REPORT_READY_EVENT = "resultapp:report-ready";

interface ReportControlBarProps {
  tenantId: string;
  studentId: string;
  term: string;
  schoolName?: string | null;
  /** Server-known printability (e.g. false when the subscription is locked). */
  canPrint?: boolean;
}

export function ReportControlBar({ tenantId, studentId, term, schoolName, canPrint = true }: ReportControlBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [printable, setPrintable] = useState(canPrint);

  useEffect(() => {
    setPrintable(canPrint);
  }, [canPrint]);

  useEffect(() => {
    function onReportReady(e: Event) {
      const detail = (e as CustomEvent<{ canPrint?: boolean }>).detail;
      if (typeof detail?.canPrint === "boolean") {
        setPrintable(detail.canPrint);
      }
    }
    window.addEventListener(REPORT_READY_EVENT, onReportReady);
    return () => window.removeEventListener(REPORT_READY_EVENT, onReportReady);
  }, []);

  function onTermChange(next: string) {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    params.set("term", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
      <Link
        href={`/${tenantId}`}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-purple-200 backdrop-blur transition hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to {schoolName ? toTitleCase(schoolName) : tenantId}
      </Link>

      <div className="flex items-center gap-2">
          <label htmlFor="report-term-select" className="flex min-h-[44px] items-center gap-2 text-xs text-purple-200/70">
            Term
            <Select
              id="report-term-select"
              triggerClassName="h-11 rounded-full bg-white/5 px-3 font-medium"
              aria-label="Term"
              value={term}
              onChange={onTermChange}
              options={TERMS.map((t): SelectOption => ({ value: t, label: t }))}
            />
          </label>

        <button
          type="button"
          onClick={() => window.print()}
          disabled={!printable}
          title={printable ? "Print or save as PDF" : "No printable report data yet"}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Printer className="h-4 w-4" /> Print / Save PDF
        </button>
      </div>
    </div>
  );
}
