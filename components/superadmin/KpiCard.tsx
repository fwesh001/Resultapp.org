"use client";

import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
}

export function KpiCard({ icon: Icon, label, value, sub }: Props) {
  return (
    <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.06] p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-purple-200/60">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-600/20 text-purple-300 ring-1 ring-purple-500/20">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-purple-300/40">{sub}</p>}
    </div>
  );
}
