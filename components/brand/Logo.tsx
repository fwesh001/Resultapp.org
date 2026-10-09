"use client";

import { cn } from "@/lib/utils";

/**
 * ResultApp brand mark.
 *
 * The artwork is a checkerboard "R" monogram on a dark rounded plate, taken
 * verbatim from the favicon (public/logo.png). Two constraints drove the
 * implementation, both measured rather than assumed:
 *
 *  1. The artwork is PORTRAIT — 1045 x 1449 px, aspect 0.72. It is not a square
 *     mark sitting in a roomy square canvas: the opaque pixels fill the canvas
 *     edge to edge, so there is nothing to crop. Any square `w-`/`h-` pair on
 *     the <img> would squash it. Instead the box is fixed and the image
 *     letterboxes inside it with `object-contain`, so the mark keeps its true
 *     proportions at every size.
 *
 *  2. The plate already contains its own dark rounded background and pink
 *     accent, so the old `bg-purple-600` wrapper badge would double up. The
 *     default therefore renders the mark alone; pass `badge` only where a
 *     coloured plate behind it is genuinely wanted.
 *
 * Colour note for whoever re-skins this: the mark's accent is currently
 * #FF59E6 (pink) on a near-black plate, while the UI around it is purple
 * (#7C3AED / #A855F7). Recolouring the asset is a one-step change here — see
 * the constants below.
 */

export type LogoSize = "xs" | "sm" | "md" | "lg";

/**
 * Only the HEIGHT is set. The width is left to the artwork's own 0.72 ratio
 * (`w-auto`), which is the whole point: pin one axis and let the other follow
 * the real shape. Setting both would squash the mark, and precomputing a
 * width here would silently rot the next time the asset is re-exported.
 */
const HEIGHT: Record<LogoSize, string> = {
  xs: "h-5",
  sm: "h-7",
  md: "h-9",
  lg: "h-11",
};

export interface LogoProps {
  size?: LogoSize;
  /**
   * Draw a coloured plate behind the mark. Off by default — the artwork
   * carries its own dark rounded plate, so a second one reads as a double
   * frame. Turn on only where the mark needs to sit on a light surface.
   */
  badge?: boolean;
  /** Plate colour when `badge` is set. */
  badgeClassName?: string;
  /**
   * Accessible name. Pass "" for decorative marks sitting beside visible brand
   * text (a screen reader would otherwise announce the name twice); pass a
   * real name when the logo is the only brand signal on the surface.
   */
  alt?: string;
  className?: string;
  priority?: boolean;
}

export function Logo({
  size = "sm",
  badge = false,
  badgeClassName = "bg-purple-600",
  alt = "ResultApp",
  className,
  priority = false,
}: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg",
        badge && badgeClassName,
        className,
      )}
      data-logo-size={size}
    >
      <img
        src="/logo.png"
        alt={alt}
        width={1045}
        height={1449}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : {})}
        className={cn(HEIGHT[size], "w-auto object-contain", badge && "rounded-md")}
      />
    </span>
  );
}

export interface LogoLockupProps extends Omit<LogoProps, "alt"> {
  /** Wordmark shown beside the mark. */
  wordmark?: string;
  wordmarkClassName?: string;
}

/** Mark + wordmark — the shape used by every navbar and card header. */
export function LogoLockup({
  size = "sm",
  badge = false,
  badgeClassName,
  wordmark = "resultapp.org",
  wordmarkClassName = "text-[15px] font-semibold text-white",
  className,
  priority = false,
}: LogoLockupProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* Decorative: the wordmark beside it already names the product. */}
      <Logo size={size} badge={badge} badgeClassName={badgeClassName} alt="" priority={priority} />
      <span className={cn("font-semibold tracking-tight", wordmarkClassName)}>{wordmark}</span>
    </span>
  );
}