import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/** POST /api/superadmin/logout — clears the superadmin session cookie. */
export async function POST() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("superadmin_session");
  } catch (e) {
    console.warn("[superadmin logout] cookie delete failed", e);
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
