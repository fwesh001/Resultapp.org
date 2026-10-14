"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * The show/hide control for a password field.
 *
 * Exported separately from PasswordField because the three sign-in forms render
 * their password through <Input>, which until recently had nowhere to put a
 * control that belongs inside the field. Both now use this button, so the icon,
 * the target size and the accessible name cannot drift between them.
 *
 * The caller owns `visible` — Input needs it to decide the input's `type`, and
 * PasswordField needs it for the same reason. Only the fields that manage their
 * own state (PasswordField) do so internally.
 */
export function PasswordToggle({
  label,
  visible,
  onToggle,
}: {
  /** Accessible name, e.g. "Show current password". Not rendered visibly. */
  label: string;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? `Hide ${label}` : `Show ${label}`}
      aria-pressed={visible}
      // Inside a <form>; without type="button" this would submit it.
      className="flex h-full w-11 items-center justify-center rounded-r-xl text-purple-300/70 transition hover:text-purple-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500"
    >
      {visible ? (
        <EyeOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Eye className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * Password input with a per-field Eye/EyeOff visibility toggle.
 *
 * WHY THIS EXISTS AS A SHARED COMPONENT
 * -------------------------------------
 * Password fields are spread across nine forms: admin, staff and student
 * sign-in, superadmin sign-in, admin setup, student password change, the
 * forgot-password reset, the public result checker, the registration wizard,
 * and the admin Security tab. The first two implementations (the registration
 * wizard and the Security tab) were written independently and disagree —
 * different class strings, different button placement, and one of them hangs a
 * single toggle off the first field that reveals all three at once, which reads
 * as a bug when the other two stay masked.
 *
 * A ninth copy would be a ninth place for them to disagree. One component,
 * one behaviour, one class string.
 *
 * THE TRAILING BUTTON IS INSIDE THE FIELD, NOT OVERLAID
 * -----------------------------------------------------
 * An absolutely-positioned button over a bare input would sit on top of the
 * last few characters and swallow clicks on them — so the input carries right
 * padding and the button occupies its own 44px column instead. 44px is also
 * the minimum comfortable touch target.
 *
 * EACH FIELD OWNS ITS OWN STATE
 * -----------------------------
 * `visible` is internal, so two fields in the same form never share a toggle.
 * That is the behaviour users expect: confirming you typed your new password
 * correctly should not unmask the current password too.
 */
export interface PasswordFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  label: string;
  /** Shown under the field. Also switches the border to the error colour. */
  error?: string;
}

export function PasswordField({
  id,
  label,
  error,
  className,
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-purple-100">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          className={
            "flex h-10 w-full rounded-xl border bg-purple-950/30 py-2 pl-3 pr-11 text-sm text-purple-50 ring-offset-[#0B0514] placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 " +
            (error
              ? "border-red-500/60 focus-visible:ring-red-500 focus-visible:border-red-500"
              : "border-purple-800/50 focus-visible:ring-purple-500 focus-visible:border-purple-500") +
            (className ? ` ${className}` : "")
          }
          {...props}
        />
        <div className="absolute inset-y-0 right-0">
          <PasswordToggle
            label={label}
            visible={visible}
            onToggle={() => setVisible((v) => !v)}
          />
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default PasswordField;