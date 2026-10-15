"use client";

import { Fragment } from "react";
import { GraduationCap } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, HeartHandshake, UserCircle, Users, Bell, LogOut, ShieldCheck } from "lucide-react";
import { toTitleCase } from "@/lib/format";

interface StaffSidebarProps {
  subdomain: string;
  schoolName: string;
  /** The tenant's uploaded crest. Absent -> neutral cap (never the ResultApp mark). */
  logoUrl?: string;
  formClasses?: Array<{ class_name: string }>;
/**
   * Whether this member has been granted Moderator (deputy) access, which adds
   * a link into the Moderator Console.
   *
   * Purely a DISCOVERY affordance — without it a promoted member has no way to
   * learn the access exists except by noticing their colleague's sidebar has
   * fewer items.
   *
   * It grants NOTHING, and this is now strictly true in both directions. The
   * console reads the staff session the user already holds and re-checks
   * `is_moderator` against the DATABASE on every entry (POST
   * /api/moderator/session), so this boolean cannot grant access it does not
   * reflect, and hiding the link cannot withhold access that was granted.
   */
  isModerator?: boolean;
  onNavigate?: () => void;
}

const nav: Array<{
  label: string;
  href: string | ((sub: string) => string);
  icon: typeof LayoutDashboard;
  external?: boolean;
  /** Only rendered when the member has Moderator access. */
  moderatorOnly?: boolean;
}> = [
  { label: "Dashboard", href: "", icon: LayoutDashboard },
  { label: "My Classes", href: "/classes", icon: Users },
  { label: "My Grading", href: "/grading", icon: GraduationCap },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Profile", href: "/profile", icon: UserCircle },
  // THE FUNCTION FORM OF `href` IS REQUIRED HERE. Line 54 resolves a string
  // href as `${base}${item.href}` where base is `/${sub}/staff`, so a plain
  // "/admin" would produce /{sub}/staff/admin — a 404 that looks exactly like
  // "the link is broken". The function form bypasses the concatenation.
  //
  // Last in the array on purpose: the "My Form Class" entry used to be keyed
  // off `index === 1`, so inserting above it silently relocated that link onto
  // the wrong nav row. It is keyed off the label now.
  // Points at /moderator, NOT /admin.
    //
    // This link is the whole reason the Moderator Console exists. It used to
    // read "Admin Portal" and go to /{sub}/admin, which rendered the school's
    // admin branding and asked for "Admin ID or Email" — credentials a moderator
    // does not have, for a role they do not hold.
    //
    // The target route auto-elevates from the staff session the user ALREADY has
    // (POST /api/moderator/session, which re-verifies is_moderator against the
    // database first). So this is a navigation link, not a login form.
    { label: "Moderator Console", href: (sub: string) => `/${sub}/moderator`, icon: ShieldCheck, moderatorOnly: true },
];

export default function StaffSidebar({ subdomain, schoolName, logoUrl, formClasses, isModerator = false, onNavigate }: StaffSidebarProps) {
  const pathname = usePathname();
  const base = `/${subdomain}/staff`;
  // Form-teacher link: first assigned class (1:1 enforced server-side).
  const formClassName = (formClasses || []).map((f) => (f?.class_name || "").trim()).find(Boolean) || null;
  const formHref = formClassName ? `${base}/forms/${encodeURIComponent(formClassName)}` : null;
  const isFormActive = formHref !== null && pathname.startsWith(`${base}/forms`);
  // Moderator-only entries drop out entirely for everyone else. Filtering here
  // rather than at render time keeps the single nav array as the one source of
  // truth for both the desktop rail and the mobile drawer (which is just a
  // second mount of this component).
  const visibleNav = nav.filter((item) => !item.moderatorOnly || isModerator);
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
        {visibleNav.map((item) => {
          const href = typeof item.href === "function" ? (item.href as (s: string) => string)(subdomain) : `${base}${item.href}`;
          const isExternal = (item as unknown as { external?: boolean }).external;
          const isActive = !isExternal && (pathname === href || (item.href === "" && pathname === base));
          const Icon = item.icon;
          const formLink = item.label === "My Classes" && formHref !== null && (
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
                  item.moderatorOnly
                    ? // Always accented, never "active"-styled: this link leaves
                      // the staff portal entirely, so pathname can never match
                      // it and an active state would be permanently unreachable.
                      // A standing accent is what tells a moderator this is a
                      // door out of the staff area, not another page in it.
                      "flex items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5 text-sm font-medium text-accent transition hover:opacity-90"
                    : isActive
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
