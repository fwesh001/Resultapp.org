import { NextResponse } from "next/server";
import { clearSessionCookie, SESSION_COOKIES } from "@/lib/session";

/**
 * POST /api/admin/logout — clears the signed `admin_session` cookie.
 */
export async function POST() {
  // Path is passed explicitly so the delete matches the cookie that was set.
  const cleared = await clearSessionCookie(SESSION_COOKIES.admin);
  if (!cleared) {
    // Do not report a sign-out that did not happen while a live credential
    // remains in the browser.
    return NextResponse.json(
      { success: false, error: "Could not clear session cookie" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
