import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Sticky bottom bar for long forms (keeps the save button a thumb-reach away).
 *
 * Wraps `.action-bar-sticky`, which pins at the viewport bottom, paints an
 * opaque backdrop, and slides content beneath it. Two usage modes:
 *
 *   - Inside a padded block (a SectionCard, a modal) the default behaviour is
 *     right: the base class spans the parent's horizontal padding with
 *     negative margins and inherits its bottom radius.
 *   - In a free-card stack (no padded parent clone) pass `variant="free"`:
 *     normal margins, its own radius and border, safe-area bottom inset —
 *     the bar becomes a floating chrome block instead of bleeding past the
 *     page grid.
 *
 * Callers keep the layout of the bar's contents (typically one `w-full`
 * primary submit, often an error/alert line above it).
 */
export interface MobileActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "contained" | "free";
}

export function MobileActionBar({
  variant = "contained",
  className,
  children,
  ...props
}: MobileActionBarProps) {
  return (
    <div
      className={cn("action-bar-sticky", variant === "free" && "mobile-action-bar", className)}
      {...props}
    >
      {children}
    </div>
  );
}
