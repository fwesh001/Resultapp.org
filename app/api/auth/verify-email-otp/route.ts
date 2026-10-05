import { NextRequest, NextResponse } from "next/server";
import { postAuth, readJson } from "@/lib/api/authProxy";

/**
 * POST /api/auth/verify-email-otp
 *
 * Consumes the 6-digit code from Step 1. A wrong / expired / replayed /
 * attempt-capped code all come back as 200 with {verified:false} and one
 * uniform message — the backend collapses them so this cannot be used as an
 * oracle. Only the 429 rate limit is surfaced as an error.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { email, code } = body as { email?: string; code?: string };
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (!code || !/^[0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "A 6-digit code is required" }, { status: 400 });
  }

  return postAuth("verify-email-otp", { email, code, purpose: "registration" });
}