"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Settings,
  CreditCard,
  GraduationCap,
} from "lucide-react";
import { toTitleCase } from "@/lib/format";

interface AdminSidebarProps {
  subdomain: string;
  schoolName: string;
  onNavigate?: () => void;
}

export default function AdminSidebar({
  subdomain,
  schoolName,
  onNavigate,
}: AdminSidebarProps) {
  const pathname = usePathname();

  const nav = [
    {
      label: "Dashboard",
      href: `/${subdomain}/admin`,
      icon: LayoutDashboard,
    },
    {
      label: "Allocations",
      href: `/${subdomain}/admin/allocations`,
      icon: Users,
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
  ];

  function isActive(href: string): boolean {
    if (href.endsWith("/admin")) {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-purple-500/20 bg-[#0B0514]/90 backdrop-blur-md">
      <div className="flex items-center gap-2.5 border-b border-purple-500/20 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-purple-500/20 bg-purple-900/20">
          <GraduationCap className="h-5 w-5 text-purple-300" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            {toTitleCase(schoolName)}
          </p>
          <p className="text-xs text-purple-300/50">Admin Portal</p>
        </div>
      </div>

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
                  ? "flex items-center gap-3 rounded-lg border-r-2 border-purple-500 bg-purple-600/20 px-3 py-2.5 text-sm font-medium text-purple-300"
                  : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white"
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-purple-500/20 p-4">
        <Link
          href={`/${subdomain}`}
          onClick={onNavigate}
          className="block rounded-lg px-3 py-2 text-xs text-zinc-500 transition hover:bg-white/5 hover:text-white"
        >
          ← Back to school portal
        </Link>
      </div>
    </aside>
  );
}
