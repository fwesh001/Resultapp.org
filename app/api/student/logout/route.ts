import { NextResponse } from "next/server";
import { clearSessionCookie, SESSION_COOKIES } from "@/lib/session";

/**
 * POST /api/student/logout
 *
 * Clears the student session. Deliberately clears ONLY the student cookie —
 * an admin or staff who happens to be signed in on the same browser must not be
 * logged out of their own portal by a student tapping "Sign out" on a shared
 * family device. That scenario is the whole reason this endpoint is separate
 * from the bulk clearAllSessionCookies() helper.
 */
export async function POST() {
  const ok = await clearSessionCookie(SESSION_COOKIES.student);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: "Could not clear the session" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}