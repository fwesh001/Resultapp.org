import { NextRequest, NextResponse } from "next/server";
import { postAuth, readJson } from "@/lib/api/authProxy";

/**
 * POST /api/auth/request-verification
 *
 * Always forwards, and the backend returns the SAME 200 whether or not the
 * address exists — so this route cannot be used to discover which emails are
 * registered. A 502 means "we tried and could not send", which is safe to
 * surface because it only ever happens for a real account.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { email, scope } = body as { email?: string; scope?: string };
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  return postAuth("request-verification", { email, scope: scope ?? "schools" });
}
