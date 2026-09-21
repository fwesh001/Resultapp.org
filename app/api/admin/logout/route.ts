import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * POST /api/admin/logout — clears the httpOnly `admin_session` cookie.
 */
export async function POST() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("admin_session");
  } catch (e) {
    console.warn("[admin logout] cookie delete failed", e);
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
