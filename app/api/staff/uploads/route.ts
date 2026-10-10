import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { readStaffSession } from "@/lib/staffAuth";
import { clearSessionCookie, SESSION_COOKIES } from "@/lib/session";

/**
 * Staff file upload — POST /api/staff/uploads
 * FormData: { file: File }
 *
 * Staff-scoped sibling of /api/admin/uploads: requires a valid HMAC-verified
 * staff_session (tenant-scoped) and stores validated signature images in Vercel
 * Blob with a fixed `signature` kind prefix.
 * Tightened constraints per spec: PNG/JPG only, ≤1MB.
 *
 * WHY BLOB AND NOT THE FILESYSTEM
 * --------------------------------
 * This route previously wrote to `process.cwd()/public/uploads/<tenant>/`.
 * That cannot work on Vercel, where the serverless filesystem is READ-ONLY at
 * runtime (only /tmp is writable) — every write raised `EROFS` and surfaced as
 * "Could not store the file". It was broken a second time over as well:
 * `public/uploads/` is gitignored so nothing ships, and Vercel only serves
 * static files present AT BUILD TIME, so even a successful write would have
 * 404'd. See app/api/admin/uploads/route.ts for the fuller note.
 *
 * PRIVACY NOTE (LEGAL_REMEDIATION.md P7): Blob stores are PUBLIC — anyone
 * holding the URL can read the asset. That is the same exposure the old static
 * route had, so this is a storage-location fix, not a privacy fix. The Digital
 * Signature Pad does NOT use this route; it stores base64 inline in an
 * authenticated API response so a signature is never publicly addressable.
 */

const MAX_BYTES = 1 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export async function POST(req: NextRequest) {
  const unauthorized = async () => {
    await clearSessionCookie(SESSION_COOKIES.staff);
    return NextResponse.json(
      { success: false, error: "Unauthorized — please sign in again" },
      { status: 401 },
    );
  };

  // readStaffSession already rejects anything outside ^[a-z0-9-]{3,30}$; this
  // is a second, explicit guard because the value is used to build a blob path.
  let tenant = "";
  try {
    const identity = await readStaffSession();
    if (!identity || !/^[a-z0-9-]{3,30}$/.test(identity.tenantId)) {
      return await unauthorized();
    }
    tenant = identity.tenantId;
  } catch {
    return await unauthorized();
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

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const blob = await put(`uploads/${tenant}/${filename}`, bytes, {
      access: "public",
      contentType: file.type,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return NextResponse.json({ success: true, url: blob.url }, { status: 200 });
  } catch (e) {
    console.error("[api/staff/uploads] blob put failed", e);
    const msg =
      e instanceof Error && /token|BLOB_READ_WRITE_TOKEN/i.test(e.message)
        ? "Upload storage is not configured. Please contact support."
        : "Could not store the file";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}