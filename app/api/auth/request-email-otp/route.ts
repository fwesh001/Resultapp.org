import { NextRequest, NextResponse } from "next/server";
import { postAuth, readJson } from "@/lib/api/authProxy";

/**
 * POST /api/auth/request-email-otp
 *
 * Backs Step 1 of the registration wizard. Not session-guarded — a prospective
 * school admin has no account yet, which is the entire point.
 *
 * The backend returns a neutral 200 for unknown addresses (registration is
 * exactly where "unknown email" and "email already taken" are both sensitive),
 * but an honest 502/503 when mail itself failed. postAuth passes that message
 * through, so the wizard can show a real reason instead of spinning.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { email } = body as { email?: string; purpose?: string };
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  return postAuth("request-email-otp", { email, purpose: "registration" });
}