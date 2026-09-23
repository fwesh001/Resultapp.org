"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message?: string;
  /** Footnote under the message. Defaults to "This action cannot be undone."
   *  for danger variant; hidden for other variants unless provided. */
  note?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Preset confirmation dialog (e.g. deletes) built on Modal —
 * bottom sheet on mobile, focus-trapped, scroll-locked.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  note,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const danger = variant === "danger";
  const footnote = note ?? (danger ? "This action cannot be undone." : undefined);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={message}
      size="sm"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
            danger
              ? "border-red-500/30 bg-red-500/10"
              : "border-purple-500/30 bg-purple-500/10",
          )}
        >
          <TriangleAlert
            className={cn("h-5 w-5", danger ? "text-red-400" : "text-purple-300")}
          />
        </span>
        {footnote && (
          <p className="text-sm text-zinc-500">
            {footnote}
          </p>
        )}
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={loading}
          className="min-h-[48px] flex-1 sm:flex-none"
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          onClick={() => void onConfirm()}
          disabled={loading}
          className={cn(
            "min-h-[48px] flex-1 text-white sm:flex-none",
            danger
              ? "bg-red-600 hover:bg-red-500"
              : "bg-purple-600 hover:bg-purple-500",
          )}
        >
          {loading ? "Working..." : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
