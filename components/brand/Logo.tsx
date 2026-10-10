"use client";

import { cn } from "@/lib/utils";
import { GraduationCap } from "lucide-react";

/**
 * Brand / tenant crest mark.
 *
 * TWO IDENTITIES, ONE COMPONENT
 * -----------------------------
 * This renders one of three things, in strict priority order:
 *
 *   1. A TENANT CREST  — when `src` is supplied (a school's uploaded logo).
 *   2. A NEUTRAL CAP   — when `src` is empty/absent (a school with no upload).
 *   3. The PRODUCT MARK— when `src` is the literal `PRODUCT_LOGO_SRC`.
 *
 * Why the neutral cap instead of falling back to the product mark: in a tenant
 * portal, showing the ResultApp monogram to a school that never uploaded a
 * crest makes that school look like it IS branded as ResultApp. A cap is
 * semantically neutral ("a school") and keeps the white-label illusion intact.
 * The product mark is reserved for our own marketing surfaces, where it is
 * passed explicitly via `PRODUCT_LOGO_SRC`.
 *
 * WHY SQUARE MODE FOR CRESTS
 * --------------------------
 * The product artwork is PORTRAIT (1045x1449, aspect 0.72), so the default
 * branch pins only the height and lets the width follow (`w-auto`) — squashing
 * it with a fixed square would distort it, and letterboxing it with
 * `object-contain` keeps its true proportions.
 *
 * Tenant crests are the opposite: schools upload square-ish seals and expect
 * them to FILL the slot, bold and proportional, not rendered narrow beside the
 * name. So when `src` is a crest we switch to square mode: an explicit
 * `w-`/`h-` pair plus `object-cover`, which crops rather than squashes. That is
 * the "looks bold and proportional" behaviour — the opposite trade-off to the
 * product mark, and deliberately so, because the two assets have different
 * shapes and different expectations.
 *
 * Colour note for whoever re-skins the product mark: the accent is currently
 * #FF59E6 (pink) on a near-black plate, while the surrounding UI is purple
 * (#7C3AED / #A855F7). Recolouring the product asset is a one-step change.
 */

/** The canonical ResultApp product asset. Passing this selects the product branch. */
export const PRODUCT_LOGO_SRC = "/logo.png";

export type LogoSize = "xs" | "sm" | "lg" | "md";

/**
 * PRODUCT branch: only the HEIGHT is set. The width is left to the artwork's
 * own 0.72 ratio (`w-auto`), which is the whole point: pin one axis and let the
 * other follow the real shape. Setting both would squash the mark, and
 * precomputing a width here would silently rot the next time the asset is
 * re-exported.
 */
const HEIGHT: Record<LogoSize, string> = {
  xs: "h-5",
  sm: "h-7",
  md: "h-9",
  lg: "h-11",
};

/**
 * TENANT CREST branch: both axes pinned so the seal fills its slot uniformly.
 * Kept one step down from the product heights — a crest sits beside the school
 * name, so matching the product mark's full height would crowd the text.
 */
const CREST_SQUARE: Record<LogoSize, string> = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

export interface LogoProps {
  size?: LogoSize;
  /**
   * Image to render.
   *
   *   - a tenant crest URL  -> square mode + object-cover
   *   - `PRODUCT_LOGO_SRC`  -> the product branch (portrait, object-contain)
   *   - absent / empty      -> a neutral GraduationCap (no crest uploaded)
   *
   * Deliberately NOT typed as a URL: the backend stores `logo_url` as free
   * text, so a malformed value must degrade to the cap rather than crash or
   * emit a broken image. Anything falsy or whitespace-only is treated as "no
   * crest".
   */
  src?: string | null;
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
  src,
  badge = false,
  badgeClassName = "bg-purple-600",
  alt = "ResultApp",
  className,
  priority = false,
}: LogoProps) {
  // Normalise: trim, and collapse absent/whitespace to a single empty string so
  // downstream branching is a plain comparison.
  const resolved = (src ?? "").trim();

  const wrapperClass = cn(
    "inline-flex shrink-0 items-center justify-center rounded-lg",
    badge && badgeClassName,
    className,
  );

  // --- 1. No crest: neutral cap, so an unbranded school is never made to look
  //        like it is branded as ResultApp. `alt` is forced to "" because the
  //        school name sits beside it, so naming the icon would double-announce.
  if (!resolved) {
    return (
      <span
        className={cn(
          wrapperClass,
          "border border-purple-500/20 bg-purple-900/20",
        )}
        data-logo-size={size}
        data-logo-variant="cap"
        aria-hidden={alt ? undefined : true}
      >
        <GraduationCap
          className={cn(HEIGHT[size], "w-auto text-purple-300")}
          aria-label={alt || undefined}
          role={alt ? "img" : undefined}
        />
      </span>
    );
  }

  // --- 2. Product mark: portrait asset, height-only sizing + object-contain.
  if (resolved === PRODUCT_LOGO_SRC) {
    return (
      <span className={wrapperClass} data-logo-size={size} data-logo-variant="product">
        <img
          src={PRODUCT_LOGO_SRC}
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

  // --- 3. Tenant crest: square mode, object-cover, no portrait intrinsics.
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <span className={wrapperClass} data-logo-size={size} data-logo-variant="tenant">
      <img
        src={resolved}
        alt={alt}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : {})}
        className={cn(CREST_SQUARE[size], "rounded-full object-cover")}
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
  src,
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
      <Logo
        size={size}
        src={src}
        badge={badge}
        badgeClassName={badgeClassName}
        alt=""
        priority={priority}
      />
      <span className={cn("font-semibold tracking-tight", wordmarkClassName)}>{wordmark}</span>
    </span>
  );
}