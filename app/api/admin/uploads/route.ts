import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAdminSession } from "@/lib/adminAuth";

/**
 * File upload — POST /api/admin/uploads
 * FormData: { file: File, subdomain?: string, kind?: string }
 *
 * Stores validated files in Vercel Blob and returns the CDN URL. Used for
 * branding images (logo/hero via the settings form), bug-report attachments,
 * and other shared uploads.
 *
 * WHY BLOB AND NOT THE FILESYSTEM
 * --------------------------------
 * This route previously did:
 *     mkdir(process.cwd()/public/uploads/<sub>) ; writeFile(...)
 * That worked on a traditional long-lived Node host, but this app is deployed
 * to Vercel, where the serverless filesystem is READ-ONLY at runtime (only
 * /tmp is writable). Every write threw `EROFS: read-only file system` and the
 * catch surfaced "Could not store the file" — uploads were 100% broken, for
 * branding AND for the unauthenticated "shared" bug-report bucket.
 *
 * It was also broken twice over: `public/uploads/` is gitignored, so nothing
 * exists in the deployment, and Vercel only serves static files that were
 * present AT BUILD TIME. Even a successful write would have produced a URL
 * that 404'd.
 *
 * Blob gives us a real, CDN-backed, durable store. The returned URL is an
 * absolute https URL, so every existing consumer (logo_url, hero_bg_url,
 * principal_signature_url) keeps working unchanged — no schema change, no
 * backend change.
 *
 * KNOWN, ACCEPTED RISK (LEGAL_REMEDIATION.md P7): Blob stores are PUBLIC by
 * default, so anyone holding the URL can read the asset. That is the same
 * exposure the old static-file approach had, so this is not a regression — but
 * it does NOT resolve P7 either. Handwritten signatures are biometric-adjacent
 * personal data (lib/legal/privacy.ts). The Digital Signature Pad deliberately
 * does NOT use this route; it stores base64 inline in an authenticated API
 * response instead.
 */

/**
 * 4 MB. Vercel's own request-body ceiling for serverless functions is 4.5 MB,
 * so the previous 5 MB cap could NEVER succeed — files that size died with an
 * opaque 413 from the platform before our own 400 ever ran. Keeping the cap
 * under that ceiling means oversized files fail with a message we control.
 */
const MAX_BYTES = 4_000_000;

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

  // Tenant branding uploads require an admin session; the "shared" bucket
  // stays public for bug-report attachments from unauthenticated pages.
  if (subdomain !== "shared") {
    const guard = await requireAdminSession(subdomain);
    if (guard) return guard;
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
      { success: false, error: "File must be 4MB or less" },
      { status: 400 },
    );
  }

  // `kind` and `subdomain` are already sanitized to [a-z0-9-] above, so the
  // blob pathname cannot contain traversal sequences. The extension comes from
  // a closed allow-list. Blob treats the pathname as an opaque key anyway —
  // it is never used as a filesystem path.
  const filename = `${kind}-${Date.now()}.${ext}`;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const blob = await put(`uploads/${subdomain}/${filename}`, bytes, {
      access: "public",
      contentType: file.type,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return NextResponse.json({ success: true, url: blob.url }, { status: 200 });
  } catch (e) {
    console.error("[api/admin/uploads] blob put failed", e);
    // Surface the most actionable message we can without leaking internals.
    const msg =
      e instanceof Error && /token|BLOB_READ_WRITE_TOKEN/i.test(e.message)
        ? "Upload storage is not configured. Please contact support."
        : "Could not store the file";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}