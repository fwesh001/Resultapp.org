"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, ExternalLink, Power, Trash2 } from "lucide-react";

export interface TenantMenuTarget {
  subdomain: string;
  school_name: string;
  suspended: boolean;
  deleted?: boolean;
}

interface Props {
  tenant: TenantMenuTarget;
  onSuspend: (tenant: TenantMenuTarget) => void;
  onDelete: (tenant: TenantMenuTarget) => void;
  onRestore?: (tenant: TenantMenuTarget) => void;
}

/** Lightweight row actions dropdown (no menu library in the repo). */
export function TenantRowMenu({ tenant, onSuspend, onDelete, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open ]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Actions for ${tenant.subdomain}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-purple-500/15 bg-purple-900/10 text-purple-200 transition hover:bg-purple-900/20 hover:text-white"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-xl border border-purple-500/20 bg-[#150A26] shadow-2xl"
        >
          <a
            role="menuitem"
            href={`https://${tenant.subdomain}.resultapp.org`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-xs text-purple-100 transition hover:bg-white/5 hover:text-white"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Visit Portal
          </a>
          {tenant.deleted ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onRestore?.(tenant);
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-emerald-200 transition hover:bg-white/5"
            >
              <Power className="h-3.5 w-3.5" /> Restore School
            </button>
          ) : (
            <>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSuspend(tenant);
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-purple-100 transition hover:bg-white/5 hover:text-white"
              >
                <Power className="h-3.5 w-3.5" /> {tenant.suspended ? "Activate" : "Suspend"}
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDelete(tenant);
                }}
                className="flex w-full items-center gap-2 border-t border-red-500/10 px-4 py-2.5 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete School
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
