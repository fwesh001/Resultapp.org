import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Global button.
 *
 * Two independent axes decide how a button looks and how it moves:
 *   - `variant`  owns colour, and publishes `--btn-fill` (the hover fill).
 *   - `animation` owns the pseudo-element geometry only (see globals.css).
 * Keeping them orthogonal means `variant="primary" animation="radial"` is a
 * legitimate combination, rather than colour and motion being welded together.
 *
 * The motion is a single `::after` clipped with `clip-path`, which animates on
 * the compositor. `isolation: isolate` (set in globals.css alongside
 * `.btn-anim`) is REQUIRED: without it the `z-index: -1` pseudo-element
 * resolves against an ancestor stacking context and renders behind it.
 *
 * `type` defaults to "button" per the React/shadcn convention. Audited across
 * all call sites: no `<Button>` relied on the native implicit-submit default.
 */

const buttonVariants = cva(
  cn(
    "btn-anim relative isolate overflow-hidden",
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "font-medium",
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
    "focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0514]",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
  ),
  {
    variants: {
      variant: {
        primary: cn(
          "bg-purple-600 text-white",
          "shadow-[0_0_28px_rgba(147,51,234,0.30)]",
          "[--btn-fill:#a855f7]"
        ),
        outline: cn(
          "border border-purple-500/25 bg-transparent text-purple-100",
          "[--btn-fill:#a855f7]",
          "[--btn-fg-hover:#ffffff]"
        ),
        ghost: cn(
          "bg-transparent text-purple-200",
          "[--btn-fill:rgb(168_85_247_/_0.16)]",
          "[--btn-fg-hover:#ffffff]"
        ),
        destructive: cn(
          "bg-red-600 text-white",
          "[--btn-fill:rgb(239_68_68_/_0.92)]"
        ),
        link: "h-auto rounded-none p-0 text-purple-300 hover:text-purple-100",

        /** Back-compat aliases — the pre-cva API. `default` was the old name
         *  for a filled button; `secondary` was the old bordered one. */
        default: "bg-purple-600 text-white [--btn-fill:#a855f7]",
        secondary: cn(
          "border border-purple-500/25 bg-transparent text-purple-100",
          "[--btn-fill:#a855f7]",
          "[--btn-fg-hover:#ffffff]"
        ),
      },
      size: {
        xs: "min-h-7 gap-1.5 rounded-full px-2.5 text-xs [&_svg]:size-3.5",
        sm: "min-h-8 gap-1.5 rounded-full px-3 text-sm",
        md: "min-h-11 gap-2 rounded-full px-5 text-sm",
        lg: "min-h-12 gap-2 rounded-full px-8 text-base",
        icon: "size-11 rounded-full [&_svg]:size-5",
      },
      /** Handle for the geometry defined in globals.css. */
      animation: {
        liquid: "btn-liquid",
        slide: "btn-slide",
        radial: "btn-radial",
        drop: "btn-drop",
        none: "btn-anim-off",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      animation: "liquid",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner, forces `disabled`, and sets `aria-busy`. The label stays
   *  put so the button does not change width mid-submit. */
  isLoading?: boolean;
  /** Brief confirmation state — emerald ring + a check, no timer (the caller
   *  owns the reset). Mutually exclusive with `isLoading`. */
  isSuccess?: boolean;
  /** Slow attention pulse for a primary CTA. Gated by `motion-safe`. */
  pulse?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      animation,
      isLoading = false,
      isSuccess = false,
      pulse = false,
      fullWidth = false,
      disabled,
      type = "button",
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading || isSuccess;

    return (
      <button
        ref={ref}
        type={type}
        aria-busy={isLoading || undefined}
        disabled={isDisabled}
        className={cn(
          buttonVariants({ variant, size, animation }),
          fullWidth && "w-full",
          pulse && "motion-safe:animate-pulse",
          isSuccess &&
            "border border-emerald-400/60 bg-emerald-500/20 text-emerald-100 [--btn-fill:rgb(16_185_129_/_0.30)]",
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="animate-spin" aria-hidden />}
        {isSuccess && <Check aria-hidden />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
