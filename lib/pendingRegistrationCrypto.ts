import crypto from "node:crypto";

/**
 * Encryption for the pending-registration hold.
 *
 * THE PROBLEM
 * -----------
 * Closing the "paid but never provisioned" gap means parking the registration
 * server-side before checkout opens, so the webhook can finish the job if the
 * browser never comes back. That hold necessarily contains the school's admin
 * password — it is the credential the portal is created with.
 *
 * The password cannot go into the checkout `meta`, because Flutterwave retains
 * transaction metadata and that would disclose a credential to a third party
 * the school never agreed to share it with. That exclusion is a remediated P0
 * and is not being revisited here.
 *
 * So the credential is encrypted before it reaches the database. The table
 * stores ciphertext; a database dump, a read-only SQL mistake, or a leaked
 * backup does not yield a working password for any school.
 *
 * WHY A DEDICATED KEY
 * -------------------
 * `PENDING_REGISTRATION_SECRET`, not `SESSION_SECRET`. Reusing the session key
 * would mean a payload encrypted here can also be decrypted by anything that
 * can read sessions, so the two compromise surfaces merge into one. A separate
 * key keeps "can forge a session" and "can read a parked password" distinct,
 * and rotating one does not invalidate the other.
 *
 * The format is self-describing — `enc:v1:<iv>:<tag>:<ciphertext>`, all
 * base64url — so the version is a prefix rather than a configuration value, and
 * a future AES-GCM key change cannot silently misread old rows.
 */

const PREFIX = "enc:v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit IV, the GCM-recommended size
const KEY_BYTES = 32; // AES-256

function getKey(): Buffer {
  const raw = (process.env.PENDING_REGISTRATION_SECRET || "").trim();
  if (!raw) {
    throw new Error(
      "PENDING_REGISTRATION_SECRET is not set. Pending registrations cannot be " +
        "stored safely, so the hold endpoint must refuse. Generate 32+ random " +
        "bytes (e.g. `openssl rand -base64 48`) and set it on the deployment.",
    );
  }
  // scrypt lets an operator supply a human-typed passphrase of any reasonable
  // length and still get a 256-bit key. A raw 32-byte base64 value also works
  // because the salt is fixed per-purpose and the secret itself is the entropy.
  return crypto.scryptSync(raw, "resultapp:pending-registration:v1", KEY_BYTES);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error("encryptSecret called with an empty value");
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a value produced by encryptSecret.
 *
 * Returns null rather than throwing for anything malformed. A row that cannot
 * be decrypted is a row this deployment cannot act on — failing closed means
 * the school is flagged for manual review instead of being provisioned with a
 * garbage password.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored || typeof stored !== "string") return null;
  // PREFIX is "enc:v1", so the serialized form is enc:v1:<iv>:<tag>:<ct> and
  // splitting on ":" yields FIVE parts: ["enc", "v1", iv, tag, ct].
  //
  // This guard used to read `parts[0] !== "v1"`, which is unreachable — parts[0]
  // is always "enc" — so every value produced by encryptSecret was rejected and
  // decryptSecret returned null for all of them. It failed silently by design
  // (see below), so the webhook safety net appeared healthy while never being
  // able to read a single parked password. The prefix occupies TWO segments.
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") return null;
  try {
    const [, , ivB64, tagB64, ctB64] = parts;
    const decipher = crypto.createDecipheriv(
      ALGO,
      getKey(),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const out = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]);
    return out.toString("utf8");
  } catch {
    // Wrong key, tampered ciphertext, or a truncated row. All equally
    // "cannot use this row".
    return null;
  }
}

/** True when a stored value is one of ours (used to avoid double-encrypting). */
export function isEncryptedSecret(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}
