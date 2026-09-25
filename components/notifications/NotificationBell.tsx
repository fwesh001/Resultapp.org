"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bell, CheckCheck, Loader2 } from "lucide-react";
import { getCategoryStyle, type InboxNotification } from "@/lib/notifications";

interface NotificationBellProps {
  tenantId: string;
  /** Active portal context — drives the "View all" footer link. */
  portal?: "admin" | "staff";
}

const POLL_BASE_MS = 120000; // 120s idle cadence (C1 cost fix)
const POLL_MAX_MS = 600000; // 10min ceiling on repeated failure
const POLL_JITTER_MS = 15000; // ± jitter to de-thunder concurrent tabs
const INBOX_LIMIT = 20;

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
 * Shared unread-count poller (Bug 2 fix).
 *
 * The admin/staff shells mount TWO bell instances (mobile + desktop headers,
 * one CSS-hidden but still mounted), so a per-instance scheduler polls every
 * interval in pairs. This module-level poller runs ONE loop per tenant and
 * fans the count out to every subscriber badge.
 *
 * Preserves C1 semantics: 120s base, 2x exponential backoff to 10min ceiling
 * with jitter, hidden-tab gate (no network while hidden), single immediate
 * refresh on focus/return-to-tab. Poke coalescing (POKE_MIN_INTERVAL_MS)
 * absorbs the focus+visibilitychange double-fire on tab return.
 */
type UnreadSubscriber = (count: number) => void;

interface SharedPoller {
  subs: Set<UnreadSubscriber>;
  timer: ReturnType<typeof setTimeout> | null;
  failures: number;
  inFlight: boolean;
  lastStart: number;
  lastCount: number | null;
  stopped: boolean;
  onVisibility: () => void;
  onFocus: () => void;
}

const POLLERS = new Map<string, SharedPoller>();
const POKE_MIN_INTERVAL_MS = 15000;

async function fetchUnread(tid: string): Promise<{ ok: boolean; count: number | null }> {
  // Hidden tabs never hit the network (C1 visibility gate).
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return { ok: true, count: null };
  }
  try {
    const res = await fetch(`/api/notifications/unread-count?tenant_id=${encodeURIComponent(tid)}`, {
      cache: "no-store",
    });
    if (res.status === 401) return { ok: true, count: null }; // signed out — stay silent, no backoff
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, count: null };
    return { ok: true, count: Number((data as { unread_count?: number }).unread_count || 0) };
  } catch {
    // best-effort poll — never surface errors for the badge
    return { ok: false, count: null };
  }
}

function pollerDelay(failures: number): number {
  return Math.min(POLL_BASE_MS * 2 ** failures, POLL_MAX_MS) + Math.random() * POLL_JITTER_MS;
}

function pollerSchedule(tid: string): void {
  const poller = POLLERS.get(tid);
  if (!poller || poller.stopped) return;
  poller.timer = setTimeout(() => void pollerTick(tid), pollerDelay(poller.failures));
}

async function pollerTick(tid: string): Promise<void> {
  const poller = POLLERS.get(tid);
  if (!poller || poller.stopped || poller.inFlight) return;
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    poller.inFlight = true;
    poller.lastStart = Date.now();
    const { ok, count } = await fetchUnread(tid);
    poller.inFlight = false;
    if (POLLERS.get(tid) !== poller || poller.stopped) return;
    poller.failures = ok ? 0 : poller.failures + 1;
    if (count !== null) {
      poller.lastCount = count;
      for (const cb of poller.subs) {
        try {
          cb(count);
        } catch {
          // subscriber teardown race — ignore
        }
      }
    }
  }
  pollerSchedule(tid);
}

function pollerPoke(tid: string): void {
  const poller = POLLERS.get(tid);
  if (!poller || poller.stopped || poller.inFlight) return;
  // Coalesce the focus + visibilitychange double-fire on tab return.
  if (Date.now() - poller.lastStart < POKE_MIN_INTERVAL_MS) return;
  if (poller.timer) {
    clearTimeout(poller.timer);
    poller.timer = null;
  }
  void pollerTick(tid);
}

