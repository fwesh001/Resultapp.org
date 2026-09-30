import { NextResponse } from "next/server";
import { clearSessionCookie, SESSION_COOKIES } from "@/lib/session";

/**
 * POST /api/staff/logout — clears the signed `staff_session` cookie.
 *
 * This route did not exist. Staff had no sign-out path anywhere in the UI or
 * the API, so `staff_session` lived for its full 12-hour TTL with no way to
 * end it early — and Privacy Policy §5 claimed these cookies are "deleted on
 * sign-out", which was false for staff.
 */
export async function POST() {
  // No bare `delete(name)` with no path — the delete must match the path the
  // cookie was set on or the browser keeps it.
  const cleared = await clearSessionCookie(SESSION_COOKIES.staff);
  if (!cleared) {
    // Previously these routes swallowed the failure and still returned
    // success, which reports a sign-out that did not happen while a live
    // credential remains in the browser.
    return NextResponse.json(
      { success: false, error: "Could not clear session cookie" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
