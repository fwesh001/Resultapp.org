"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  CheckCheck,
  ChevronDown,
  ExternalLink,
  Inbox,
  Loader2,
  Search,
} from "lucide-react";
import {
  NOTIFICATION_CATEGORIES,
  getCategoryStyle,
  type InboxNotification,
} from "@/lib/notifications";

interface NotificationInboxProps {
  tenantId: string;
  /** Portal base path, e.g. "/vhs/admin" — reserved for CTA normalization. */
  basePath: string;
}

const PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 300;

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isSafeLink(link: string): boolean {
  const v = link.trim();
  return v.startsWith("/") || v.startsWith("https://") || v.startsWith("http://");
}

/**
 * Shared two-column tenant inbox: filter sidebar + accordion feed.
 * Sidebar stacks above the feed on mobile (flex-col → md:flex-row).
 */
export default function NotificationInbox({ tenantId, basePath }: NotificationInboxProps) {
  void basePath;
  const router = useRouter();
  const searchParams = useSearchParams();
  const tid = (tenantId || "").toLowerCase().trim();
  // Deep-link target (?open=<id>) + per-item refs for scroll-into-view
  const itemRefs = useRef(new Map<number, HTMLLIElement>());
  const deepLinked = useRef<number | null>(null);

  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Accordion expansion per notification id
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Debounce search input → committed query
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (!tid) return;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      try {
        const qs = new URLSearchParams({
          tenant_id: tid,
          limit: String(PAGE_LIMIT),
          offset: String(offset),
        });
        if (unreadOnly) qs.set("unread_only", "true");
        if (debouncedQuery) qs.set("q", debouncedQuery);
        const res = await fetch(`/api/notifications/inbox?${qs.toString()}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
        const batch = (data as { notifications?: InboxNotification[] }).notifications || [];
        setItems((cur) => (append ? [...cur, ...batch] : batch));
        setHasMore(batch.length === PAGE_LIMIT);
        setUnreadCount(Number((data as { unread_count?: number }).unread_count || 0));
      } catch (e) {
        if (!append) setError(e instanceof Error ? e.message : "Failed to load notifications");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [tid, unreadOnly, debouncedQuery],
  );

  // Refetch on filter change (offset reset)
  useEffect(() => {
    setExpanded(new Set());
    void load(0, false);
  }, [load]);

  // Client-side category quick-filter over the fetched page(s)
  const visible = useMemo(() => {
    if (!activeCategory) return items;
    return items.filter((n) => (n.category || "SYSTEM").toUpperCase() === activeCategory);
  }, [items, activeCategory]);

  async function markOne(n: InboxNotification) {
    // Toggle accordion
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(n.id)) next.delete(n.id);
      else next.add(n.id);
      return next;
    });
    // Mark as read if unread (optimistic)
    if (!n.is_read) {
      const prevItems = items;
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((u) => Math.max(0, u - 1));
      try {
        const res = await fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tid, notification_id: n.id }),
        });
        if (!res.ok) throw new Error("failed");
      } catch {
        setItems(prevItems);
        setUnreadCount((u) => u + 1);
      }
    }
  }

  async function markAll() {
    const prevItems = items;
    const prevUnread = unreadCount;
    setItems((cur) => cur.map((x) => ({ ...x, is_read: true })));
    setUnreadCount(0);
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tid, read_all: true }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setItems(prevItems);
      setUnreadCount(prevUnread);
    }
  }

  function openCta(e: React.MouseEvent, link: string) {
    e.stopPropagation();
    const url = link.trim();
    if (!isSafeLink(url)) return;
    if (url.startsWith("/")) router.push(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  const categories = useMemo(() => Object.keys(NOTIFICATION_CATEGORIES), []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-purple-500/20 bg-purple-900/20">
          <Bell className="h-5 w-5 text-purple-300" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Notifications</h1>
          <p className="text-sm text-zinc-400">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Left sidebar: Filters (stacks on top for mobile) */}
        <aside aria-label="Notification filters" className="w-full shrink-0 md:w-64">
          <div className="space-y-1 rounded-xl border border-purple-500/20 bg-white/[0.02] p-3">
            <button
              type="button"
              onClick={() => {
                setUnreadOnly(false);
                setActiveCategory(null);
              }}
              aria-pressed={!unreadOnly && activeCategory === null}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition ${
                !unreadOnly && activeCategory === null
                  ? "bg-purple-600/20 font-medium text-purple-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Inbox className="h-4 w-4 shrink-0" /> Inbox
            </button>
            <button
              type="button"
              onClick={() => setUnreadOnly((v) => !v)}
              aria-pressed={unreadOnly}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
                unreadOnly
                  ? "bg-purple-600/20 font-medium text-purple-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                    unreadOnly ? "bg-purple-600" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                      unreadOnly ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </span>
                Unread Only
              </span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-500 px-2 py-px text-[11px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            <p className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Categories
            </p>
            {categories.map((cat) => {
              const style = getCategoryStyle(cat);
              const Icon = style.icon;
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory((cur) => (cur === cat ? null : cat))}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-purple-600/20 font-medium text-purple-200 ring-1 ring-purple-500/40"
                      : "text-zinc-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${style.iconClasses}`} aria-hidden="true" />
                  <span className="capitalize">{cat.toLowerCase()}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main column */}
        <section aria-label="Notifications feed" className="min-w-0 flex-1">
          {/* Top bar: search + mark all */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notifications…"
                aria-label="Search notifications"
                className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
              />
            </label>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-purple-500/30 px-4 py-2.5 text-sm text-purple-200 transition hover:bg-purple-900/30"
              >
                <CheckCheck className="h-4 w-4" /> Mark all as read
              </button>
            )}
          </div>

          {/* Feed */}
          {loading ? (
            <p className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/20 py-12 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading notifications…
            </p>
          ) : error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-8 text-center text-sm text-red-300">
              {error}
            </p>
          ) : visible.length === 0 ? (
            <p className="rounded-xl border border-purple-500/20 py-12 text-center text-sm text-zinc-500">
              {debouncedQuery || unreadOnly || activeCategory
                ? "No notifications match your filters."
                : "You're all caught up."}
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((n) => {
                const style = getCategoryStyle(n.category);
                const Icon = style.icon;
                const isOpen = expanded.has(n.id);
                const link = (n.cta_link || "").trim();
                return (
                  <li
                    key={n.id}
                    className={`overflow-hidden rounded-xl border bg-white/[0.02] transition ${
                      isOpen ? "border-purple-500/40" : "border-purple-500/20 hover:border-purple-500/30"
                    } ${n.is_read ? "" : "border-l-2 border-l-purple-500"}`}
                  >
                    <button
                      type="button"
                      onClick={() => void markOne(n)}
                      aria-expanded={isOpen}
                      className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${style.avatarClasses}`}
                        aria-hidden="true"
                      >
                        <Icon className={`h-4 w-4 ${style.iconClasses}`} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-white">{n.title}</span>
                          {!n.is_read && (
                            <span className={`h-2 w-2 shrink-0 rounded-full ${style.dotClasses}`} aria-label="Unread" />
                          )}
                        </span>
                        <span
                          className={`mt-1 text-sm text-zinc-300 break-words transition-all ${
                            isOpen ? "" : "line-clamp-3"
                          }`}
                        >
                          {n.message}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`inline-block rounded-full border px-2 py-px text-[11px] ${style.badgeClasses}`}>
                            {n.category || "SYSTEM"}
                          </span>
                          {n.created_at && (
                            <span className="text-[11px] text-zinc-500">{timeAgo(n.created_at)}</span>
                          )}
                        </span>
                      </span>
                      <ChevronDown
                        className={`mt-1 h-4 w-4 shrink-0 text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    {isOpen && link && isSafeLink(link) && (
                      <div className="border-t border-purple-500/20 px-4 py-3 pl-[68px]">
                        <button
                          type="button"
                          onClick={(e) => openCta(e, link)}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-300 transition hover:text-white"
                        >
                          Open link <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && !error && hasMore && !activeCategory && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => void load(items.length, true)}
                disabled={loadingMore}
                className="rounded-lg border border-purple-500/30 px-5 py-2 text-sm text-purple-200 transition hover:bg-purple-900/30 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Show more"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
