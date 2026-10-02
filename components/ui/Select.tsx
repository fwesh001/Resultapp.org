"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  /** Array form of the options. Mutually exclusive with `options` children. */
  options?: SelectOption[];
  /** Render-prop form, for options that need richer labels. */
  children?: (option: SelectOption) => React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  /** Hide the visible label but keep it for screen readers. */
  hideLabel?: boolean;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** Applied to the outer wrapper (the flex column containing the label). */
  className?: string;
  /** Applied to the trigger button itself — use for width/sizing overrides. */
  triggerClassName?: string;
  /** Applied to the portalled listbox. Useful for forcing a light surface. */
  listboxClassName?: string;
  /**
   * Submits the current value as a hidden input, so the control works inside
   * `new FormData(form)`. Required wherever a native <select name=...> was
   * previously read from FormData.
   */
  name?: string;
  /**
   * Compact sizing for inline controls (e.g. per-student grade cells in a
   * table row). The default "md" matches the house style at h-10.
   */
  size?: "sm" | "md";
  /**
   * Trigger/listbox surface. "dark" is the portal default; "light" is for the
   * amber public error cards, where the dark trigger would clash.
   */
  surface?: "dark" | "light";
  "aria-label"?: string;
  "aria-describedby"?: string;
}

let idCounter = 0;
function useStableId(explicit?: string): string {
  const ref = React.useRef<string | null>(null);
  if (ref.current === null) {
    idCounter += 1;
    ref.current = explicit || `select-${idCounter}`;
  }
  return ref.current;
}

/**
 * Custom listbox dropdown — replaces native <select> app-wide.
 *
 * Native selects cannot be styled to match the portal's dark surfaces (the
 * dropdown list is painted by the OS), so every select here uses this instead.
 *
 * Accessibility notes:
 *  - Implements the WAI-ARIA listbox pattern (role="combobox" trigger,
 *    role="listbox"/"option" popup, aria-activedescendant for the virtual focus
 *    ring, so the DOM focus stays on the trigger).
 *  - Full keyboard support: Enter/Space/ArrowUp/ArrowDown open and move,
 *    Home/End jump, type-ahead, Escape closes and restores, Tab closes.
 *  - The trigger is a real <button> with `aria-haspopup="listbox"` and
 *    `aria-expanded`, so it is reachable by Tab and announced correctly.
 *
 * Z-index / stacking: the listbox is portalled to <body> with a high z-index so
 * it escapes any `overflow: hidden` or stacking context in a table cell or card.
 * Its position is recomputed on open, on scroll and on resize.
 */
