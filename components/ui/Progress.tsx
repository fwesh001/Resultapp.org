"use client";

import { cn } from "@/lib/utils";

/**
 * Determinate progress bar.
 *
 * Extracted from the inline markup that previously lived in four places
 * (admin dashboard, CommandCenterClient, UploadField, RegisterSchoolForm).
 * The accessibility attributes are copied from the RegisterSchoolForm site,
 * which was the only one that had them — a bar with no role/aria is invisible
 * to a screen reader and conveys nothing about the pending state.
 *
 * `value` is 0–100 and is clamped here so a caller that divides by a zero
 * Content-Length cannot emit `width: NaN%` and collapse the bar.
 */

export interface ProgressProps {
  /** Completion 0–100. Values outside the range are clamped. */
  value?: number | null;
  /** Accessible name, e.g. "Export progress". */
  label?: string;
  /** Show the numeric percentage next to the bar. */
  showValue?: boolean;
  size?: "sm" | "md";
  /** Tone for the filled portion — used to signal success/failure. */
  tone?: "brand" | "success" | "danger";
  className?: string;
}

const TONE: Record<NonNullable<ProgressProps["tone"]>, string> = {
  brand: "bg-purple-500",
  success: "bg-emerald-500",
  danger: "bg-red-500",
};

export function Progress({
  value,
  label = "Progress",
  showValue = false,
  size = "md",
  tone = "brand",
  className,
}: ProgressProps) {
  // null/undefined => indeterminate (0%). Never NaN.
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const pct = Math.max(0, Math.min(100, raw));
  const rounded = Math.round(pct);

  return (
    <div className={cn("w-full", className)}>
      {showValue && (
        <p className="mb-1.5 text-xs font-semibold text-purple-200/70">
          {rounded}%
        </p>
      )}
      <div
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className={cn(
          "w-full overflow-hidden rounded-full bg-purple-950/60",
          size === "sm" ? "h-1.5" : "h-2.5",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 ease-out",
            TONE[tone],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default Progress;