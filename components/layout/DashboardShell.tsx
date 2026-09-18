"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sidebar, dashboardNavItems } from "@/components/layout/Sidebar";

interface DashboardShellProps {
  children: React.ReactNode;
}

/**
 * Responsive shell for the legacy /dashboard area: fixed sidebar on md+
 * screens, accessible hamburger drawer on smaller screens (mirrors the
 * AdminShell / StaffShell pattern).
 */
export function DashboardShell({ children }: DashboardShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);

  // Escape to close + initial focus when the mobile drawer opens.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    firstFocusable?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open ]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 md:flex-row">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-white px-4 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border p-2 text-zinc-700 transition hover:bg-zinc-100"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white">
          <GraduationCap className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold">resultapp</span>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Dashboard menu"
          className="fixed inset-0 z-50 md:hidden"
        >
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 flex h-full w-64 flex-col border-r bg-white shadow-2xl">
            <div className="flex h-16 items-center gap-2 border-b px-6 font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white">
                <GraduationCap className="h-5 w-5" />
              </span>
              resultapp
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
              {dashboardNavItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-black text-white"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-black",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Desktop sidebar (self-hides below md) */}
      <Sidebar />

      <main className="flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
