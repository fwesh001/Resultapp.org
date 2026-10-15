"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, type LucideIcon } from "lucide-react";

/**
 * The single row-actions dropdown used across the admin surfaces.
 *
 * WHY THIS IS HAND-ROLLED
 * -----------------------
 * There is no menu library in this repo — no Radix, no headlessui, no cmdk.
 * `TenantRowMenu` grew the first implementation and this file generalises it,
 * because three surfaces (superadmin tenants, allocation students, allocation
 * staff) needed the same trigger/menu/dismiss mechanics and each rolling its
 * own would guarantee the Escape handling, the focus ring and the panel
 * geometry drift apart.
 *
 * If a menu library is ever adopted, THIS is the file to delete. Every caller
 * passes a plain `items` array, so the swap is local.
 *
 * CLOSE BEHAVIOUR
 * ---------------
 * Three ways out, all of them required:
 *   - selecting an item (the handler closes, then runs the callback)
 *   - Escape (keyboard users must not be trapped in an overlay)
 *   - pointerdown outside the root (fires BEFORE click, so a click that lands
 *     on the page underneath is not swallowed by a panel that is already gone)
 */

export interface RowActionItem {
  label: string;
  icon: LucideIcon;
  /** Called after the menu closes. Omit for a disabled-looking row. */
  onSelect?: () => void;
  /**
   * Renders an `<a>` instead of a `<button>`. Used for outbound links, where a
   * click handler + `preventDefault` would break middle-click and "open in new
   * tab".
   */
  href?: string;
  external?: boolean;
  /**
   * `danger` paints the row red, `success` green. Both are for the one
   * consequential row in a menu (delete / restore) so it reads as the odd one
   * out without needing a second dialog-level affordance.
   */
  variant?: "default" | "danger" | "success";
  /** Draw a hairline above this row, for grouping. */
  separatorBefore?: boolean;
  /** Disables selection and dims the row. */
  disabled?: boolean;
}

interface RowActionsMenuProps {
  /** Accessible name for the trigger, e.g. "Actions for Ada Lovelace". */
  label: string;
  items: RowActionItem[];
  /**
   * Trigger glyph. Defaults to a gear because "settings for this row" is the
   * convention across the admin surfaces; pass `MoreHorizontal` to keep a
   * kebab affordance.
   */
  triggerIcon?: LucideIcon;
  disabled?: boolean;
}

const ITEM_BASE =
  "flex w-full items-center gap-2 px-4 py-2.5 text-xs transition";
const ITEM_VARIANT = {
  default: "text-purple-100 hover:bg-white/5 hover:text-white",
  success: "text-emerald-200 hover:bg-white/5",
  danger: "font-medium text-red-300 hover:bg-red-500/10",
} as const;

export function RowActionsMenu({
  label,
  items,
  triggerIcon: TriggerIcon = Settings,
  disabled = false,
}: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Returning focus to the trigger is what makes Escape feel like "cancel"
      // rather than "the button vanished and focus fell to <body>".
      triggerRef.current?.focus();
    }
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function run(item: RowActionItem) {
    if (item.disabled || !item.onSelect) return;
    setOpen(false);
    item.onSelect();
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-purple-500/15 bg-purple-900/10 text-purple-200 transition hover:bg-purple-900/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <TriggerIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-purple-500/20 bg-[#150A26] shadow-2xl"
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            const variant = item.variant ?? "default";
            const separator = item.separatorBefore
              ? "border-t border-purple-500/10"
              : "";
            const dangerRule = variant === "danger" ? "border-t border-red-500/10" : "";
            const cls = `${ITEM_BASE} ${ITEM_VARIANT[variant]} ${separator} ${dangerRule}`;

            if (item.href) {
              return (
                <a
                  key={`${item.label}-${i}`}
                  role="menuitem"
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  onClick={() => setOpen(false)}
                  className={cls}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {item.label}
                </a>
              );
            }

            return (
              <button
                key={`${item.label}-${i}`}
                role="menuitem"
                type="button"
                onClick={() => run(item)}
                disabled={item.disabled}
                aria-disabled={item.disabled || undefined}
                className={`${cls} text-left disabled:cursor-not-allowed disabled:opacity-45`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RowActionsMenu;
