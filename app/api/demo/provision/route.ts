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

function getBackendOrigin(): string {
  // PROVISION_API_URL may be the droplet root, the /api/v1 base, or the full
  // /api/v1/provision endpoint (register-school handles all three shapes).
  // Normalize every shape to the bare origin — the fetch below appends the
  // full /api/v1/demo/provision path itself.
  const raw =
    process.env.PROVISION_API_URL?.trim() ||
    process.env.BACKEND_URL?.trim() ||
    process.env.API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw
    .replace(/\/$/, "")
    .replace(/\/api\/v1\/provision\/?$/, "")
    .replace(/\/api\/v1\/?$/, "")
    .replace(/\/provision\/?$/, "");
}

export async function POST(req: NextRequest) {
  return handleProvision(req);
}

async function handleProvision(req: NextRequest) {
  const ip = clientIp(req);
  const gate = allowed(ip);
  if (!gate.ok) {
    return NextResponse.json(
      {
        success: false,
        code: "RATE_LIMITED",
        error: "Demo launch limit reached — please try again in a little while.",
        retry_after_s: gate.retryAfterS,
      },
      { status: 429 },
    );
  }

  const secret =
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    "";
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Demo provisioning is not configured." },
      { status: 500 },
    );
  }

  let data: Record<string, unknown>;
  let status = 502;
  try {
    const res = await fetch(`${getBackendOrigin()}/api/v1/demo/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    status = res.status;
    data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (e) {
    console.error("[demo/provision] backend unreachable", e);
    return NextResponse.json(
      { success: false, error: "Could not reach the demo service. Please retry." },
      { status: 502 },
    );
  }

  if (status === 429) {
    return NextResponse.json(
      {
        success: false,
        code: "DEMO_AT_CAPACITY",
        error: "All demo classrooms are in use right now — please try again in a few minutes.",
      },
      { status: 429 },
    );
  }
  if (!resOk(status) || (data as { subdomain?: string }).subdomain === undefined) {
    return NextResponse.json(
      { success: false, error: "Demo launch failed. Please retry." },
      { status: 502 },
    );
  }
  return NextResponse.json({ success: true, ...data }, { status: 200 });
}

function resOk(status: number): boolean {
  return status >= 200 && status < 300;
}
