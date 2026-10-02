"use client";

import { CloudOff, HardDriveDownload, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NetworkIndicatorProps {
  /** null = not yet determined; rendered as a neutral state, never "offline". */
  isOnline: boolean | null;
  /** True while a draft write is queued to localStorage. */
  isPendingWrite?: boolean;
  /** False when localStorage is unavailable — worth surfacing on mobile. */
  persistenceAvailable?: boolean;
  className?: string;
}

/**
 * Online/offline + draft-persistence pill for the grading modal.
 *
 * Intent: a teacher who has deliberately switched data off should feel
 * reassured, not alarmed. So the offline state reads "Saved on this device",
 * which is the reassuring truth — their keystrokes ARE persisted — rather than
 * an error state.
 */
export function NetworkIndicator({
  isOnline,
  isPendingWrite = false,
  persistenceAvailable = true,
  className,
}: NetworkIndicatorProps) {
  const undetermined = isOnline === null;

  // "Saving to device" means genuinely offline. Undetermined stays neutral so
  // hydration does not flash a false state.
  const offline = isOnline === false;
  const tone = undetermined
    ? "border-purple-500/25 bg-purple-500/10 text-purple-200/80"
    : offline
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";

  const Icon = undetermined ? HardDriveDownload : offline ? CloudOff : Wifi;

  const label = undetermined
    ? "Checking connection"
    : offline
      ? "Offline — saving to this device"
      : "Online";

  const title = undetermined
    ? "Checking your connection…"
    : offline
      ? "No connection. Scores are saved on this device and will be published when you reconnect and press Save."
      : "Connected. Scores save to the server when you press Save.";

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "inline-flex min-h-[28px] items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
          tone,
        )}
        title={title}
        role="status"
        aria-live="polite"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="whitespace-nowrap">{label}</span>
      </span>

      {!persistenceAvailable && (
        <span
          className="inline-flex min-h-[28px] items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 text-[11px] font-medium text-red-200"
          title="This browser is blocking local storage (private mode or storage full), so drafts cannot be kept if the tab closes. Keep this tab open."
          role="status"
        >
          Drafts unavailable
        </span>
      )}

      {isPendingWrite && persistenceAvailable && (
        <span
          className="text-[11px] text-purple-300/50"
          title="Your latest keystrokes are being written to this device."
        >
          saving…
        </span>
      )}
    </span>
  );
}
