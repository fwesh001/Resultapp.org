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
    <div className="rounded-2xl border border-line-1 bg-surface-1 p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-2">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/30">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-text-1">{value}</p>
      {sub && <p className="mt-1 text-xs text-text-3">{sub}</p>}
    </div>
  );
}
