"use client";

import { useState, useMemo } from "react";
import { Calculator, Users, Sparkles, ArrowRight } from "lucide-react";
import Link from "next/link";

export function PricingCalculator() {
  const [count, setCount] = useState(350);

  const total = useMemo(() => count * 100, [count]);

  const formattedTotal = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0,
      }).format(total),
    [total]
  );

  const formattedCount = useMemo(
    () => new Intl.NumberFormat("en-NG").format(count),
    [count]
  );

  // percentage for slider background fill
  const pct = ((count - 50) / (2000 - 50)) * 100;

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-purple-500/20 bg-purple-900/10 p-6 backdrop-blur-xl md:p-10">
      {/* glow gradients */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-purple-600/20 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-violet-600/15 blur-[80px]" />

      <div className="relative">
        {/* header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1.5 text-xs font-medium tracking-wide text-purple-200">
              <Calculator className="h-3.5 w-3.5 text-purple-300" />
              PRICING CALCULATOR
            </div>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
              How much for your school?
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-purple-200/70 md:text-[15px]">
              Flat rate per term. No hidden fees. Pay only for the students you have.
            </p>
          </div>

          {/* price display card */}
          <div className="flex shrink-0 flex-col items-start gap-3 rounded-2xl border border-purple-500/20 bg-[#0B0514]/60 p-5 backdrop-blur md:min-w-[280px] md:items-center md:text-center">
            <div className="flex items-center gap-2 text-xs font-medium tracking-widest text-purple-300">
              <Users className="h-4 w-4" />
              {formattedCount} STUDENTS
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tracking-tight text-white md:text-5xl">
                {formattedTotal}
              </span>
              <span className="text-sm font-medium text-purple-300">/ term</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-purple-600/15 px-3 py-1 text-xs font-medium text-purple-200">
              <Sparkles className="h-3.5 w-3.5 text-purple-300" />
              {formattedCount} × ₦100
            </div>
          </div>
        </div>

        {/* slider */}
        <div className="mt-8 md:mt-10">
          <div className="flex items-center justify-between text-xs font-medium text-purple-300">
            <span>50 students</span>
            <span className="hidden rounded-full border border-purple-500/20 bg-purple-500/10 px-2.5 py-1 text-purple-200 md:inline-flex">
              Drag to adjust
            </span>
            <span>2,000 students</span>
          </div>

          <div className="relative mt-4">
            <input
              type="range"
              min={50}
              max={2000}
              step={10}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-purple-950/80 accent-purple-600"
              style={{
                background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(168 85 247) ${pct}%, rgba(88,28,135,0.4) ${pct}%, rgba(88,28,135,0.4) 100%)`,
              }}
              aria-label="Student count"
            />
            {/* thumb glow indicator */}
            <div
              className="pointer-events-none absolute top-1/2 hidden h-3 w-3 -translate-y-1/2 rounded-full bg-purple-400 shadow-[0_0_20px_8px_rgba(168,85,247,0.5)] md:block"
              style={{ left: `calc(${pct}% - 6px)` }}
            />
          </div>

          {/* quick presets */}
          <div className="mt-6 flex flex-wrap gap-2">
            {[100, 250, 500, 1000, 1500].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
                  count === n
                    ? "border-purple-500 bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.4)]"
                    : "border-purple-500/20 bg-purple-900/20 text-purple-200 hover:border-purple-500/40 hover:bg-purple-500/10 hover:text-white"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* footer */}
        <div className="mt-8 flex flex-col gap-4 border-t border-purple-500/10 pt-6 md:flex-row md:items-center md:justify-between">
          <p className="flex items-start gap-2 text-sm leading-6 text-purple-200/60">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" />
            <span>
              Example: {formattedCount} students = {formattedTotal} once per term. Credits never expire — use them across sessions.
            </span>
          </p>
          <Link
            href="/register"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_30px_rgba(147,51,234,0.35)] transition-all hover:bg-purple-500 hover:shadow-[0_0_40px_rgba(147,51,234,0.5)]"
          >
            Register Your School
            <ArrowRight className="h-4 w-4" />
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
