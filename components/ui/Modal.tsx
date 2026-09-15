"use client";

import * as React from "react";
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
}

export function Modal({ open, onOpenChange, title, description, children, className }: ModalProps) {
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      {/* Content */}
      <div
        className={cn(
          "relative z-50 w-full max-w-lg rounded-xl border bg-white p-6 shadow-lg dark:bg-zinc-900",
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 h-8 w-8"
          onClick={() => onOpenChange(false)}
          aria-label="Close modal"
        >
          <X className="h-4 w-4" />
        </Button>

        {(title || description) && (
          <div className="mb-4 pr-8">
            {title && <h3 className="text-lg font-semibold">{title}</h3>}
            {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
          </div>
        )}

        <div>{children}</div>
      </div>
    </div>
  );
}
