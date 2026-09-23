import { NextRequest, NextResponse } from "next/server";

/**
 * Public subdomain availability check (no auth — mirrors the public
 * tenant_lookup). 200 {available:false} = taken, 404 {available:true} = free.
 * Used pre-payment so users never pay for a sniped subdomain.
 *
 * Also exposes the tenant's global currentTerm/currentSession so client
 * portals (staff sheets, result lookup) can default to the admin's term
 * while still allowing manual override (default-plus-override).
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
    return NextResponse.json({ success: false, available: false, error: "Invalid subdomain" }, { status: 400 });
  }
  try {
    const r = await fetch(`${getBackendBase()}/api/v1/tenant/${encodeURIComponent(subdomain)}`, {
      cache: "no-store",
    });
    if (r.status === 404) {
      return NextResponse.json({ success: true, available: true, subdomain }, { status: 200 });
    }
    if (!r.ok) {
      return NextResponse.json({ success: false, available: false, error: "Availability check failed" }, { status: 502 });
    }
    const data = (await r.json().catch(() => ({}))) as {
      school?: { current_term?: string | null; current_session?: string | null };
    };
    return NextResponse.json(
      {
        success: true,
        available: false,
        subdomain,
        currentTerm: data.school?.current_term?.trim() || "Term 1",
        currentSession: data.school?.current_session?.trim() || null,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("[tenant availability] fetch failed", e);
    return NextResponse.json({ success: false, available: false, error: "Could not reach registry" }, { status: 502 });
  }
}
