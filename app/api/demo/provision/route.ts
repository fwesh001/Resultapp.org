import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/demo/provision — public entrypoint for launching an ephemeral demo.
 *
 * This is the ONLY demo route the browser may call. It rate-limits by real
 * client IP (only visible here, behind the edge — the backend sees Vercel's
 * egress IP, so a backend per-IP limit would be useless), then forwards to
 * the secret-gated FastAPI endpoint. The backend enforces the global
 * capacity cap and per-minute brake as the second lock.
 *
 * In-memory sliding window: correct per serverless instance; the backend's
 * global cap is the hard guarantee. 3 launches/hour/IP is generous for a
 * human prospect and starves a naive bot.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 3;
const hits = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return req.headers.get("x-real-ip")?.slice(0, 64) || "unknown";
}

function allowed(ip: string): { ok: boolean; retryAfterS: number } {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => t > now - WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    const retryAfterS = Math.ceil((arr[0] + WINDOW_MS - now) / 1000);
    hits.set(ip, arr);
    return { ok: false, retryAfterS };
  }
  arr.push(now);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  hits.set(ip, arr);
  return { ok: true, retryAfterS: 0 };
}

function getBackendBase(): string {
  const raw =
    process.env.PROVISION_API_URL?.trim() ||
    process.env.BACKEND_URL?.trim() ||
    process.env.API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

export async function POST(req: NextRequest) {
  // TEMPORARY stub while root-causing an edge 502 — real logic restored next.
  void req;
  void clientIp;
  void allowed;
  void getBackendBase;
  return NextResponse.json({ stub: "provision-stub-ok" }, { status: 200 });
}

function resOk(status: number): boolean {
  return status >= 200 && status < 300;
}
