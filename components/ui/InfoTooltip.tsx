"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { HelpCircle, X } from "lucide-react";

/**
 * InfoTooltip — an accessible, dependency-free help affordance.
 *
 * WHY A TOOLTIP AND NOT INLINE TEXT
 * --------------------------------
 * The helper copy this replaces ("Charged once per published report card")
 * was rendered as permanent small text under every field. That is fine on
 * desktop and actively harmful on mobile, where a screen of form is mostly
 * secondary explanation and the primary inputs are pushed below the fold.
 *
 * THE INTERACTION PROBLEM
 * -----------------------
 * A tooltip is the rare component that is NOT the same control on touch and
 * on pointer devices:
 *
 *   Desktop — hover reveals it. The pointer is a precise, non-committal
 *   instrument: moving over something is a question, not an answer.
 *
 *   Mobile — there is no hover. `:hover` fires on tap and then sticks, so the
 *   naive implementation shows the tooltip and the visitor has no way to
 *   dismiss it except by tapping elsewhere and hoping. Worse, the first tap
 *   can be swallowed trying to open it, so the control feels broken.
 *
 * So this treats them as two different controls behind one trigger:
 *
 *   - pointer:fine  -> show on hover AND on focus, hide on blur/leave
 *   - pointer:coarse -> toggle on tap, dismiss on Escape, on outside tap,
 *                       or by tapping the trigger again
 *
 * Both paths are ALSO available to keyboard and screen-reader users on every
 * device, because `pointer: fine` is a statement about the primary pointer,
 * not a promise that nobody uses a keyboard. A hybrid laptop reports
 * `pointer: fine` and still has a touchscreen, so the tap path is bound to
 * pointer type alone; the keyboard bindings are bound to key events instead,
 * and both are live at once.
 *
 * SCREEN READERS
 * --------------
 * The trigger is a real <button>, so it is reachable and operable by
 * keyboard. aria-expanded + aria-controls describe the relationship, and the
 * tooltip body is a live region so it is announced when it appears — a
 * tooltip referenced only by aria-describedby is silent, because it was never
 * focused.
 *
 * The panel deliberately does NOT trap focus and closes on Escape, matching
 * the APG's non-modal dialog pattern. A help bubble is not a modal: a user who
 * opens it should be able to keep tabbing through the form.
 *
 * NEVER put interactive content inside `children`. It is rendered as text
 * content inside a non-interactive container; a <button> inside <button> is
 * invalid HTML and breaks assistive tech in ways that are hard to debug.
 */

interface InfoTooltipProps {
  /** The explanation. Plain text — no markup, no controls. */
  children: React.ReactNode;
  /** Optional visible label. When absent only the icon is shown. */
  label?: string;
  /** Where the bubble sits relative to the trigger. */
  placement?: "top" | "bottom";
  /** Override the icon size class when used inline with small text. */
  className?: string;
  /** Tooltip width. Bubbles wider than the viewport clip; this keeps them readable. */
  widthClass?: string;
}

export default function InfoTooltip({
  children,
  label,
  placement = "top",
  className = "",
  widthClass = "w-72",
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Match the *pointer* the visitor actually has. matchMedia("(hover: hover)")
  // would also be true on a hybrid laptop with a touchscreen, which is exactly
  // the device where a tap-first tooltip is needed.
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarse(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // On the tap path, clicking outside dismisses. Listening on `pointerdown`
  // rather than `click` avoids the "outside handler fires before the trigger
  // toggles" ordering bug, which leaves the tooltip stuck open.
  useEffect(() => {
    if (!open || !coarse) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, coarse, close]);

  // Escape closes on every device, not just the tap path: a keyboard user who
  // opened this with Enter needs the same way out a touch user has.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const showOnHover = !coarse;
  const vertical = placement === "top" ? "bottom-full mb-2" : "top-full mt-2";

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label ? undefined : "More information"}
        // Hover/focus are pointer-path affordances only. On touch they would
        // latch the bubble open with no dismissal, so they are bound to the
        // coarse-pointer check rather than left as bare CSS.
        onMouseEnter={showOnHover ? () => setOpen(true) : undefined}
        onMouseLeave={showOnHover ? () => setOpen(false) : undefined}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Moving focus into the panel keeps it open.
          if (panelRef.current?.contains(e.relatedTarget as Node)) return;
          setOpen(false);
        }}
        onClick={(e) => {
          // Prevent a tap on the trigger from also reaching a wrapping <label>
          // or button, which would toggle something unrelated.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-purple-300/50 transition hover:text-purple-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
      >
        <HelpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label ? <span className="sr-only">{label}</span> : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="tooltip"
          aria-live="polite"
          className={`absolute left-1/2 z-50 ${vertical} ${widthClass} -translate-x-1/2 rounded-xl border border-purple-500/25 bg-[#150826] px-3 py-2.5 text-xs leading-relaxed text-purple-100/90 shadow-[0_10px_30px_rgba(0,0,0,0.45)]`}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">{children}</div>
            {coarse ? (
              // Touch has no hover and no Escape key, so the bubble needs a
              // visible, reachable way out. On desktop Escape and blur are
              // enough and an X would just be clutter.
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                }}
                aria-label="Close"
                className="-mr-1 -mt-0.5 shrink-0 rounded-full p-1 text-purple-300/50 transition hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}
