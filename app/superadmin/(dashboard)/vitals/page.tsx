"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Cpu,
  Database,
  HardDrive,
  Loader2,
  MemoryStick,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Platform Vitals — superadmin-only live server telemetry.
 *
 * Session access is enforced twice: the (dashboard) layout redirects
 * unauthenticated visitors to /superadmin/login, and this page's only data
 * source is /api/admin/vitals, which re-verifies the signed cookie before it
 * calls the secret-gated backend. The UI itself holds no credential.
 */

interface Vitals {
  os_name: string | null;
  os_version: string | null;
  kernel: string | null;
  disk_total_bytes: number | null;
  disk_used_bytes: number | null;
  disk_free_bytes: number | null;
  disk_percent_used: number | null;
  mem_total_bytes: number | null;
  mem_available_bytes: number | null;
  mem_used_bytes: number | null;
  mem_percent_used: number | null;
  pg_connections: number | null;
  pg_max_connections: number | null;
  pg_connections_percent: number | null;
  pg_by_state: Record<string, number>;
  uptime_seconds: number | null;
  hostname: string | null;
  collected_at: string;
  warnings: string[];
}

/** Agreed polling cadence for Phase 4. */
const POLL_MS = 60_000;

function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

/** Colour ramp so an operator sees pressure without reading the number. */
function usageTone(pct: number | null): { bar: string; text: string } {
  if (pct === null) return { bar: "bg-purple-800", text: "text-text-3" };
  if (pct >= 90) return { bar: "bg-red-500", text: "text-danger" };
  if (pct >= 75) return { bar: "bg-amber-500", text: "text-warning" };
  return { bar: "bg-emerald-500", text: "text-success" };
}

