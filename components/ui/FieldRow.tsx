import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Responsive form row: stacks on phones, joins into a row from `sm` up.
 *
 * Contract:
 *   - Fluid cells carry their own `flex-1 min-w-0`. Flex items default to
 *     `min-width: auto`, which crushes inputs to slivers instead of wrapping
 *     — `min-w-0` is what licenses the shrink.
 *   - Fixed widths are allowed only as desktop values (`w-28` → prefer
 *     `w-24 sm:w-28`) so the small-screen layout never overflows.
 *   - Trailing icon buttons: `h-9 w-9 shrink-0` and nothing more — `align="end"`
 *     bottom-aligns them with the input row on BOTH breakpoints (no `mt-*`
 *     eyeball alignment that drifts outside card borders on phones).
 */
export interface FieldRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `center` — items center-align from `sm` up (label+input cells).
   * `end`    — items bottom-align at every breakpoint (input + icon button).
   * `start`  — items top-align at every breakpoint (mixed-height cells).
   */
  align?: "start" | "center" | "end";
}

const alignClasses = {
  start: "items-start",
  center: "sm:items-center",
  end: "items-end",
} as const;

export function FieldRow({
  align = "center",
  className,
  children,
  ...props
}: FieldRowProps) {
  return (
    <div
      className={cn("flex flex-col gap-2 sm:flex-row", alignClasses[align], className)}
      {...props}
    >
      {children}
    </div>
  );
}
