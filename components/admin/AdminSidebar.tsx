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
} from "lucide-react";
import { toTitleCase } from "@/lib/format";

interface AdminSidebarProps {
  subdomain: string;
  schoolName: string;
  /** The tenant's uploaded crest. Absent -> neutral cap (never the ResultApp mark). */
  logoUrl?: string;
  onNavigate?: () => void;
}

export default function AdminSidebar({
  subdomain,
  schoolName,
  logoUrl,
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
  const nav = [
    {
      label: "Dashboard",
      href: `/${subdomain}/admin`,
      icon: LayoutDashboard,
    },
    {
      label: "Results",
      href: `/${subdomain}/admin/results`,
      icon: ClipboardCheck,
    },
    {
      label: "Allocations",
      href: `/${subdomain}/admin/allocations`,
      icon: Users,
    },
    {
      label: "Clearance",
      href: `/${subdomain}/admin/clearance`,
      icon: Wallet,
    },
    {
      label: "Templates",
      href: `/${subdomain}/admin/templates`,
      icon: BookOpen,
    },
    {
      label: "Settings",
      href: `/${subdomain}/admin/settings`,
      icon: Settings,
    },
    {
      label: "Billing",
      href: `/${subdomain}/admin/billing`,
      icon: CreditCard,
    },
    {
      label: "Notifications",
      href: `/${subdomain}/admin/notifications`,
      icon: Bell,
    },
    // Support lives on the apex domain, so this is an absolute href rather
    // than a tenant-scoped route.
    {
      label: "Support",
      href: "/support",
      icon: LifeBuoy,
    },
  ];

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
        {nav.map((item) => {
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
