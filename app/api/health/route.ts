import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "resultapp.org frontend",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
}
