import { NextRequest, NextResponse } from "next/server";
import { postAuth, readJson } from "@/lib/api/authProxy";

/** POST /api/auth/verify-email — consume a verification token (single use). */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { email, token } = body as { email?: string; token?: string };
  if (!email || !token) {
    return NextResponse.json({ error: "email and token are required" }, { status: 400 });
  }
  return postAuth("verify-email", { email, token });
}
