"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FileBarChart,
  CreditCard,
  Settings,
  GraduationCap,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const dashboardNavItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/students", label: "Students", icon: Users },
  { href: "/dashboard/results", label: "Results", icon: FileBarChart },
  { href: "/dashboard/upload", label: "Upload Scores", icon: Upload },
  { href: "/dashboard/credits", label: "Credits & Billing", icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const navItems = dashboardNavItems;

export function Sidebar({ creditBalance }: { creditBalance?: number | null }) {
  const pathname = usePathname();
  const hasBalance = typeof creditBalance === "number" && Number.isFinite(creditBalance);

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-white md:flex md:flex-col">
      <div className="flex h-16 items-center gap-2 border-b px-6 font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white">
          <GraduationCap className="h-5 w-5" />
        </span>
        resultapp
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-black text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-black"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-sm font-medium">Credits</p>
          {hasBalance ? (
            <p className="text-xs text-zinc-500">
              <span className="text-base font-bold text-black">{creditBalance!.toLocaleString()}</span> remaining
            </p>
          ) : (
            <p className="text-xs text-zinc-500">Connect a school portal to view the live credit balance.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
