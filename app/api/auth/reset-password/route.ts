import { NextRequest, NextResponse } from "next/server";
import { postAuth, readJson } from "@/lib/api/authProxy";

/**
 * POST /api/auth/reset-password
 *
 * The new password goes straight to the backend, which writes it with
 * pgcrypto bcrypt in the same statement that clears the token. This proxy never
 * handles the password beyond forwarding it.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { email, token, new_password: newPassword, scope } = body as {
    email?: string;
    token?: string;
    new_password?: string;
    scope?: string;
  };
  if (!email || !token || !newPassword) {
    return NextResponse.json(
      { error: "email, token and new password are required" },
      { status: 400 },
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }
  return postAuth("reset-password", { email, token, new_password: newPassword, scope: scope ?? "schools" });
}
