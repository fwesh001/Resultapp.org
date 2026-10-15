import { NextResponse } from "next/server";

/**
 * POST /api/moderator/session — exchange a valid staff_session for a
 * moderator admin_session, with NO credential prompt.
 *
 * ══ WHY THIS EXISTS ══
 * A promoted moderator used to be told "Admin Portal", which dropped them into
 * a page branded as the school ADMIN's and demanding "Admin ID or Email". They
 * were already signed in; the link threw that away and asked them to
 * re-authenticate as something they are not. The capability boundary was always
 * correct — this is about not making a deputy feel handed the keys.
 *
 * ══ WHY IT IS SAFE TO SKIP THE PROMPT ══
 * The backend already lets a moderator mint an admin_session by typing their
 * Staff ID and PIN (admin_auth.py store 2). So this grants nothing new — it
 * removes a step. But the PIN was also the ONLY thing standing between a stolen
 * staff_session and the deputy surface, and skipping it removes that barrier.
 * So this route is deliberately paranoid:
 *
 *   1. Requires a validly SIGNED staff_session for THIS tenant. The MAC now
 *      covers the cookie name, so a staff token cannot be replayed as an admin
 *      token (lib/sessionCrypto macInput).
 *   2. Re-reads `is_moderator` from the DATABASE on every call. Never from the
 *      cookie's own claim — a staff_session captured while the person WAS a
 *      moderator would otherwise keep minting admin sessions for the full 12h
 *      after a demotion. `getStaffDashboard` is `cache: "no-store"`.
 *   3. Mints `role: "moderator"` explicitly, never by omission. normalizeRole
 *      now returns null for an unrecognised role and readAdminIdentity rejects
 *      the session, so an omitted field cannot become ADMIN_CAPABILITIES.
 *   4. Shorter TTL than the staff session, so a demotion lands sooner.
 *   5. Populates `admin.email`, falling back to the staff id. `requireAdminSession`
 *      (lib/adminAuth) hard-requires admin.email, and many staff rows have none —
 *      backend sets `"email": mod.get("email") or None`. Without this a legitimate
 *      moderator 401s on 14 API routes and the feature reads as broken.
 *
 * ══ WHY IT GUARDS ITSELF ══
 * middleware.ts bypasses every `/api/*` path (its own bypass list). Nothing at
 * the edge protects this route; it is entirely on the checks above.
 */

import { readStaffSession } from "@/lib/staffAuth";
import { getStaffDashboard } from "@/lib/staffDashboard";
import { setSessionCookie, SESSION_COOKIES } from "@/lib/session";
import { buildSessionClaims } from "@/lib/capabilities";

/**
 * Shorter than SESSION_TTL_SECONDS (12h) on purpose. The staff session is
 * re-verified from the database on every call to this route, but the DERIVED
 * admin session is what the pages actually read — so the window in which a
 * demoted moderator keeps a working one is bounded by this TTL.
 */
const DERIVED_TTL_SECONDS = 60 * 60 * 2; // 2h

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // An empty body is fine — the subdomain can also come from the Origin host.
  }

  const subdomain = String(
    body.subdomain ??
      body.tenant_id ??
      new URL(req.url).searchParams.get("tenant_id") ??
      "",
  )
    .toLowerCase()
    .trim();

  if (!subdomain) {
    return NextResponse.json(
      { success: false, error: "Missing subdomain" },
      { status: 400 },
    );
  }

  // 1. A validly signed staff session FOR THIS TENANT. readStaffSession verifies
  //    the HMAC and binds the tenant, so a session for another school is rejected
  //    before anything else happens.
  const staff = await readStaffSession(subdomain);
  if (!staff) {
    return NextResponse.json(
      { success: false, error: "Sign in to the Staff Portal first." },
      { status: 401 },
    );
  }

  // 2. LIVE check against the database. The signed cookie's is_moderator is a
  //    snapshot from sign-in time; trusting it means a captured cookie keeps
  //    working for up to 12h after demotion. No DB row, no session.
  const dashboard = await getStaffDashboard(subdomain, staff.staffId);
  const liveIsModerator =
    (dashboard as { staff?: { is_moderator?: unknown } } | null)?.staff?.is_moderator === true;

  if (!liveIsModerator) {
    return NextResponse.json(
      {
        success: false,
        error: "You do not have Moderator access for this school.",
      },
      { status: 403 },
    );
  }

  // 3. Mint. `forcedRole: "moderator"` so the claim is stated rather than
  //    inferred — the whole point of normalizeRole failing closed is that an
  //    omitted role cannot be mistaken for admin.
  const liveRole = (dashboard as { staff?: { role?: unknown } } | null)?.staff?.role;
  const claims = buildSessionClaims({}, "moderator");

  const payload = {
    admin: {
      // 5. The email fallback. requireAdminSession requires this field, so a
      //    staff row without an email still gets a working session — the
      //    capability checks never look at the value, only its presence.
      email: staff.email ?? `${staff.staffId}@moderator.local`,
      staff_id: staff.staffId,
      full_name: staff.fullName ?? undefined,
      school_name: null,
      email_verified: true,
    },
    tenant_id: subdomain,
    // Carried for the audit trail so an entry written under this session is
    // attributed to the STAFF identity, never to the school's admin.
    role: claims.role,
    capabilities: claims.capabilities,
    moderator_staff_role: typeof liveRole === "string" && liveRole.trim() ? liveRole.trim() : undefined,
  };

  try {
    await setSessionCookie(SESSION_COOKIES.admin, payload, DERIVED_TTL_SECONDS);
  } catch (e) {
    // Never hand back success the client would treat as authenticated.
    console.error("[moderator session] signing failed", e);
    return NextResponse.json(
      { success: false, error: "Could not start your Moderator session." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, role: claims.role }, { status: 200 });
}