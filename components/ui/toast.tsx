"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  AlertCircle,
  TriangleAlert,
  Info,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types & defaults
// ---------------------------------------------------------------------------

export type ToastSeverity = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  description?: string;
  action?: ToastAction;
  /** Auto-dismiss ms. `null` = sticky. Defaults per severity (errors always sticky). */
  duration?: number | null;
}

interface ToastItem {
  id: number;
  severity: ToastSeverity;
  title: string;
  description?: string;
  action?: ToastAction;
  sticky: boolean;
  duration: number;
}

const DEFAULT_DURATIONS: Record<ToastSeverity, number | null> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: null, // errors are always sticky
};

const MAX_TOASTS = 3;

const SEVERITY_STYLE: Record<
  ToastSeverity,
  { border: string; icon: React.ElementType; iconClass: string }
> = {
  success: {
    border: "border-emerald-500/30",
    icon: CheckCircle2,
    iconClass: "text-emerald-400",
  },
  error: {
    border: "border-red-500/30",
    icon: AlertCircle,
    iconClass: "text-red-400",
  },
  warning: {
    border: "border-amber-500/30",
    icon: TriangleAlert,
    iconClass: "text-amber-300",
  },
  info: {
    border: "border-purple-500/30",
    icon: Info,
    iconClass: "text-purple-300",
  },
};

// ---------------------------------------------------------------------------
// Global dispatcher — works from any client component via `toast.success()`
// (Toaster is mounted once in the root layout, so it is always listening.)
// ---------------------------------------------------------------------------

type Emitter = (input: {
  id: number;
  severity: ToastSeverity;
  title: string;
  description?: string;
  action?: ToastAction;
  duration?: number | null;
}) => void;

const emitters = new Set<Emitter>();
const dismissers = new Set<(id: number) => void>();
let nextId = 1;

function emit(
  severity: ToastSeverity,
  title: string,
  opts: ToastOptions = {},
): number {
  if (emitters.size === 0) return -1;
  const id = nextId++;
  emitters.forEach((fn) =>
    fn({
      id,
      severity,
      title,
      description: opts.description,
      action: opts.action,
      duration: opts.duration,
    }),
  );
  return id;
}

export const toast = {
  success: (title: string, opts?: ToastOptions) =>
    emit("success", title, opts),
  error: (title: string, opts?: ToastOptions) => emit("error", title, opts),
  info: (title: string, opts?: ToastOptions) => emit("info", title, opts),
  warning: (title: string, opts?: ToastOptions) =>
    emit("warning", title, opts),
  dismiss: (id: number) => dismissers.forEach((fn) => fn(id)),
};

/** Hook flavour of the same API (identical to importing `toast` directly). */
export function useToast() {
  return React.useMemo(() => toast, []);
}

// ---------------------------------------------------------------------------
// Toaster viewport — mount once in the root layout
// ---------------------------------------------------------------------------

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const reduceMotion = useReducedMotion();

  const dismiss = React.useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const schedule = React.useCallback(
    (item: ToastItem) => {
      if (item.sticky) return;
      const timer = setTimeout(() => dismiss(item.id), item.duration);
      timers.current.set(item.id, timer);
    },
    [dismiss],
  );

  const push = React.useCallback(
    (input: {
      id: number;
      severity: ToastSeverity;
      title: string;
      description?: string;
      action?: ToastAction;
      duration?: number | null;
    }) => {
      const fallback = DEFAULT_DURATIONS[input.severity];
      // Errors are always sticky, even if a duration is passed.
      const duration =
        input.severity === "error"
          ? null
          : input.duration !== undefined
            ? input.duration
            : fallback;
      const item: ToastItem = {
        id: input.id,
        severity: input.severity,
        title: input.title,
        description: input.description,
        action: input.action,
        sticky: duration === null,
        duration: duration ?? 0,
      };
      // Cap the stack; oldest drops off (callers can re-toast if needed).
      setItems((prev) => [...prev.slice(-(MAX_TOASTS - 1)), item]);
      schedule(item);
    },
    [schedule],
  );

  // Subscribe this viewport to the global dispatcher. push/dismiss are
  // stable callbacks, so this subscribes once. (Toaster renders directly in
  // <body>, so `fixed` positions against the viewport — no portal needed.)
  React.useEffect(() => {
    emitters.add(push);
    dismissers.add(dismiss);
    return () => {
      emitters.delete(push);
      dismissers.delete(dismiss);
    };
  }, [push, dismiss]);

  // Clear all timers on unmount.
  React.useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  function pause(id: number) {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }

  function resume(item: ToastItem) {
    if (item.sticky || timers.current.has(item.id)) return;
    const timer = setTimeout(() => dismiss(item.id), item.duration);
    timers.current.set(item.id, timer);
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed z-[70] flex flex-col gap-2 max-md:inset-x-4 max-md:bottom-[calc(1rem+env(safe-area-inset-bottom))] md:bottom-6 md:right-6 md:w-[min(24rem,calc(100vw-3rem))] md:items-end"
    >
      <AnimatePresence>
        {items.map((item) => {
          const style = SEVERITY_STYLE[item.severity];
          const Icon = style.icon;
          return (
            <motion.div
              key={item.id}
              role={item.severity === "error" ? "alert" : "status"}
              layout={!reduceMotion}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 96 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.25 }}
              drag={reduceMotion ? false : "x"}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.8}
              onDragEnd={(_, info) => {
                if (Math.abs(info.offset.x) > 90) dismiss(item.id);
              }}
              onMouseEnter={() => pause(item.id)}
              onMouseLeave={() => resume(item)}
              className={cn(
                "pointer-events-auto flex w-full items-start gap-3 rounded-2xl border bg-[#0B0514]/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-md",
                style.border,
              )}
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", style.iconClass)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 text-xs leading-5 text-purple-200/70">
                    {item.description}
                  </p>
                )}
                {item.action && (
                  <button
                    type="button"
                    onClick={() => {
                      item.action?.onClick();
                      dismiss(item.id);
                    }}
                    className="mt-2 rounded-full border border-purple-500/30 bg-purple-600/20 px-3 py-1 text-xs font-medium text-purple-200 transition hover:bg-purple-600/30 hover:text-white"
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-purple-300/60 transition hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
