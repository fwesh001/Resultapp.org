"use client";

import {
  AlertCircle,
  CalendarX,
  Lock,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export type ReportErrorIcon = "not-found" | "term" | "unpublished" | "alert";

export interface ReportErrorAction {
  label: string;
  /** Hard route (preferred — direct links from email/WhatsApp have no history). */
  href?: string;
  onClick?: () => void;
  variant?: "solid" | "outline";
}

interface Props {
  title: string;
  description: React.ReactNode;
  icon?: ReportErrorIcon;
  actions?: ReportErrorAction[];
  footnote?: React.ReactNode;
}

const ICONS: Record<ReportErrorIcon, LucideIcon> = {
  "not-found": SearchX,
  term: CalendarX,
  unpublished: Lock,
  alert: AlertCircle,
};

/**
 * Shared full-page error state for the public result checker.
 * Used for Student Not Found, Term Not Available, and Result Not Published.
 *
 * Routing rule: actions hard-route to `/{tenantId}`-style hrefs — never
 * `router.back()`, since direct links from emails/WhatsApp have no history.
 */
export function ReportErrorState({ title, description, icon = "alert", actions = [], footnote }: Props) {
  const Icon = ICONS[icon] ?? AlertCircle;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-center shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
          <Icon className="h-6 w-6 text-amber-400" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-amber-900">{title}</h2>
        <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-amber-800">{description}</div>
        {actions.length > 0 && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {actions.map((a) =>
              a.variant === "outline" ? (
                <Button
                  key={a.label}
                  onClick={a.onClick ?? (() => {
                    if (a.href) window.location.href = a.href;
                  })}
                  variant="outline"
                  className="gap-2 rounded-full border-amber-500/20 bg-white text-amber-900 hover:bg-amber-50"
                >
                  {a.label}
                </Button>
              ) : (
                <Button
                  key={a.label}
                  onClick={a.onClick ?? (() => {
                    if (a.href) window.location.href = a.href;
                  })}
                  className="gap-2 rounded-full bg-amber-600 text-white hover:bg-amber-500"
                >
                  {a.label}
                </Button>
              ),
            )}
          </div>
        )}
        {footnote && <div className="mt-4 text-xs text-amber-700/60">{footnote}</div>}
      </div>
    </div>
  );
}
