"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import AdminSidebar, { type PortalSegment } from "@/components/admin/AdminSidebar";
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
  /**
   * RBAC. Supplied by the dashboard layout from the verified session.
   * `isModerator` gates admin-only nav entries and the audit/settings/billing
   * links; `capabilities` is the moderator's allow-list. Absent on a plain
   * admin session, which the sidebar reads as "show everything".
   */
  isModerator?: boolean;
  capabilities?: readonly string[];
  /** Who is signed in — staff_id, name or email, for the moderator badge. */
  actorLabel?: string | null;
  children: React.ReactNode;
  /**
   * Route segment this shell renders inside. Defaults to "admin" so the admin
   * portal is unaffected.
   *
   * Threaded to the sidebar (hrefs + branding copy) and to the notification
   * bell (link destination). Note the bell's `portal` stays "admin" even for the
   * moderator console: the derived moderator session is stored in the ADMIN
   * cookie, so that is the identity the inbox must read. Only the LINK differs.
   */
  portal?: PortalSegment;
}

/**
 * Responsive admin shell: fixed sidebar on md+ screens,
 * hamburger drawer overlay on smaller screens.
 */
export default function AdminShell({
  subdomain,
  schoolName,
  logoUrl,
  isModerator = false,
  capabilities,
  actorLabel,
  children,
  portal = "admin",
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
    <div className="flex h-screen bg-surface-0 text-text-1">
      {/* Desktop sidebar — fixed on md and up */}
      <div className="hidden md:flex">
        <AdminSidebar
          subdomain={subdomain}
          schoolName={schoolName}
          logoUrl={logoUrl}
          isModerator={isModerator}
          capabilities={capabilities}
          actorLabel={actorLabel}
          portal={portal}
        />
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${toTitleCase(schoolName)} ${
            portal === "moderator" ? "moderator" : "admin"
          } menu`}
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
              isModerator={isModerator}
              capabilities={capabilities}
              actorLabel={actorLabel}
              portal={portal}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top nav bar */}
        <div className="relative z-40 flex items-center gap-3 border-b border-line-1 bg-surface-0/90 px-4 py-3 backdrop-blur-md md:hidden">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-line-1 p-2 text-text-2 transition hover:bg-surface-2"
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
          <NotificationBell
            tenantId={subdomain}
            portal="admin"
            notificationsPath={`/${subdomain}/${portal}/notifications`}
          />
        </div>

        {/* Desktop top header */}
        <div className="relative z-40 hidden items-center justify-end border-b border-line-1 bg-surface-0/90 px-6 py-3 backdrop-blur-md md:flex">
          <NotificationBell
            tenantId={subdomain}
            portal="admin"
            notificationsPath={`/${subdomain}/${portal}/notifications`}
          />
        </div>

        <main className="flex-1 overflow-y-auto bg-surface-0">{children}</main>
      </div>
    </div>
  );
}