function Meter({
  label,
  used,
  total,
  percent,
}: {
  label: string;
  used: number;
  total: number;
  percent: number | null;
}) {
  const tone = usageTone(percent);
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-text-2">{label}</span>
        <span className={cn("font-mono text-xs font-semibold", tone.text)}>
          {percent === null ? "—" : `${percent.toFixed(1)}%`}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} utilisation`}
      >
        <div className={cn("h-full rounded-full transition-all duration-500", tone.bar)} style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-text-3">
        {formatBytes(used)} used of {formatBytes(total)}
      </p>
    </div>
  );
}

export default function PlatformVitalsPage() {
  const [data, setData] = useState<Vitals | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow in-flight poll resolving after unmount or after a
  // newer poll started, which would otherwise display stale numbers.
  const requestSeq = useRef(0);

  const load = useCallback(async (isManual = false) => {
    const seq = ++requestSeq.current;
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/vitals", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (seq !== requestSeq.current) return;
      if (res.status === 401) {
        setError("Session expired — sign in again.");
        setData(null);
        return;
      }
      if (!res.ok) {
        setError((json as { error?: string })?.error || `Failed (${res.status})`);
        return;
      }
      setData(json as Vitals);
      setError(null);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : "Could not load telemetry");
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    // Kick the first read off in a microtask rather than synchronously in the
    // effect body, so mounting does not trigger a cascading render.
    const kick = Promise.resolve().then(() => load());
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(id);
      requestSeq.current += 1;
      void kick;
    };
  }, [load]);

  const lastUpdated = data?.collected_at
    ? new Date(data.collected_at).toLocaleTimeString(undefined, { hour12: false })
    : null;

  // Boot time derived from the server's own collection timestamp, not Date.now()
  // at render — deterministic, and accurate to when the reading was taken.
  // Plain derivation (no useMemo): it runs off two fields and the React
  // compiler rejects a memo here anyway.
  let bootedAtLabel = "unavailable";
  if (data?.collected_at && typeof data.uptime_seconds === "number") {
    const collected = new Date(data.collected_at).getTime();
    if (!Number.isNaN(collected)) {
      bootedAtLabel = `since ${new Date(collected - data.uptime_seconds * 1000).toLocaleString()}`;
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-[0_0_20px_rgba(147,51,234,0.35)]">
            <Activity className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-1">Platform Vitals</h1>
            <p className="text-sm text-text-2">
              Live server telemetry
              {lastUpdated ? ` · updated ${lastUpdated}` : ""} · refreshes every 60s
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line-1 bg-surface-2 px-4 text-sm font-medium text-text-2 transition hover:bg-surface-2 hover:text-text-1 disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-6 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Partial-failure notice — telemetry degrades per-metric, never all-or-nothing. */}
      {data && data.warnings.length > 0 && (
        <div className="mt-6 flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Partial data: {data.warnings.join(" · ")}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-line-1 bg-surface-1 p-6 text-sm text-text-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Collecting server metrics…
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {/* 1 & 2 — OS + kernel */}
          <Card icon={Server} title="Operating System">
            <Row label="Distribution" value={data?.os_name ?? "—"} />
            <Row label="Version" value={data?.os_version ?? "—"} />
            <Row label="Kernel" value={data?.kernel ?? "—"} mono />
            <Row label="Hostname" value={data?.hostname ?? "—"} mono />
          </Card>

          {/* 6 — uptime */}
          <Card icon={Timer} title="Uptime">
            <div className="font-mono text-3xl font-bold tracking-tight text-text-1">
              {formatUptime(data?.uptime_seconds)}
            </div>
            <p className="mt-1 text-xs text-text-3">
              {bootedAtLabel}
            </p>
          </Card>

          {/* 3 — disk */}
          <Card icon={HardDrive} title="Disk Space">
            {data?.disk_total_bytes === null || data?.disk_total_bytes === undefined ? (
              <p className="text-sm text-text-3">Unavailable</p>
            ) : (
              <>
                <Meter
                  label="Used"
                  used={data.disk_used_bytes ?? 0}
                  total={data.disk_total_bytes}
                  percent={data.disk_percent_used}
                />
                <Row label="Free" value={formatBytes(data.disk_free_bytes)} mono />
              </>
            )}
          </Card>

          {/* 4 — memory */}
          <Card icon={MemoryStick} title="Memory">
            {data?.mem_total_bytes === null || data?.mem_total_bytes === undefined ? (
              <p className="text-sm text-text-3">Unavailable</p>
            ) : (
              <>
                <Meter
                  label="Used"
                  used={data.mem_used_bytes ?? 0}
                  total={data.mem_total_bytes}
                  percent={data.mem_percent_used}
                />
                <Row label="Available" value={formatBytes(data.mem_available_bytes)} mono />
              </>
            )}
          </Card>

          {/* 5 — postgres connections */}
          <Card icon={Database} title="PostgreSQL Connections">
            {data?.pg_connections === null || data?.pg_connections === undefined ? (
              <p className="text-sm text-text-3">Unavailable</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-bold tracking-tight text-text-1">
                    {data.pg_connections}
                  </span>
                  <span className="text-sm text-text-3">
                    / {data.pg_max_connections ?? "?"} max
                  </span>
                </div>
                <Meter
                  label="Pool utilisation"
                  used={data.pg_connections}
                  total={data.pg_max_connections ?? data.pg_connections}
                  percent={data.pg_connections_percent}
                />
                {Object.keys(data.pg_by_state ?? {}).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(data.pg_by_state).map(([state, count]) => (
                      <span
                        key={state}
                        className="rounded-full border border-line-1 bg-surface-1 px-2 py-0.5 font-mono text-[11px] text-text-2"
                      >
                        {state}: {count}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>

          {/* 6 metrics accounted for: OS, kernel, disk, memory, PG, uptime.
              This card gives the collector provenance so a null is diagnosable. */}
          <Card icon={Cpu} title="Collector">
            <Row label="Metrics" value="6 of 6" />
            <Row label="Collected" value={data?.collected_at ?? "—"} mono />
            <Row label="Partial" value={data?.warnings.length ? `${data.warnings.length} warning(s)` : "none"} />
            <p className="mt-2 text-[11px] leading-5 text-text-3">
              Read from /proc and the platform registry. Each collector is
              independent, so one failure leaves the rest of this page live.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Server;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line-1 bg-surface-1 p-5 backdrop-blur">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text-1">
        <Icon className="h-4 w-4 text-accent" />
        {title}
      </h2>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-text-2">{label}</span>
      <span
        className={cn(
          "truncate text-right text-sm text-text-1",
          mono && "font-mono text-xs text-text-1",
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
