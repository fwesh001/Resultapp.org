"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  ReceiptText,
  Bell,
  LifeBuoy,
  Activity,
  Settings,
  ShieldCheck,
  LogOut,
  Ticket,
  Coins,
  Users,
  ExternalLink,
} from "lucide-react";
import { PLATFORM_PAGE_LABELS, type PlatformPageId } from "@/lib/platformPages";

interface Props {
  onNavigate?: () => void;
  /**
   * Command Center pages the signed-in member may open (from the DB, via the
   * layout). NULL only when no scope was resolved — the sidebar then shows
   * nothing except Dashboard so a degraded backend never looks like a full
   * page list; each guarded page itself returns the denied screen. Legacy dev
   * sessions receive a full list from the layout, so they see everything.
   */
  allowedPages?: readonly PlatformPageId[] | null;
  /** Signed-in identity chip — "you know whose session this is". */
  viewerLabel?: string | null;
}

const nav: Array<{ id: PlatformPageId; href: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "dashboard", href: "/superadmin", icon: LayoutDashboard },
  { id: "tenants", href: "/superadmin/tenants", icon: Building2 },
  { id: "adjustments", href: "/superadmin/adjustments", icon: Coins },
  { id: "tickets", href: "/superadmin/tickets", icon: LifeBuoy },
  { id: "ledger", href: "/superadmin/ledger", icon: ReceiptText },
  // Waiver tokens beside Ledger rather than under Settings: a waiver token is
  // a revenue instrument, so it belongs next to the ledger where the MRR it
  // gives away is visible, not buried in platform tunables.
  { id: "waivers", href: "/superadmin/waivers", icon: Ticket },
  { id: "notifications", href: "/superadmin/notifications", icon: Bell },
  { id: "vitals", href: "/superadmin/vitals", icon: Activity },
  { id: "settings", href: "/superadmin/settings", icon: Settings },
  { id: "team", href: "/superadmin/team", icon: Users },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/superadmin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SuperadminSidebar({ onNavigate, allowedPages, viewerLabel }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const pages = allowedPages ?? null;
  // Dashboard is the denial landing page — always present when a scope list
  // was resolved, so a member who hits a denied screen still has somewhere to
  // navigate. null = nothing was resolved (degraded backend): show only the
  // header and sign-out, with no nav links pretending to exist.
  const visible =
    pages === null
      ? nav.filter((item) => item.id === "dashboard")
      : nav.filter((item) => pages.includes(item.id));

  async function handleSignOut() {
    try {
      await fetch("/api/superadmin/logout", { method: "POST" });
    } catch {
      // best-effort
    }
    onNavigate?.();
    router.push("/superadmin/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line-1 bg-surface-0/90 backdrop-blur-md">
      <div className="flex items-center gap-2.5 border-b border-line-1 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-1 bg-surface-1">
          <ShieldCheck className="h-5 w-5 text-accent" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-text-1">ResultApp</p>
          <p className="text-xs text-text-3">Command Center</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visible.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          const title = PLATFORM_PAGE_LABELS[item.id];
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              title={title}
              className={
                active
                  ? "flex items-center gap-3 rounded-lg border-r-2 border-accent bg-accent-soft px-3 py-2.5 text-sm font-medium text-accent"
                  : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-2 transition hover:bg-surface-2 hover:text-text-1"
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line-1 p-4">
        {viewerLabel ? (
          <p className="mb-1 truncate px-3 pb-1 text-xs text-text-3">
            Signed in as <span className="text-text-2">{viewerLabel}</span>
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-2 transition hover:bg-surface-2 hover:text-text-1"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
        {/* Below Sign out, mirroring the school AdminSidebar's
            "← Back to school portal": the Command Center sits on the same
            domain as the marketing site, and this is the one-tap way home. */}
        <Link
          href="/"
          onClick={onNavigate}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-text-3 transition hover:bg-surface-2 hover:text-text-1"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Back to site
        </Link>
      </div>
    </aside>
  );
}
