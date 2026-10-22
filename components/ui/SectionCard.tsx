import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one card surface.
 *
 * Every bordered, padded content block in the portals should be one of these —
 * never a hand-rolled `rounded-2xl border ... p-4` combo, and NEVER a
 * SectionCard nested inside another SectionCard. Surfaces compose as siblings
 * in a `space-y-*` stack (the dashboard's free-card composition), not as
 * card-in-card. A page that contains cards already provides the stack; the
 * card's own border is the only border a section gets.
 *
 * Paddings:
 *   - `md` (default) `p-4 sm:p-6` — settings, billing, long-form panels.
 *   - `sm`             `p-3 sm:p-4` — compact rows inside stacked lists.
 *   - `none`           `p-0`        — tables / scrollers that manage their
 *                                     own edge padding.
 */
export interface SectionCardProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-side header slot (links, small buttons). Drops below the title on phones. */
  actions?: React.ReactNode;
  pad?: "sm" | "md" | "none";
}

const padClasses = {
  sm: "p-3 sm:p-4",
  md: "p-4 sm:p-6",
  none: "",
} as const;

export function SectionCard({
  title,
  description,
  actions,
  pad = "md",
  className,
  children,
  ...props
}: SectionCardProps) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;

  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border border-line-1 bg-surface-1",
        padClasses[pad],
        className
      )}
      {...props}
    >
      {hasHeader && (
        <div
          className={cn(
            "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
            pad !== "none" ? "" : "p-4 pb-0 sm:p-6 sm:pb-0"
          )}
        >
          <div className="min-w-0">
            {title !== undefined && (
              <h3 className="text-sm font-semibold text-text-1">{title}</h3>
            )}
            {description !== undefined && (
              <p className="mt-1 text-xs text-text-3">{description}</p>
            )}
          </div>
          {actions !== undefined && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
