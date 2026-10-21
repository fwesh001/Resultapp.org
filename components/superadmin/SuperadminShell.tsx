"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Menu, X } from "lucide-react";
import SuperadminSidebar from "@/components/superadmin/SuperadminSidebar";
import ThemeToggle from "@/components/theme/ThemeToggle";
import type { PlatformPageId } from "@/lib/platformPages";

interface Props {
  children: React.ReactNode;
  /** Resolved page scope — see SuperadminSidebar.allowedPages. */
  allowedPages?: readonly PlatformPageId[] | null;
  viewerLabel?: string | null;
}

/** Responsive shell mirroring AdminShell: fixed sidebar on md+, drawer on mobile. */
export default function SuperadminShell({ children, allowedPages = null, viewerLabel = null }: Props) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>("a[href], button:not([disabled])");
    firstFocusable?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open ]);

  return (
    <div className="flex h-screen bg-surface-0 text-text-1">
      <div className="hidden md:flex">
        <SuperadminSidebar allowedPages={allowedPages} viewerLabel={viewerLabel} />
      </div>

      {open && (
        <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="Superadmin menu" className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute left-0 top-0 h-full shadow-2xl">
            <SuperadminSidebar allowedPages={allowedPages} viewerLabel={viewerLabel} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line-1 bg-surface-0/90 px-4 py-3 backdrop-blur-md md:hidden">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-line-1 p-2 text-text-2 transition hover:bg-surface-2"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link href="/superadmin" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:opacity-90">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-1 bg-surface-1">
              <ShieldCheck className="h-4 w-4 text-accent" />
            </span>
            <span className="truncate text-sm font-semibold tracking-tight">Command Center</span>
          </Link>
          <ThemeToggle />
        </div>

        {/* Desktop top header. Added alongside the toggle: the Command Center
            had no desktop header at all, so the theme switch had nowhere to
            live on md+ and would have been unreachable. Mirrors AdminShell. */}
        <div className="relative z-40 hidden items-center justify-end border-b border-line-1 bg-surface-0/90 px-6 py-3 backdrop-blur-md md:flex">
          <ThemeToggle />
        </div>

        <main className="flex-1 overflow-y-auto bg-surface-0">{children}</main>
      </div>
    </div>
  );
}
