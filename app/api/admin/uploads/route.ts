import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * File upload — POST /api/admin/uploads
 * FormData: { file: File, subdomain?: string, kind?: string }
 *
 * Stores validated files under public/uploads/<subdomain>/ and returns
 * the public URL. Used for branding images (logo/hero via the settings
 * form), bug-report attachments, and other shared uploads.
 */

const MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid form data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const rawSubdomain = String(form.get("subdomain") ?? "").toLowerCase().trim();
  // Shared uploads (e.g. bug-report attachments) land in "shared".
  const subdomain = rawSubdomain === "" ? "shared" : rawSubdomain;
  const kind =
    String(form.get("kind") ?? "file")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 20) || "file";

  if (!/^[a-z0-9-]{3,30}$/.test(subdomain)) {
    return NextResponse.json(
      { success: false, error: "Invalid subdomain" },
      { status: 400 },
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { success: false, error: "No file provided" },
      { status: 400 },
    );
  }

  const ext = MIME_TO_EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { success: false, error: "Only image and PDF files (png, jpg, webp, avif, gif, svg, pdf) are allowed" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: "File must be 5MB or less" },
      { status: 400 },
    );
  }

  const filename = `${kind}-${Date.now()}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads", subdomain);

  try {
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, filename), bytes);
  } catch (e) {
    console.error("[api/admin/uploads] write failed", e);
    return NextResponse.json(
      { success: false, error: "Could not store the file" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { success: true, url: `/uploads/${subdomain}/${filename}` },
    { status: 200 },
  );
}
