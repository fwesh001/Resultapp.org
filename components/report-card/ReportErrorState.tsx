"use client";

import {
  AlertCircle,
  CalendarX,
  CloudOff,
  Lock,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export type ReportErrorIcon =
  | "not-found"
  | "term"
  | "unpublished"
  | "not-available"
  | "transport"
  | "alert";

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
  /**
   * Optional inline term chooser. Rendered only for public "result not
   * available" states so a visitor who landed on an unpublished default term
   * can pick another one without a new backend endpoint. Omit for every other
   * state — the term bar above the card is the normal way to switch.
   */
  termSelector?: React.ReactNode;
}

const ICONS: Record<ReportErrorIcon, LucideIcon> = {
  "not-found": SearchX,
  term: CalendarX,
  unpublished: Lock,
  "not-available": Lock,
  transport: CloudOff,
  alert: AlertCircle,
};

/**
 * Shared full-page error state for the public result checker.
 * Used for Student Not Found, Term Not Available, Result Not Published,
 * Result Not Available, and transport failures.
 *
 * Routing rule: actions hard-route to `/{tenantId}`-style hrefs — never
 * `router.back()`, since direct links from emails/WhatsApp have no history.
 *
 * AUTHORITY RULE: this component is deliberately presentational. It has no
 * knowledge of who the viewer is and must never render admin-only affordances
 * (the Result Command Center, publication controls, credit actions). All
 * viewer scoping is decided upstream in the page + StudentReportCard state
 * machine, which collapses admin UI into a single `adminDraft` branch.
 */
export function ReportErrorState({ title, description, icon = "alert", actions = [], footnote, termSelector }: Props) {
  const Icon = ICONS[icon] ?? AlertCircle;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-center shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
          <Icon className="h-6 w-6 text-amber-400" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-amber-900">{title}</h2>
        <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-amber-800">{description}</div>
        {termSelector && (
          <div className="mx-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-2">
            {termSelector}
          </div>
        )}
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
