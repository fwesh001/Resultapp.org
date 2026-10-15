import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cryptographic session cookie primitives.
 *
 * Pure module: NO `next/headers`, NO cookie access, NO React. That split is
 * deliberate — this file can be exercised in plain Node by
 * `scripts/verify-session-signing.mjs` without a request context, which is the
 * only cheap way to test the crypto exhaustively.
 *
 * Server-only. Do not import from a client component: it pulls in `node:crypto`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Before this module, `admin_session`, `staff_session` and `superadmin_session`
 * were raw unsigned JSON. `lib/superadminAuth.ts` documented the model as
 * "validity = presence + well-formed". Setting a cookie value was therefore
 * sufficient to authenticate as *any* tenant admin or as platform superadmin
 * with no credential at all. See LEGAL_REMEDIATION.md P0-0.
 *
 * ── Wire format ────────────────────────────────────────────────────────────
 *     v1.<base64url(payload_json)>.<base64url(HMAC-SHA256)>
 *
 * The MAC covers the ASCII bytes of `v1.<payload_b64url>`, so both the payload
 * and the format version are authenticated. `v1` is a format version, not a
 * secret: rotating the scheme does not require rotating the key.
 *
 * `iat` and `exp` live INSIDE the signed material, so expiry is enforced by us.
 * The previous `maxAge` cookie attribute was honoured only by the browser,
 * which meant a forged cookie never expired at all.
 */

/** Format version. Bump to invalidate every outstanding cookie. */
export const SESSION_VERSION = "v1";

/** 12 hours, matching the previous `maxAge` on all three cookies. */
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

/** Minimum accepted SESSION_SECRET length. Enforced in production. */
export const SESSION_SECRET_MIN_LENGTH = 32;

export interface SessionTimes {
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. Enforced server-side on every verification. */
  exp: number;
}

export type SessionClaims<T> = T & SessionTimes;

const isProd = () => process.env.NODE_ENV === "production";

let cachedSecret: string | null = null;
let devEphemeralSecret: string | null = null;

/**
 * Resolve the HMAC key.
 *
 * A dedicated SESSION_SECRET, and deliberately NOT BACKEND_API_SECRET: that
 * key is already attached to `X-API-SECRET-KEY` on every call to FastAPI, so it
 * sits outside the Next.js trust boundary. Reusing it would mean a backend
 * compromise yields session-forging capability.
 *
 * Production: a missing or short secret is fatal. We refuse to mint or verify
 * tokens rather than silently degrading to an unsigned or weak-key session.
 *
 * Development: falls back to a per-process ephemeral secret so local work is
 * not blocked, with a loud warning. Sessions reset on every restart, which is
 * correct-by-accident rather than a feature.
 */
