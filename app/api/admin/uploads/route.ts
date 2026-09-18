import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

/**
 * Branding image upload — POST /api/admin/uploads
 * FormData: { file: File, subdomain: string, kind: "logo" | "hero" }
 *
 * Stores validated images under public/uploads/<subdomain>/ and returns
 * the public URL, which the settings form saves as logo_url / hero_bg_url.
 */

const MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
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
  const subdomain = String(form.get("subdomain") ?? "")
    .toLowerCase()
    .trim();
  const kindRaw = String(form.get("kind") ?? "logo").toLowerCase().trim();
  const kind = kindRaw === "hero" ? "hero" : "logo";

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
      { success: false, error: "Only image files (png, jpg, webp, avif, gif, svg) are allowed" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: "Image must be 5MB or less" },
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
      { success: false, error: "Could not store the image" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { success: true, url: `/uploads/${subdomain}/${filename}` },
    { status: 200 },
  );
}
