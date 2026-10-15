import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminSession, requireAdminCapability } from "@/lib/adminAuth";
import { MAX_SIGNATURE_DATA_BYTES, MAX_SIGNATURE_LABEL } from "@/lib/signatureLimits";

/**
 * Settings Proxy — PATCH /api/admin/settings
 * Body: { subdomain, school_name?, motto?, phone?, email?, address?, new_term_begins?, logo_url?, hero_bg_url? }
 *
 * Securely forwards the payload to FastAPI
 * PATCH /api/v1/tenant/{tenant_id}/profile with X-API-SECRET-KEY,
 * then revalidates the tenant cache so landing + layout pick up changes.
 */

function getProxySecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

const PROFILE_FIELDS = [
  "school_name",
  "motto",
  "phone",
  "email",
  "address",
  "current_term",
  "current_session",
  "new_term_begins",
  "logo_url",
  "hero_bg_url",
  "id_prefix",
  "staff_id_prefix",
"principal_signature_url",
    "principal_signature_data",
  ] as const;

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const record = body as Record<string, unknown>;
  const subdomain = String(
    record.subdomain ?? record.tenantId ?? record.tenant_id ?? "",
  )
    .toLowerCase()
    .trim();

  if (!subdomain) {
    return NextResponse.json(
      { success: false, error: "Missing subdomain" },
      { status: 400 },
    );
  }

  const guard = await requireAdminSession(subdomain);
  if (guard) return guard;

  // The SESSION check above only proves *someone* is signed in for this school.
  // The page gate in app/[subdomain]/admin/settings/page.tsx already requires
  // the `settings` capability, which lib/capabilities.ts lists as ADMIN-ONLY —
  // but that gate is client-observable, so a moderator could simply call this
  // endpoint directly and rewrite the school name, motto, phone, logo, term or
  // ID prefixes that the page deliberately hides from them.
  //
  // Defence in depth: both the page and the proxy must enforce it, because the
  // proxy is the only one the attacker does not choose to skip.
  //
  // The email field stays additionally gated by the OTP flow in the backend, so
  // this changes nothing for the legitimate admin path — including the
  // Verify-then-auto-save flow, which runs on an admin session.
  const capGuard = await requireAdminCapability(subdomain, "settings");
  if (capGuard) return capGuard;

  const payload: Record<string, unknown> = {};
  let signatureDataProvided = false;
  for (const field of PROFILE_FIELDS) {
    if (record[field] !== undefined) {
      const raw = record[field];
      if (field === "id_prefix" && typeof raw === "string") {
        payload[field] = raw.trim().toLowerCase();
      } else if (field === "staff_id_prefix" && typeof raw === "string") {
        // Uppercase preserved (e.g. STAFF/) — backend validates format.
        payload[field] = raw.trim();
      } else if (field === "principal_signature_data") {
        // Drawn signature: an inline base64 PNG data URI. NOT trimmed like the
        // other strings — base64 is whitespace-sensitive and the backend
        // normalizes/validates it. Reject an oversized payload here so the
        // user gets our message rather than a generic backend 422.
        if (typeof raw !== "string") {
          return NextResponse.json(
            { success: false, error: "principal_signature_data must be a string" },
            { status: 422 },
          );
        }
        if (raw.trim().length > MAX_SIGNATURE_DATA_BYTES) {
          return NextResponse.json(
            {
              success: false,
              error: `Signature is too large (max ${MAX_SIGNATURE_LABEL})`,
            },
            { status: 422 },
          );
        }
        payload[field] = raw.trim();
        signatureDataProvided = true;
      } else {
        payload[field] =
          typeof raw === "string" ? (raw as string).trim() : raw;
      }
    }
  }

  // Single-signature rule, mirrored from the backend: when a drawn signature is
  // supplied it supersedes the uploaded URL. Forward ONLY the field the caller
  // actually set — sending both would let the URL win and silently discard a
  // freshly drawn signature.
  if (signatureDataProvided) {
    delete payload.principal_signature_url;
  }

  // Email-change proof, forwarded outside PROFILE_FIELDS because it is not a
  // profile COLUMN — it is evidence. Keeping it out of the column allow-list is
  // what stops it being persisted into `schools` by a future edit that widens
  // that list to "whatever the form sends".
  //
  // Forwarded verbatim, untrusted. The backend re-consumes the code itself, so
  // a client that sends otp_verified=true without a real code still fails.
  if (record.otp_verified === true && typeof record.otp_code === "string") {
    payload.otp_verified = true;
    payload.otp_code = record.otp_code.trim();
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json(
      { success: false, error: "No profile fields provided" },
      { status: 400 },
    );
  }

  const secret = getProxySecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Server misconfigured: missing BACKEND_API_SECRET" },
      { status: 500 },
    );
  }

  const rawHost = getBackendBase().split("/api/v1")[0].replace(/\/$/, "");
  const backendUrl = `${rawHost}/api/v1/tenant/${encodeURIComponent(subdomain)}/profile`;

  let backendRes: Response;
  try {
    backendRes = await fetch(backendUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-SECRET-KEY": secret,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[api/admin/settings] backend fetch failed", e);
    return NextResponse.json(
      { success: false, error: "Could not reach profile service" },
      { status: 502 },
    );
  }

  const text = await backendRes.text();
  let backendData: unknown;
  try {
    backendData = JSON.parse(text);
  } catch {
    backendData = { raw: text };
  }

  if (!backendRes.ok) {
    const detail =
      (backendData as { detail?: unknown })?.detail ??
      (backendData as { error?: unknown })?.error ??
      text;
    const msg = Array.isArray(detail)
      ? (detail as Array<{ msg?: string }>)
          .map((d) => d.msg || JSON.stringify(d))
          .join("; ")
      : String(detail);
    console.error(`[api/admin/settings] backend ${backendRes.status}: ${msg}`);
    return NextResponse.json(
      { success: false, error: msg, raw: backendData },
      { status: backendRes.status },
    );
  }

  try {
    (revalidateTag as unknown as (tag: string, profile?: string) => void)(
      `school-${subdomain}`,
      "max",
    );
  } catch (e) {
    console.warn("[api/admin/settings] revalidateTag failed", e);
  }

  return NextResponse.json(backendData, { status: 200 });
}
