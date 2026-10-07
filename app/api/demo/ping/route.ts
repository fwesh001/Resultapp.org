import { NextResponse } from "next/server";

/** TEMPORARY diagnostic probe — removed after the /api/demo/provision 502 is root-caused. */
export async function GET() {
  return NextResponse.json({ probe: "demo-ping-get-ok" }, { status: 200 });
}

export async function POST() {
  return NextResponse.json({ probe: "demo-ping-post-ok" }, { status: 200 });
}
