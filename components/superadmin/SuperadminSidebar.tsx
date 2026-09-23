"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  ReceiptText,
  Bell,
  Settings,
  ShieldCheck,
  LogOut,
} from "lucide-react";

interface Props {
  onNavigate?: () => void;
}

const nav = [
  { label: "Dashboard", href: "/superadmin", icon: LayoutDashboard },
  { label: "Tenants", href: "/superadmin/tenants", icon: Building2 },
  { label: "Ledger & Audit", href: "/superadmin/ledger", icon: ReceiptText },
  { label: "Notifications", href: "/superadmin/notifications", icon: Bell },
  { label: "Settings", href: "/superadmin/settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/superadmin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SuperadminSidebar({ onNavigate }: Props) {
  const pathname = usePathname();
  const router = useRouter();

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
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-purple-500/20 bg-[#0B0514]/90 backdrop-blur-md">
      <div className="flex items-center gap-2.5 border-b border-purple-500/20 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-purple-500/20 bg-purple-900/20">
          <ShieldCheck className="h-5 w-5 text-purple-300" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-white">ResultApp</p>
          <p className="text-xs text-purple-300/50">Command Center</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
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
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}