function subscribeUnread(tid: string, cb: UnreadSubscriber): () => void {
  let poller = POLLERS.get(tid);
  if (!poller) {
    const created: SharedPoller = {
      subs: new Set(),
      timer: null,
      failures: 0,
      inFlight: false,
      lastStart: 0,
      lastCount: null,
      stopped: false,
      onVisibility: () => {
        if (document.visibilityState === "visible") pollerPoke(tid);
      },
      onFocus: () => pollerPoke(tid),
    };
    poller = created;
    POLLERS.set(tid, poller);
    document.addEventListener("visibilitychange", poller.onVisibility);
    window.addEventListener("focus", poller.onFocus);
    void pollerTick(tid);
  }
  poller.subs.add(cb);
  // Late mounters hydrate instantly from the last known count.
  if (poller.lastCount !== null) {
    const snapshot = poller.lastCount;
    try {
      cb(snapshot);
    } catch {
      // ignore
    }
  }
  return () => {
    const current = POLLERS.get(tid);
    if (!current) return;
    current.subs.delete(cb);
    if (current.subs.size === 0) {
      current.stopped = true;
      if (current.timer) clearTimeout(current.timer);
      document.removeEventListener("visibilitychange", current.onVisibility);
      window.removeEventListener("focus", current.onFocus);
      if (POLLERS.get(tid) === current) POLLERS.delete(tid);
    }
  };
}

/** Tenant inbox bell — badge + hand-rolled dropdown (no menu library). */
export default function NotificationBell({ tenantId, portal }: NotificationBellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tid = (tenantId || "").toLowerCase().trim();

  const loadInbox = useCallback(async () => {
    if (!tid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/notifications/inbox?tenant_id=${encodeURIComponent(tid)}&limit=${INBOX_LIMIT}&offset=0`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setItems(((data as { notifications?: InboxNotification[] }).notifications || []).slice(0, INBOX_LIMIT));
      setUnread(Number((data as { unread_count?: number }).unread_count || 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [tid]);

  // Shared badge subscription — one poller per tenant no matter how many
  // bell instances are mounted (mobile + desktop shells). Fan-out keeps
  // every badge consistent from a single fetch per interval.
  useEffect(() => {
    if (!tid) return;
    return subscribeUnread(tid, setUnread);
  }, [tid]);

  // Load inbox when opened.
  useEffect(() => {
    if (open) void loadInbox();
  }, [open, loadInbox]);

  // Outside-click + Escape to close (mirrors TenantRowMenu pattern).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  async function markOne(n: InboxNotification) {
    // Optimistic update.
    const prevItems = items;
    const prevUnread = unread;
    setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    if (!n.is_read) setUnread((u) => Math.max(0, u - 1));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tid, notification_id: n.id }),
      });
    } catch {
      setItems(prevItems);
      setUnread(prevUnread);
      return;
    }
    const link = (n.cta_link || "").trim();
    if (link && isSafeLink(link)) {
      setOpen(false);
      if (link.startsWith("/")) router.push(link);
      else window.open(link, "_blank", "noopener,noreferrer");
    } else if (portal) {
      // No CTA — deep-link into the dedicated inbox with this item expanded.
      setOpen(false);
      router.push(`/${tid}/${portal}/notifications?open=${n.id}`);
    }
  }

  async function markAll() {
    const prevItems = items;
    const prevUnread = unread;
    setItems((cur) => cur.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tid, read_all: true }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setItems(prevItems);
      setUnread(prevUnread);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-purple-500/20 p-2 text-purple-200 transition hover:bg-purple-900/20"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Recent notifications"
          className="absolute right-0 z-[100] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-purple-500/20 bg-[#140A24] shadow-2xl sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-purple-500/20 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                className="inline-flex items-center gap-1 text-xs text-purple-300 transition hover:text-white"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </p>
            ) : error ? (
              <p className="px-4 py-8 text-center text-sm text-red-300">{error}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">You&apos;re all caught up.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {items.map((n) => {
                  const style = getCategoryStyle(n.category);
                  const Icon = style.icon;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void markOne(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/5 ${
                          n.is_read ? "opacity-70" : ""
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${style.avatarClasses}`}
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
                          <span className="mt-0.5 line-clamp-3 break-words text-xs text-zinc-400">{n.message}</span>
                          <span className="mt-1.5 flex items-center gap-2">
                            <span className={`inline-block rounded-full border px-2 py-px text-[11px] ${style.badgeClasses}`}>
                              {style.label ?? n.category ?? "SYSTEM"}
                            </span>
                            {n.created_at && <span className="text-[11px] text-zinc-500">{timeAgo(n.created_at)}</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {portal && (
            <div className="sticky bottom-0 border-t border-purple-500/20 bg-[#140A24]/95 backdrop-blur">
              <Link
                href={`/${tid}/${portal}/notifications`}
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-1.5 px-4 py-3 text-sm font-medium text-purple-300 transition hover:bg-white/5 hover:text-white"
              >
                View all notifications <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
