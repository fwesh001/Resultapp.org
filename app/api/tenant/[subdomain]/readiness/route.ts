import { NextRequest, NextResponse } from "next/server";

/**
 * Portal readiness for the registration wizard's progress indicator.
 *
 * Separate from /api/tenant/[subdomain] because that endpoint answers an
 * availability question ({available: true|false}); mixing a provisioning
 * progress payload into it would make the pre-payment sniping check ambiguous.
 *
 * The backend probes the tenant subdomain server-to-server. The browser cannot:
 * a cross-origin fetch resolves opaquely for both a 200 and Cloudflare's 525,
 * so it has no way to tell "portal is live" from "certificate not issued yet".
 */

function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ subdomain: string }> },
) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();
  if (!/^[a-z0-9-]{3,30}$/.test(subdomain)) {
    return NextResponse.json(
      { ready: false, percent: 0, stage: "Invalid subdomain" },
      { status: 400 },
    );
  }

  try {
    const r = await fetch(
      `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(subdomain)}/readiness`,
      { cache: "no-store", signal: AbortSignal.timeout(45000) },
    );
    if (!r.ok) {
      return NextResponse.json(
        { ready: false, percent: 30, stage: "Setting up your portal" },
        { status: 200 },
      );
    }
    const data = (await r.json().catch(() => ({}))) as {
      ready?: boolean;
      percent?: number;
      stage?: string;
    };
    return NextResponse.json(
      {
        ready: data.ready === true,
        percent: Number.isFinite(data.percent) ? data.percent : 40,
        stage: data.stage || "Setting up your portal",
      },
      { status: 200 },
    );
  } catch (e) {
    console.error("[tenant readiness] fetch failed", e);
    // Never surface a failure to the wizard — a 525 window is expected and the
    // UI must keep polling rather than showing an error.
    return NextResponse.json(
      { ready: false, percent: 35, stage: "Setting up your portal" },
      { status: 200 },
    );
  }
}