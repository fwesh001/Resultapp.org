"use client";

import { Logo } from "@/components/brand/Logo";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Settings,
  CreditCard,
  ClipboardCheck,
  Wallet,
  Bell,
  LifeBuoy,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { toTitleCase } from "@/lib/format";

interface AdminSidebarProps {
  subdomain: string;
  schoolName: string;
  /** The tenant's uploaded crest. Absent -> neutral cap (never the ResultApp mark). */
  logoUrl?: string;
  isModerator?: boolean;
  capabilities?: readonly string[];
  /** Who is signed in, for the moderator badge. */
  actorLabel?: string | null;
  onNavigate?: () => void;
}

export default function AdminSidebar({
  subdomain,
  schoolName,
  logoUrl,
  isModerator = false,
  capabilities,
  actorLabel,
  onNavigate,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Cookie clear is best-effort; still navigate to login.
    }
    onNavigate?.();
    router.push(`/${subdomain}/admin/login`);
    router.refresh();
  }

  // Order follows the admin's actual workflow: see the results you must publish
  // and clear, then the roster data that feeds them, then templates, then the
  // account-level settings, and only last the things you visit occasionally.
  //
  // `capability` is the guard each entry carries. Hiding an entry is UX, not
  // security — the page and the proxy are what actually refuse (see
  // lib/enforceCapability). Hiding it too keeps a moderator from a dead link
  // that lands on a 403 with no explanation.
  const nav = [
    {
      label: "Dashboard",
      href: `/${subdomain}/admin`,
      icon: LayoutDashboard,
      capability: "dashboard",
    },
    {
      label: "Results",
      href: `/${subdomain}/admin/results`,
      icon: ClipboardCheck,
      capability: "results",
    },
    {
      label: "Allocations",
      href: `/${subdomain}/admin/allocations`,
      icon: Users,
      capability: "allocations",
    },
    {
      label: "Clearance",
      href: `/${subdomain}/admin/clearance`,
      icon: Wallet,
      capability: "clearance",
    },
    {
      label: "Templates",
      href: `/${subdomain}/admin/templates`,
      icon: BookOpen,
      capability: "templates",
    },
    {
      label: "Audit Log",
      href: `/${subdomain}/admin/audit`,
      icon: ShieldCheck,
      capability: "audit",
    },
    {
      label: "Settings",
      href: `/${subdomain}/admin/settings`,
      icon: Settings,
      capability: "settings",
    },
    {
      label: "Billing",
      href: `/${subdomain}/admin/billing`,
      icon: CreditCard,
      capability: "billing",
    },
    {
      label: "Notifications",
      href: `/${subdomain}/admin/notifications`,
      icon: Bell,
      capability: "notifications",
    },
    // Support lives on the apex domain, so this is an absolute href rather
    // than a tenant-scoped route.
    {
      label: "Support",
      href: "/support",
      icon: LifeBuoy,
    },
  ];

  const visibleNav = nav.filter((item) => {
    // Support has no tenant-scoped guard — everyone gets it.
    const cap = (item as { capability?: string }).capability;
    if (!cap) return true;
    return isModerator ? (capabilities || []).includes(cap) : true;
  });

  function isActive(href: string): boolean {
    if (href.endsWith("/admin")) {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line-1 bg-surface-0/90 backdrop-blur-md">
      <Link
        href={`/${subdomain}`}
        onClick={onNavigate}
        aria-label={`${toTitleCase(schoolName)} school portal`}
        className="flex items-center gap-2.5 border-b border-line-1 px-5 py-5 transition hover:bg-surface-2"
      >
        <Logo size="sm" src={logoUrl} alt="" className="rounded-full" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-text-1">
            {toTitleCase(schoolName)}
          </p>
          <p className="text-xs text-text-3">Admin Portal</p>
        </div>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onNavigate}
              className={
                active
                  ? "flex items-center gap-3 rounded-lg border-r-2 border-accent bg-accent-soft px-3 py-2.5 text-sm font-medium text-accent"
                  : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-2 transition hover:bg-surface-2 hover:text-text-1"
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-line-1 p-4">
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-2 transition hover:bg-surface-2 hover:text-text-1"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
        <Link
          href={`/${subdomain}`}
          onClick={onNavigate}
          className="block rounded-lg px-3 py-2 text-xs text-text-3 transition hover:bg-surface-2 hover:text-text-1"
        >
          ← Back to school portal
        </Link>
      </div>
    </aside>
  );
}
