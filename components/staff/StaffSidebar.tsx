"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, GraduationCap, Users, LogOut } from "lucide-react";
import { toTitleCase } from "@/lib/format";

interface StaffSidebarProps {
  subdomain: string;
  schoolName: string;
  onNavigate?: () => void;
}

const nav = [
  { label: "Dashboard", href: "", icon: LayoutDashboard },
  { label: "My Grading", href: "/grading", icon: GraduationCap },
  { label: "Allocations", href: (sub: string) => `/${sub}/admin/allocations`, icon: Users, external: true },
] as const;

export default function StaffSidebar({ subdomain, schoolName, onNavigate }: StaffSidebarProps) {
  const pathname = usePathname();
  const base = `/${subdomain}/staff`;
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-purple-500/20 bg-[#0B0514]/90 backdrop-blur-md">
      <div className="border-b border-purple-500/20 px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-purple-500/20 bg-purple-900/20">
            <GraduationCap className="h-5 w-5 text-purple-300" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">{toTitleCase(schoolName)}</p>
            <p className="text-xs text-purple-300/60">Staff Portal</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {nav.map((item) => {
          const href = typeof item.href === "function" ? (item.href as (s: string) => string)(subdomain) : `${base}${item.href}`;
          const isExternal = (item as unknown as { external?: boolean }).external;
          const isActive = !isExternal && (pathname === href || (item.href === "" && pathname === base));
          const Icon = item.icon;
          if (isExternal) {
            return (
              <Link key={item.label} href={href} onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-white">
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          }
          return (
            <Link
              key={item.label}
              href={href}
              onClick={onNavigate}
              className={
                isActive
                  ? "flex items-center gap-3 rounded-lg border-r-2 border-purple-500 bg-purple-600/20 px-3 py-2.5 text-sm font-medium text-purple-300"
                  : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-white"
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-purple-500/20 p-4">
        <a href={`/${subdomain}/staff/login`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white">
          <LogOut className="h-4 w-4" /> Sign out
        </a>
      </div>
    </aside>
  );
}
