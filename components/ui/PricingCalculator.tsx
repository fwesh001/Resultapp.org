"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Calculator, Users, ArrowRight, Coins } from "lucide-react";
import { getPricingTier, calculateTieredTotal, getSliderPct } from "@/lib/pricing";

export function PricingCalculator() {
  const [students, setStudents] = useState(350);

  const { pricePerStudent: unitPrice, badge, badgeStyle } = useMemo(() => getPricingTier(students), [students]);
  const total = useMemo(() => calculateTieredTotal(students), [students]);
  const pct = useMemo(() => getSliderPct(students), [students]);

  const formattedTotal = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0,
      }).format(total),
    [total]
  );

  const formattedStudents = useMemo(() => new Intl.NumberFormat("en-NG").format(students), [students]);

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-purple-500/20 bg-purple-900/10 p-6 backdrop-blur-xl md:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-purple-600/15 blur-[50px]" />
      <div aria-hidden className="pointer-events-none absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-violet-600/10 blur-[50px]" />

      <div className="relative">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-xs font-medium tracking-wide text-purple-200">
              <Calculator className="h-3.5 w-3.5 text-purple-300" />
              Number of Students
            </div>

            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-4xl font-bold tracking-tight text-white md:text-5xl">{formattedStudents}</span>
              <span className="text-sm font-medium text-purple-300">students</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-purple-500/20 bg-purple-950/40 px-2.5 py-1 font-mono text-purple-200">
                {unitPrice} NGN / student
              </span>
              {badge ? (
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeStyle}`}>{badge}</span>
              ) : (
                <span className="rounded-full border border-purple-500/10 bg-purple-500/5 px-2.5 py-1 text-purple-200/60">Standard rate</span>
              )}
            </div>
          </div>

          <div className="shrink-0 rounded-2xl border border-purple-500/20 bg-[#0B0514]/60 p-5 backdrop-blur md:min-w-[280px] md:text-center">
            <div className="text-xs font-medium tracking-widest text-purple-300">TOTAL COST PER TERM (NGN)</div>
            <div className="mt-2 text-4xl font-bold tracking-tight text-purple-400 md:text-5xl">{formattedTotal}</div>
            <div className="mt-1 text-xs text-purple-200/60">
              {formattedStudents} × ₦{unitPrice} • one-time per term
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-purple-600/15 px-3 py-1 text-xs font-medium text-purple-200">
              <Coins className="h-3.5 w-3.5" /> Credit Wallet
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between text-xs font-medium text-purple-300">
            <span>50</span>
            <span className="hidden rounded-full border border-purple-500/15 bg-purple-500/5 px-2.5 py-1 text-purple-200 md:inline-flex">
              Drag to adjust • step 10
            </span>
            <span>2,000</span>
          </div>

          <div className="relative mt-4">
            <input
              type="range"
              min={50}
              max={2000}
              step={10}
              value={students}
              onChange={(e) => setStudents(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-purple-950/60"
              style={{
                background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(168 85 247) ${pct}%, rgba(88,28,135,0.35) ${pct}%, rgba(88,28,135,0.35) 100%)`,
              }}
              aria-label="Number of students"
            />
            <div
              className="pointer-events-none absolute top-1/2 hidden h-3 w-3 -translate-y-1/2 rounded-full bg-purple-400 shadow-[0_0_20px_8px_rgba(168,85,247,0.45)] md:block"
              style={{ left: `calc(${pct}% - 6px)` }}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {[100, 350, 500, 1000, 1500, 2000].map((n) => (
              <button
                key={n}
                onClick={() => setStudents(n)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
                  students === n
                    ? "border-purple-500 bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]"
                    : "border-purple-500/15 bg-purple-900/10 text-purple-200 hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-white"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full border px-2.5 py-1 ${students < 500 ? "border-purple-500 bg-purple-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
              50–499 → ₦100
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${students >= 500 && students < 1000 ? "border-violet-500 bg-violet-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
              500–999 → ₦90 (10% off)
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${students >= 1000 ? "border-emerald-500 bg-emerald-600 text-white" : "border-purple-500/15 bg-purple-900/10 text-purple-200/60"}`}>
              1000+ → ₦80 (20% off)
            </span>
          </div>
        </div>

        <p className="mt-6 flex items-start gap-2 border-t border-purple-500/10 pt-5 text-sm leading-6 text-purple-200/60">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" />
          Example: {formattedStudents} students at ₦{unitPrice} = {formattedTotal} per term. Add more students anytime — wallet deducts automatically. Unused not lost.
        </p>

        {/* only show CTA when used standalone? Keep for both pages - pricing page will have separate CTA, but component includes register link for landing */}
        <div className="mt-6 flex md:hidden">
          <Link
            href="/register"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_30px_rgba(147,51,234,0.35)] hover:bg-purple-500"
          >
            Register Your School <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 hidden md:flex md:justify-end">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_30px_rgba(147,51,234,0.35)] hover:bg-purple-500"
          >
            Register Your School <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <style jsx>{`
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          height: 22px;
          width: 22px;
          border-radius: 9999px;
          background: white;
          border: 4px solid rgb(147 51 234);
          box-shadow: 0 0 20px rgba(147, 51, 234, 0.6);
          cursor: pointer;
          transition: transform 0.15s;
        }
        input[type="range"]::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }
        input[type="range"]::-moz-range-thumb {
          height: 22px;
          width: 22px;
          border-radius: 9999px;
          background: white;
          border: 4px solid rgb(147 51 234);
          box-shadow: 0 0 20px rgba(147, 51, 234, 0.6);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