export function sessionSecret(): string {
  if (cachedSecret) return cachedSecret;

  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) {
    if (configured.length >= SESSION_SECRET_MIN_LENGTH) {
      cachedSecret = configured;
      return cachedSecret;
    }
    if (isProd()) {
      throw new Error(
        `SESSION_SECRET must be at least ${SESSION_SECRET_MIN_LENGTH} characters; ` +
          `got ${configured.length}. Refusing to issue sessions.`,
      );
    }
    console.error(
      `[session] SESSION_SECRET is only ${configured.length} characters (min ${SESSION_SECRET_MIN_LENGTH}) — using an ephemeral dev secret instead.`,
    );
  } else if (isProd()) {
    throw new Error(
      "SESSION_SECRET is not set. Refusing to issue or verify sessions. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }

  if (!devEphemeralSecret) {
    devEphemeralSecret = randomBytes(32).toString("base64url");
    console.error(
      "[session] SESSION_SECRET is not set — generated an EPHEMERAL dev secret. " +
        "All sessions are invalidated on restart. Never do this in production.",
    );
  }
  return devEphemeralSecret;
}

function macFor(message: string): string {
  return createHmac("sha256", sessionSecret()).update(message, "utf8").digest("base64url");
}

/**
 * The exact string the MAC covers.
 *
 * THE COOKIE NAME IS PART OF THE AUTHENTICATED MATERIAL, and that is the whole
 * point of this function existing.
 *
 * Without it, `signSession` MACs only `v1.<payload>`, so a token minted as
 * `staff_session` verifies byte-identically when read as `admin_session`. The
 * only thing that stopped that replay was the payload SHAPE — a staff session
 * carries `staff: {...}` and `readAdminIdentity` requires `admin.email ||
 * admin.staff_id`. That is a coincidence of two differently-shaped payloads, not
 * a boundary: one refactor that copies `staff` into `admin`, or one that loosens
 * the identity check, opens cross-privilege replay with no diff anywhere near
 * the cause. scripts/verify-session-signing.mjs had no cross-cookie case at all.
 *
 * Cost of binding it: every outstanding session fails verification once on
 * deploy and everyone signs in again. That is the intended fail-closed
 * behaviour, not a regression.
 */
function macInput(name: string | null | undefined, body: string): string {
  const ns = String(name ?? "").trim();
  // An unnamed token stays verifiable by an unnamed verifier, so the pure
  // crypto helpers in scripts/ and the dev minting tool keep working. Every
  // real call site goes through setSessionCookie/readSessionCookie, which
  // ALWAYS supply a name.
  return ns ? `${ns}.${body}` : body;
}

/**
 * Sign a session payload into a cookie value.
 *
 * `name` is the cookie the token is destined for. It is authenticated (see
 * macInput) but not secret, so passing it costs nothing.
 *
 * Adds `iat`/`exp` to the payload. The caller must pass only non-secret
 * identity claims — this value ends up in a cookie and must never be returned
 * to the browser in a response body.
 */
export function signSession<T extends object>(
  payload: T,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  name?: string | null,
): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : SESSION_TTL_SECONDS;
  const claims = { ...payload, iat: now, exp: now + ttl };
  const body = `${SESSION_VERSION}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`;
  return `${body}.${macFor(macInput(name, body))}`;
}

/**
 * Verify a signed cookie value and return its claims, or `null`.
 *
 * NEVER throws and NEVER returns a partially-trusted object. Every failure mode
 * — absent, malformed, wrong version, bad base64, bad MAC, bad JSON, missing or
 * expired times — collapses to `null` so a caller cannot accidentally treat a
 * rejected cookie as a valid session.
 *
 * Rejection is fail-closed by construction: there is no code path that returns
 * claims without first passing a constant-time MAC comparison.
 *
 * Pass the cookie `name` the token was read from. A token bound to a different
 * cookie will not verify — see macInput for why that binding is load-bearing.
 */
export function verifySession<T extends object>(
  token: string | undefined | null,
  name?: string | null,
): SessionClaims<T> | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [version, payloadB64, macB64] = parts;
  if (version !== SESSION_VERSION) return null;
  if (!payloadB64 || !macB64) return null;

  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = Buffer.from(macB64, "base64url");
    // `name` MUST be the cookie the value was actually read from. A caller that
    // omits it (or passes the wrong cookie) cannot validate a name-bound token,
    // which is the safe direction: an unbound check fails rather than a bound
    // token being accepted under a weaker claim.
    expected = Buffer.from(macFor(macInput(name, `${version}.${payloadB64}`)), "base64url");
  } catch {
    return null;
  }

  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  // Returning early here leaks only the MAC length, which is not a secret.
  if (provided.length === 0 || provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;

  const { iat, exp } = claims as { iat?: unknown; exp?: unknown };
  const iatNum = Number(iat);
  const expNum = Number(exp);
  if (!Number.isFinite(iatNum) || !Number.isFinite(expNum)) return null;
  if (expNum <= Math.floor(Date.now() / 1000)) return null;

  return claims as SessionClaims<T>;
}

/** True when a cookie value carries our version prefix. Used to detect legacy cookies. */
export function looksLikeSignedSession(token: string | undefined | null): boolean {
  return typeof token === "string" && token.startsWith(`${SESSION_VERSION}.`);
}
