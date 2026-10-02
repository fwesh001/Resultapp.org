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
  if (pct === null) return { bar: "bg-purple-800", text: "text-purple-300/50" };
  if (pct >= 90) return { bar: "bg-red-500", text: "text-red-300" };
  if (pct >= 75) return { bar: "bg-amber-500", text: "text-amber-300" };
  return { bar: "bg-emerald-500", text: "text-emerald-300" };
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
        <span className="text-xs text-purple-200/60">{label}</span>
        <span className={cn("font-mono text-xs font-semibold", tone.text)}>
          {percent === null ? "—" : `${percent.toFixed(1)}%`}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-purple-950/60"
        role="meter"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} utilisation`}
      >
        <div className={cn("h-full rounded-full transition-all duration-500", tone.bar)} style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-purple-300/40">
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
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]">
            <Activity className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Platform Vitals</h1>
            <p className="text-sm text-purple-200/60">
              Live server telemetry
              {lastUpdated ? ` · updated ${lastUpdated}` : ""} · refreshes every 60s
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-purple-500/20 bg-white/5 px-4 text-sm font-medium text-purple-200 transition hover:bg-white/10 hover:text-white disabled:opacity-60"
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
        <div className="mt-6 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Partial-failure notice — telemetry degrades per-metric, never all-or-nothing. */}
      {data && data.warnings.length > 0 && (
        <div className="mt-6 flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Partial data: {data.warnings.join(" · ")}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-6 text-sm text-purple-200/60">
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
            <div className="font-mono text-3xl font-bold tracking-tight text-white">
              {formatUptime(data?.uptime_seconds)}
            </div>
            <p className="mt-1 text-xs text-purple-300/50">
              {bootedAtLabel}
            </p>
          </Card>

          {/* 3 — disk */}
          <Card icon={HardDrive} title="Disk Space">
            {data?.disk_total_bytes === null || data?.disk_total_bytes === undefined ? (
              <p className="text-sm text-purple-300/50">Unavailable</p>
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
              <p className="text-sm text-purple-300/50">Unavailable</p>
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
              <p className="text-sm text-purple-300/50">Unavailable</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-bold tracking-tight text-white">
                    {data.pg_connections}
                  </span>
                  <span className="text-sm text-purple-300/50">
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
                        className="rounded-full border border-purple-500/15 bg-purple-900/20 px-2 py-0.5 font-mono text-[11px] text-purple-200/80"
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
            <p className="mt-2 text-[11px] leading-5 text-purple-300/40">
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
    <section className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5 backdrop-blur">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Icon className="h-4 w-4 text-purple-300" />
        {title}
      </h2>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-purple-200/60">{label}</span>
      <span
        className={cn(
          "truncate text-right text-sm text-white",
          mono && "font-mono text-xs text-purple-100",
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
