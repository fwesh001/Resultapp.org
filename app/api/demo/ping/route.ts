import { NextResponse } from "next/server";

/** TEMPORARY diagnostic probe — removed after the /api/demo/provision 502 is root-caused. */
export async function GET() {
  return NextResponse.json({ probe: "demo-ping-get-ok" }, { status: 200 });
}

export async function POST() {
  const started = Date.now();
  try {
    const res = await fetch("http://159.223.178.34:8000/api/v1/demo/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-SECRET-KEY": "wrong-key-probe" },
      cache: "no-store",
    });
    const text = await res.text();
    return NextResponse.json(
      { probe: "fetch-ok", backendStatus: res.status, ms: Date.now() - started, bodyHead: text.slice(0, 120) },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { probe: "fetch-threw", ms: Date.now() - started, error: String(e).slice(0, 200) },
      { status: 200 },
    );
  }
}
