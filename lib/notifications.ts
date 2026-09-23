import { AlertCircle, Bell, Info, Megaphone, Rocket, ShieldAlert, type LucideIcon } from "lucide-react";

/**
 * Modular category → UI mapping for the Notification Engine.
 *
 * Adding a new category requires exactly ONE change: add one key here.
 * Unknown categories fall back to `FALLBACK_CATEGORY_STYLE` (gray + Bell).
 */

export interface NotificationCategoryStyle {
  /** Small badge classes for category pills. */
  badgeClasses: string;
  /** Icon tint inside the avatar circle. */
  iconClasses: string;
  /** Avatar circle background/border. */
  avatarClasses: string;
  /** Unread dot color. */
  dotClasses: string;
  /** Lucide icon component. */
  icon: LucideIcon;
}

export const NOTIFICATION_CATEGORIES: Record<string, NotificationCategoryStyle> = {
  BILLING: {
    badgeClasses: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    iconClasses: "text-amber-300",
    avatarClasses: "bg-amber-500/15 border-amber-500/30",
    dotClasses: "bg-amber-400",
    icon: AlertCircle,
  },
  SYSTEM: {
    badgeClasses: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    iconClasses: "text-blue-300",
    avatarClasses: "bg-blue-500/15 border-blue-500/30",
    dotClasses: "bg-blue-400",
    icon: Info,
  },
  ONBOARDING: {
    badgeClasses: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    iconClasses: "text-purple-300",
    avatarClasses: "bg-purple-500/15 border-purple-500/30",
    dotClasses: "bg-purple-400",
    icon: Rocket,
  },
  SECURITY: {
    badgeClasses: "bg-red-500/15 text-red-300 border-red-500/30",
    iconClasses: "text-red-300",
    avatarClasses: "bg-red-500/15 border-red-500/30",
    dotClasses: "bg-red-400",
    icon: ShieldAlert,
  },
};

export const FALLBACK_CATEGORY_STYLE: NotificationCategoryStyle = {
  badgeClasses: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  iconClasses: "text-zinc-300",
  avatarClasses: "bg-zinc-500/15 border-zinc-500/30",
  dotClasses: "bg-zinc-400",
  icon: Bell,
};

export function getCategoryStyle(category?: string | null): NotificationCategoryStyle {
  const key = (category || "").trim().toUpperCase();
  return NOTIFICATION_CATEGORIES[key] ?? FALLBACK_CATEGORY_STYLE;
}

export interface InboxNotification {
  id: number;
  category: string;
  title: string;
  message: string;
  cta_link?: string | null;
  event_type?: string | null;
  created_at: string;
  is_read: boolean;
  read_at?: string | null;
}
