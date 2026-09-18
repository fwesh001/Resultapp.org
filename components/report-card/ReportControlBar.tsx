"use client";

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";

const TERMS = ["Term 1", "Term 2", "Term 3"] as const;

interface ReportControlBarProps {
  tenantId: string;
  studentId: string;
  term: string;
  schoolName?: string | null;
}

export function ReportControlBar({ tenantId, studentId, term, schoolName }: ReportControlBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  function onTermChange(next: string) {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    params.set("term", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
      <Link
        href={`/${tenantId}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-purple-200 backdrop-blur transition hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to {schoolName || tenantId}
      </Link>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-purple-200/70">
          Term
          <select
            value={term}
            onChange={(e) => onTermChange(e.target.value)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white backdrop-blur focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
          >
            {TERMS.map((t) => (
              <option key={t} value={t} className="bg-[#0B0514] text-white">
                {t}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow transition hover:bg-slate-100"
        >
          <Printer className="h-4 w-4" /> Print / Save PDF
        </button>
      </div>
    </div>
  );
}
