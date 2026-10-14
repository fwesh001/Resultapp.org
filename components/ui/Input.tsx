import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /**
   * Control pinned to the right edge of the field — the show/hide eye on a
   * password, for instance.
   *
   * This existed because the three sign-in forms all render their password via
   * <Input>, and Input had nowhere to put a control that belongs INSIDE the
   * field. Positioning one as a sibling overlay would have covered the last
   * characters of the value and eaten clicks on them.
   *
   * Supplying `trailing` also adds right padding so the text never runs under
   * the control.
   */
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", label, error, id, trailing, ...props }, ref) => {
    const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, "-")}`;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-purple-100">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            id={inputId}
            type={type}
            className={cn(
              "flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 ring-offset-[#0B0514] placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500 disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-red-500/60 focus-visible:ring-red-500 focus-visible:border-red-500",
              trailing && "pr-11",
              className
            )}
            ref={ref}
            {...props}
          />
          {trailing ? (
            <div className="absolute inset-y-0 right-0 flex items-center">{trailing}</div>
          ) : null}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
