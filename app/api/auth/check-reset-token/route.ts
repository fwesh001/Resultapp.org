import { NextRequest, NextResponse } from "next/server";
import { postAuth, readJson } from "@/lib/api/authProxy";

/** POST /api/auth/check-reset-token — pre-flight, does NOT consume the token. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { email, token, scope } = body as { email?: string; token?: string; scope?: string };
  if (!email || !token) {
    return NextResponse.json({ error: "email and token are required" }, { status: 400 });
  }
  return postAuth("check-reset-token", { email, token, scope: scope ?? "schools" });
}
