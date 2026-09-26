import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { cookies } from "next/headers";

/**
 * Staff file upload — POST /api/staff/uploads
 * FormData: { file: File }
 *
 * Staff-scoped sibling of /api/admin/uploads: requires a valid staff_session
 * (tenant-scoped) and stores validated signature images under
 * public/uploads/<tenant>/ with a fixed `signature` kind prefix.
 * Tightened constraints per spec: PNG/JPG only, ≤1MB.
 */

const MAX_BYTES = 1 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

interface StaffSession {
  staff?: { id?: string; staff_id?: string };
  tenant_id?: string;
}

export async function POST(req: NextRequest) {
  let tenant = "";
  try {
    const raw = (await cookies()).get("staff_session")?.value;
    if (!raw) {
      return NextResponse.json({ success: false, error: "Unauthorized — please sign in again" }, { status: 401 });
    }
    const session = JSON.parse(raw) as StaffSession;
    tenant = String(session?.tenant_id || "").toLowerCase().trim();
    if (!tenant || !session?.staff || !/^[a-z0-9-]{3,30}$/.test(tenant)) {
      return NextResponse.json({ success: false, error: "Unauthorized — please sign in again" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized — please sign in again" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
  }

  const ext = MIME_TO_EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { success: false, error: "Only PNG or JPG signature images are allowed" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: "Signature image must be 1MB or less" },
      { status: 400 },
    );
  }

  const filename = `signature-${Date.now()}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads", tenant);

  try {
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, filename), bytes);
  } catch (e) {
    console.error("[api/staff/uploads] write failed", e);
    return NextResponse.json({ success: false, error: "Could not store the file" }, { status: 500 });
  }

  return NextResponse.json(
    { success: true, url: `/uploads/${tenant}/${filename}` },
    { status: 200 },
  );
}