export function Select({
  options,
  children,
  value,
  onChange,
  label,
  id,
  hideLabel = false,
  placeholder = "Select…",
  disabled = false,
  error,
  className,
  triggerClassName,
  listboxClassName,
  name,
  size = "md",
  surface = "dark",
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: SelectProps) {
  const baseId = useStableId(id);
  const listboxId = `${baseId}-listbox`;
  const triggerId = `${baseId}-trigger`;
  const errorId = `${baseId}-error`;

  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [coords, setCoords] = React.useState<{ top: number; left: number; width: number; drop: "down" | "up" } | null>(null);

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const typeAhead = React.useRef({ buffer: "", at: 0 });

  const items = React.useMemo<SelectOption[]>(() => options ?? [], [options]);
  const selectedIndex = React.useMemo(() => items.findIndex((o) => o.value === value), [items, value]);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;

  const reposition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    // Flip above the trigger when there is not enough room below.
    const drop = spaceBelow < 240 && r.top > spaceBelow ? "up" : "down";
    setCoords({
      top: drop === "down" ? r.bottom + 6 : r.top - 6,
      left: r.left,
      width: r.width,
      drop,
    });
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const openMenu = React.useCallback(() => {
    if (disabled) return;
    // Start the virtual cursor on the current selection.
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    reposition();
    setOpen(true);
  }, [disabled, selectedIndex, reposition]);

  const commit = React.useCallback(
    (opt: SelectOption | undefined) => {
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const move = React.useCallback(
    (dir: 1 | -1) => {
      setActiveIndex((prev) => {
        if (items.length === 0) return 0;
        let i = prev;
        for (let step = 0; step < items.length; step += 1) {
          i = (i + dir + items.length) % items.length;
          if (!items[i]?.disabled) return i;
        }
        return prev;
      });
    },
    [items],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) {
          openMenu();
        } else {
          move(e.key === "ArrowDown" ? 1 : -1);
        }
        return;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (!open) openMenu();
        else commit(items[activeIndex]);
        return;
      }
      case "Home":
      case "End": {
        if (!open) return;
        e.preventDefault();
        const target = e.key === "Home" ? 0 : items.length - 1;
        setActiveIndex(target);
        return;
      }
      case "Escape": {
        if (!open) return;
        e.preventDefault();
        close();
        return;
      }
      case "Tab": {
        // Let focus move on, but do not strand an orphaned popup.
        if (open) setOpen(false);
        return;
      }
      default: {
        // Type-ahead: jump to the first option starting with the typed prefix.
        if (!open || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key.length !== 1) return;
        const now = Date.now();
        const ta = typeAhead.current;
        ta.buffer = now - ta.at > 800 ? e.key : ta.buffer + e.key;
        ta.at = now;
        const needle = ta.buffer.toLowerCase();
        const found = items.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(needle));
        if (found >= 0) {
          e.preventDefault();
          setActiveIndex(found);
        }
      }
    }
  };

  // Track scroll/resize while open so the portalled list stays anchored.
  React.useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => reposition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, reposition]);

  // Close when focus or a click lands outside the trigger and the popup.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Keep the active option scrolled into view during keyboard navigation.
  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const labelNode =
    label && hideLabel ? (
      <span className="sr-only">{label}</span>
    ) : label ? (
      <label htmlFor={triggerId} className="text-sm font-medium text-purple-100">
        {label}
      </label>
    ) : null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {labelNode}

      <div className="relative">
        {/* A button control is not form-associated, so mirror the value into a
            hidden input for `new FormData(form)` consumers. */}
        {name ? <input type="hidden" name={name} value={value} /> : null}
        <button
          id={triggerId}
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? `${listboxId}-opt-${activeIndex}` : undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={cn(error && errorId, ariaDescribedBy) || undefined}
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-xl border text-left text-sm ring-offset-[#0B0514] transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
            size === "sm" ? "h-9 px-2" : "h-10 px-3 py-2",
            surface === "light"
              ? "border-amber-500/30 bg-white text-amber-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/30 hover:border-amber-500/50"
              : "bg-purple-950/30 text-purple-50 focus-visible:ring-purple-500 focus-visible:border-purple-500 hover:border-purple-700/70",
            error ? "border-red-500/60 focus-visible:ring-red-500" : undefined,
            !selected && !open && (surface === "light" ? "text-amber-900/50" : "text-purple-300/50"),
            triggerClassName
          )}
        >
          <span className="truncate">{selected ? (children ? children(selected) : selected.label) : placeholder}</span>
          <ChevronDown
            className={cn(
              "shrink-0 transition-transform duration-150",
              surface === "light" ? "text-amber-700" : "text-purple-300",
              size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
              open && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>

        {error && (
          <p id={errorId} className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Portalled so the list is never clipped by an ancestor's overflow or
          trapped beneath a modal's stacking context. */}
      {open && coords && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={label ? triggerId : undefined}
            tabIndex={-1}
            style={{
              top: coords.drop === "down" ? coords.top : undefined,
              bottom: coords.drop === "up" ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              minWidth: coords.width,
            }}
            className={cn(
              "fixed z-[9999] max-h-72 overflow-y-auto rounded-xl border p-1 shadow-2xl shadow-black/50",
              surface === "light"
                ? "border-amber-500/30 bg-white"
                : "border-purple-700/50 bg-[#150C28]",
              listboxClassName
            )}
          >
            {items.length === 0 ? (
              <div
                className={cn(
                  "px-3 py-2 text-sm",
                  surface === "light" ? "text-amber-900/60" : "text-purple-300/60"
                )}
              >
                No options
              </div>
            ) : (
              items.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === activeIndex;
                return (
                  <div
                    key={opt.value}
                    id={`${listboxId}-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled || undefined}
                    onClick={() => commit(opt)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                      opt.disabled && "cursor-not-allowed opacity-40",
                      surface === "light"
                        ? isActive
                          ? "bg-amber-500/20 text-amber-950"
                          : "text-amber-900 hover:bg-amber-500/10"
                        : isActive
                          ? "bg-purple-600/25 text-white"
                          : "text-purple-100 hover:bg-purple-600/10"
                    )}
                  >
                    <span className="truncate">{children ? children(opt) : opt.label}</span>
                    {isSelected && (
                      <Check
                        className={cn("h-4 w-4 shrink-0", surface === "light" ? "text-amber-700" : "text-purple-300")}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

Select.displayName = "Select";
