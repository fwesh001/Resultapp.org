"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import NotificationBell from "@/components/notifications/NotificationBell";
import { toTitleCase } from "@/lib/format";

interface AdminShellProps {
  subdomain: string;
  schoolName: string;
  /**
   * The tenant's uploaded crest (absolute Blob URL). Absent for a school that
   * never uploaded one, in which case <Logo> renders a neutral cap rather than
   * the ResultApp mark — a school with no branding must not look branded.
   */
  logoUrl?: string;
  children: React.ReactNode;
}

/**
 * Responsive admin shell: fixed sidebar on md+ screens,
 * hamburger drawer overlay on smaller screens.
 */
export default function AdminShell({
  subdomain,
  schoolName,
  logoUrl,
  children,
}: AdminShellProps) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Escape to close + initial focus when the mobile drawer opens.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    firstFocusable?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open ]);

  return (
    <div className="flex h-screen bg-[#0B0514] text-white">
      {/* Desktop sidebar — fixed on md and up */}
      <div className="hidden md:flex">
        <AdminSidebar
          subdomain={subdomain}
          schoolName={schoolName}
          logoUrl={logoUrl}
        />
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${toTitleCase(schoolName)} admin menu`}
          className="fixed inset-0 z-50 md:hidden"
        >
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 h-full shadow-2xl">
            <AdminSidebar
              subdomain={subdomain}
              schoolName={schoolName}
              logoUrl={logoUrl}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top nav bar */}
        <div className="relative z-40 flex items-center gap-3 border-b border-purple-500/20 bg-[#0B0514]/90 px-4 py-3 backdrop-blur-md md:hidden">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-purple-500/20 p-2 text-purple-200 transition hover:bg-purple-900/20"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link
            href={`/${subdomain}`}
            aria-label={`${toTitleCase(schoolName)} school portal`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:opacity-90"
          >
            <Logo size="sm" src={logoUrl} alt="" className="rounded-full" />
            <span className="truncate text-sm font-semibold tracking-tight">
              {toTitleCase(schoolName)}
            </span>
          </Link>
          <NotificationBell tenantId={subdomain} portal="admin" />
        </div>

        {/* Desktop top header */}
        <div className="relative z-40 hidden items-center justify-end border-b border-purple-500/20 bg-[#0B0514]/90 px-6 py-3 backdrop-blur-md md:flex">
          <NotificationBell tenantId={subdomain} portal="admin" />
        </div>

        <main className="flex-1 overflow-y-auto bg-[#0B0514]">{children}</main>
      </div>
    </div>
  );
}
