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
  GraduationCap,
} from "lucide-react";
import { toTitleCase } from "@/lib/format";

/**
 * Which portal this sidebar is rendering inside.
 *
 * A moderator used to be sent to `/{sub}/admin`, which rendered this exact
 * component with "Admin Portal" written under the school name. The capability
 * boundary was already correct; the framing was not — a deputy being told they
 * are the school's admin.
 */
export type PortalSegment = "admin" | "moderator";

/**
 * Branding copy per portal.
 *
 * Not derived from the role at runtime on purpose: it is a literal, so a test
 * can assert that the moderator portal renders no "Admin Portal" string at all.
 */
const PORTAL_COPY: Record<PortalSegment, { subtitle: string; ariaSuffix: string }> = {
  admin: { subtitle: "Admin Portal", ariaSuffix: "admin portal" },
  moderator: { subtitle: "Moderator Console", ariaSuffix: "moderator console" },
};

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
  /**
   * Route segment this sidebar lives under. Drives every href AND the branding
   * copy from one value, so a moderator console cannot render an admin-flavoured
   * link or label by forgetting one of the two.
   */
  portal?: PortalSegment;
}

export default function AdminSidebar({
  subdomain,
  schoolName,
  logoUrl,
  isModerator = false,
  capabilities,
  actorLabel,
  onNavigate,
  portal = "admin",
}: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  /** Every tenant-scoped href in this sidebar is built from this one value. */
  const base = `/${subdomain}/${portal}`;
  const copy = PORTAL_COPY[portal];

  async function handleSignOut() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Cookie clear is best-effort; still navigate to login.
    }
    onNavigate?.();
    // A moderator has NO login page — elevation is automatic from the staff
    // session (POST /api/moderator/session), so `/${sub}/moderator/login` would
    // be a dead end. The admin logout leaves the staff cookie intact, so send
    // them to the Staff Portal: that is where they can still work.
    router.push(portal === "moderator" ? `/${subdomain}/staff` : `${base}/login`);
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
      href: base,
      icon: LayoutDashboard,
      capability: "dashboard",
    },
    {
      label: "Results",
      href: `${base}/results`,
      icon: ClipboardCheck,
      capability: "results",
    },
    {
      label: "Allocations",
      href: `${base}/allocations`,
      icon: Users,
      capability: "allocations",
    },
    {
      label: "Clearance",
      href: `${base}/clearance`,
      icon: Wallet,
      capability: "clearance",
    },
    {
      // Admin-only. Sits after Clearance because closing a session is what the
      // bursary's cleared state feeds into, and before Templates because it
      // changes the class every report card is rendered against.
      label: "End of Session",
      href: `${base}/promotion`,
      icon: GraduationCap,
      capability: "promotion",
    },
    {
      label: "Templates",
      href: `${base}/templates`,
      icon: BookOpen,
      capability: "templates",
    },
    {
      label: "Audit Log",
      href: `${base}/audit`,
      icon: ShieldCheck,
      capability: "audit",
    },
    {
      label: "Settings",
      href: `${base}/settings`,
      icon: Settings,
      capability: "settings",
    },
    {
      label: "Billing",
      href: `${base}/billing`,
      icon: CreditCard,
      capability: "billing",
    },
    {
      label: "Notifications",
      href: `${base}/notifications`,
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
    // The dashboard href is the portal ROOT, which is a string prefix of every
    // other href here (`/{sub}/moderator` vs `/{sub}/moderator/results`).
    // The old check was `href.endsWith("/admin")` — specific to one portal, and
    // so already wrong for a moderator root. Comparing against `base` directly
    // fixes that and needs no special case.
    if (href === base) {
      return pathname === base;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line-1 bg-surface-0/90 backdrop-blur-md">
      <Link
        href={`/${subdomain}`}
        onClick={onNavigate}
        aria-label={`${toTitleCase(schoolName)} school ${copy.ariaSuffix}`}
        className="flex items-center gap-2.5 border-b border-line-1 px-5 py-5 transition hover:bg-surface-2"
      >
        <Logo size="sm" src={logoUrl} alt="" className="rounded-full" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-text-1">
            {toTitleCase(schoolName)}
          </p>
          <p className="text-xs text-text-3">{copy.subtitle}</p>
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
        {/* Who this session actually belongs to.
            In the moderator console this matters more than usual: the session is
            DERIVED from a staff login, so a deputy holding two sessions can
            otherwise be unsure which one they are looking at. The prop was
            already being passed by AdminShell and silently dropped here. */}
        {actorLabel ? (
          <p className="truncate px-3 pb-1 text-xs text-text-3">
            Signed in as{" "}
            <span className="text-text-2">{toTitleCase(actorLabel)}</span>
          </p>
        ) : null}
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
