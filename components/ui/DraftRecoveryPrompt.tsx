"use client";

import { CloudOff, Save, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export interface DraftRecoveryPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many students/fields the draft covers, for a concrete message. */
  entryCount: number;
  savedAt: number | null;
  term: string;
  /** True when the draft came from the pre-v1 bare-object format. */
  legacy?: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

function relativeTime(ts: number | null): string {
  if (!ts) return "earlier";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "moments ago";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * "Unsaved draft found. Restore?" prompt.
 *
 * Shown when a localStorage draft exists for the class/subject/term being
 * opened. This replaces the previous behaviour of silently merging the draft
 * over server grades, which could overwrite a colleague's marks with stale
 * local data.
 *
 * Restore is the PRIMARY action (renders first, gets the solid button) to
 * relieve the "tab just closed" panic, while Discard remains a clear,
 * equally-reachable option — the choice is never hidden behind a default.
 */
export function DraftRecoveryPrompt({
  open,
  onOpenChange,
  entryCount,
  savedAt,
  term,
  legacy = false,
  onRestore,
  onDiscard,
}: DraftRecoveryPromptProps) {
  const count = Math.max(0, entryCount);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Unsaved draft found"
      variant="default"
      confirmLabel={`Restore ${count} ${count === 1 ? "entry" : "entries"}`}
      cancelLabel="Discard draft"
      onConfirm={onRestore}
      message={`An unsaved draft with ${count} ${count === 1 ? "entry" : "entries"} was found on this device${savedAt ? `, saved ${relativeTime(savedAt)}` : ""}. Restore it, or keep the values already stored on the server.`}
      note={
        legacy
          ? "This draft was saved by an earlier version of the app and has no timestamp or term recorded. Restoring is safe — it only fills the fields you see."
          : `Restoring replaces the values shown for ${term} on this device only. Nothing is published to the server until you press Save.`
      }
    />
  );
}

/**
 * Compact inline variant for surfaces that already own a modal and only need a
 * small restore affordance rather than a blocking dialog.
 */
export function DraftRecoveryBanner({
  entryCount,
  savedAt,
  onRestore,
  onDismiss,
  className,
}: {
  entryCount: number;
  savedAt: number | null;
  onRestore: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const count = Math.max(0, entryCount);
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100",
        className,
      )}
    >
      <CloudOff className="h-4 w-4 shrink-0 text-amber-300" />
      <span className="min-w-0 flex-1">
        Unsaved draft found — {count} {count === 1 ? "entry" : "entries"}
        {savedAt ? ` from ${relativeTime(savedAt)}` : ""}.
      </span>
      <span className="flex items-center gap-2">
        <Button
          type="button"
          onClick={onRestore}
          size="sm"
          className="gap-1.5 rounded-full bg-amber-600 text-xs font-semibold text-white hover:bg-amber-500"
        >
          <Save className="h-3.5 w-3.5" /> Restore
        </Button>
        <Button
          type="button"
          onClick={onDismiss}
          size="sm"
          variant="outline"
          className="gap-1.5 rounded-full border-amber-500/25 bg-transparent text-xs text-amber-200 hover:bg-amber-500/15"
        >
          <Trash2 className="h-3.5 w-3.5" /> Discard
        </Button>
      </span>
    </div>
  );
}
