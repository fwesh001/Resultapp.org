import { NextResponse } from "next/server";

/** Shared helpers for superadmin proxies (server-only). */

export function getSecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

export function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

export function upstreamError(data: unknown, fallback: string) {
  const detail =
    (data as { detail?: unknown })?.detail ?? (data as { error?: unknown })?.error ?? fallback;
  return Array.isArray(detail)
    ? (detail as Array<{ msg?: string }>).map((d) => d.msg || JSON.stringify(d)).join("; ")
    : String(detail);
}

export function requireSecret() {
  const secret = getSecret();
  if (!secret) {
    return {
      error: NextResponse.json(
        { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
        { status: 500 },
      ),
    };
  }
  return { secret };
}
