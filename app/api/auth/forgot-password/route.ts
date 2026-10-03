import { NextRequest, NextResponse } from "next/server";
import { postAuth, readJson } from "@/lib/api/authProxy";

/**
 * POST /api/auth/forgot-password
 *
 * Always returns the neutral 200 for unknown addresses — see the backend for
 * why enumeration matters here (this would otherwise map the tenant roster).
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { email, scope } = body as { email?: string; scope?: string };
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  return postAuth("forgot-password", { email, scope: scope ?? "schools" });
}
