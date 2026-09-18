"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Dialog width on md+ screens. Defaults to "md" (matches the previous max-w-lg). */
  size?: "sm" | "md" | "lg";
  /** Allow Escape / backdrop / X dismissal. Defaults to true. */
  dismissible?: boolean;
  /** Render as a bottom sheet on small screens. Defaults to true. */
  sheetOnMobile?: boolean;
}

const SIZES = {
  sm: "md:max-w-sm",
  md: "md:max-w-lg",
  lg: "md:max-w-2xl",
} as const;

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  size = "md",
  dismissible = true,
  sheetOnMobile = true,
}: ModalProps) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  const close = React.useCallback(() => {
    if (dismissible) onOpenChange(false);
  }, [dismissible, onOpenChange]);

  // Escape to close.
  React.useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, close]);

  // Body scroll lock + focus management (trap + restore).
  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const node = contentRef.current;
    const first = node ? focusables(node)[0] : null;
    (first ?? node)?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !contentRef.current) return;
      const items = focusables(contentRef.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", handleTab);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleTab);
      previouslyFocused.current?.focus();
    };
  }, [open ]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex justify-center",
            sheetOnMobile ? "items-end md:items-center" : "items-center",
          )}
        >
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={close}
            aria-hidden="true"
          />
          {/* Content */}
          <motion.div
            ref={contentRef}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 48 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 32 }}
            transition={{ duration: reduceMotion ? 0.1 : 0.25 }}
            className={cn(
              "relative z-50 max-h-[92dvh] w-full overflow-y-auto border bg-white p-6 shadow-lg dark:bg-zinc-900",
              sheetOnMobile
                ? "rounded-t-3xl pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:rounded-xl md:pb-6"
                : "rounded-xl",
              SIZES[size],
              className,
            )}
            role="dialog"
            aria-modal="true"
          >
            {sheetOnMobile && (
              <div
                className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/15 md:hidden"
                aria-hidden="true"
              />
            )}
            {dismissible && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 h-11 w-11"
                onClick={() => onOpenChange(false)}
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </Button>
            )}

            {(title || description) && (
              <div className="mb-4 pr-8">
                {title && <h3 className="text-lg font-semibold">{title}</h3>}
                {description && (
                  <p className="mt-1 text-sm text-zinc-500">{description}</p>
                )}
              </div>
            )}

            <div>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
