"use client";

import { Fragment } from "react";
import { GraduationCap } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, HeartHandshake, UserCircle, Users, Bell, LogOut } from "lucide-react";
import { toTitleCase } from "@/lib/format";

interface StaffSidebarProps {
  subdomain: string;
  schoolName: string;
  /** The tenant's uploaded crest. Absent -> neutral cap (never the ResultApp mark). */
  logoUrl?: string;
  formClasses?: Array<{ class_name: string }>;
  onNavigate?: () => void;
}

const nav: Array<{ label: string; href: string | ((sub: string) => string); icon: typeof LayoutDashboard; external?: boolean }> = [
  { label: "Dashboard", href: "", icon: LayoutDashboard },
  { label: "My Classes", href: "/classes", icon: Users },
  { label: "My Grading", href: "/grading", icon: GraduationCap },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Profile", href: "/profile", icon: UserCircle },
];

export default function StaffSidebar({ subdomain, schoolName, logoUrl, formClasses, onNavigate }: StaffSidebarProps) {
  const pathname = usePathname();
  const base = `/${subdomain}/staff`;
  // Form-teacher link: first assigned class (1:1 enforced server-side).
  const formClassName = (formClasses || []).map((f) => (f?.class_name || "").trim()).find(Boolean) || null;
  const formHref = formClassName ? `${base}/forms/${encodeURIComponent(formClassName)}` : null;
  const isFormActive = formHref !== null && pathname.startsWith(`${base}/forms`);
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line-1 bg-surface-0/90 backdrop-blur-md">
      <Link
        href={`/${subdomain}`}
        onClick={onNavigate}
        aria-label={`${toTitleCase(schoolName)} school portal`}
        className="border-b border-line-1 px-5 py-5 transition hover:bg-surface-2"
      >
        <div className="flex items-center gap-3">
          <Logo size="sm" src={logoUrl} alt="" className="rounded-full" />
          <div>
            <p className="text-sm font-semibold tracking-tight text-text-1">{toTitleCase(schoolName)}</p>
            <p className="text-xs text-text-3">Staff Portal</p>
          </div>
        </div>
      </Link>

      <nav className="flex-1 space-y-1 p-4">
        {nav.map((item, index) => {
          const href = typeof item.href === "function" ? (item.href as (s: string) => string)(subdomain) : `${base}${item.href}`;
          const isExternal = (item as unknown as { external?: boolean }).external;
          const isActive = !isExternal && (pathname === href || (item.href === "" && pathname === base));
          const Icon = item.icon;
          const formLink = index === 1 && formHref !== null && (
            <Link
              key="My Form Class"
              href={formHref}
              onClick={onNavigate}
              aria-current={isFormActive ? "page" : undefined}
              className={
                isFormActive
                  ? "flex items-center gap-3 rounded-lg border-r-2 border-success bg-success-soft px-3 py-2.5 text-sm font-medium text-success"
                  : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-2 hover:bg-surface-2 hover:text-text-1"
              }
            >
              <HeartHandshake className="h-4 w-4" />
              My Form Class
            </Link>
          );
          if (isExternal) {
            return (
              <Fragment key={item.label}>
                <Link href={href} onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-2 hover:bg-surface-2 hover:text-text-1">
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
                {formLink}
              </Fragment>
            );
          }
          return (
            <Fragment key={item.label}>
              <Link
                href={href}
                onClick={onNavigate}
                className={
                  isActive
                    ? "flex items-center gap-3 rounded-lg border-r-2 border-accent bg-accent-soft px-3 py-2.5 text-sm font-medium text-accent"
                    : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-2 hover:bg-surface-2 hover:text-text-1"
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
              {formLink}
            </Fragment>
          );
        })}
      </nav>

      <div className="border-t border-line-1 p-4">
        <a href={`/${subdomain}/staff/login`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-2 hover:bg-surface-2 hover:text-text-1">
          <LogOut className="h-4 w-4" /> Sign out
        </a>
      </div>
    </aside>
  );
}
