#!/usr/bin/env node
/**
 * Round-trip proof for the pending-registration secret envelope, run against the
 * REAL compiled module — not a transcription of it.
 *
 * This exists because decryptSecret() once had an unreachable guard:
 * PREFIX is "enc:v1", so "enc:v1:<iv>:<tag>:<ct>".split(":") is
 * ["enc","v1",iv,tag,ct] — parts[0] is "enc", never "v1". The check
 * `parts[0] !== "v1"` therefore rejected every value encryptSecret had ever
 * produced and returned null for all of them.
 *
 * The reason it survived to production is that decryptSecret returns null
 * instead of throwing, which is correct for a corrupt row and wrong for a code
 * path that cannot decrypt ANY row. Null is indistinguishable from "this one
 * row is bad", so the webhook logged, returned 200, and never once provisioned
 * a school.
 *
 * The module is compiled and loaded for real so this cannot drift from the code
 * it is meant to police. An earlier draft transcribed encrypt/decrypt inline;
 * that version would have kept passing its own round-trip while the shipped
 * function stayed broken, which is the same class of mistake as scanning the
 * wrong bundle and calling a live deployment broken.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); }
};

/* ---- compile and load the real module ---- */
const SRC = "lib/pendingRegistrationCrypto.ts";
const outDir = mkdtempSync(join(tmpdir(), "envelope-"));
let mod;
try {
  // Invoke the compiler entrypoint directly rather than through `npx`:
  // on Windows npx is a shell shim that execFileSync cannot launch without a
  // shell, and a failing spawn here would be indistinguishable from a compile
  // error.
  const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
  execFileSync(
    process.execPath,
    [tsc, SRC, "--module", "commonjs", "--target", "es2020",
     "--esModuleInterop", "--skipLibCheck", "--outDir", outDir],
    { stdio: "pipe" },
  );
  const require = createRequire(import.meta.url);
  mod = require(join(outDir, "pendingRegistrationCrypto.js"));
} catch (e) {
  console.error("FATAL: could not compile the real module");
  console.error(String(e.stdout || "") + String(e.stderr || ""));
  process.exit(1);
}

const { encryptSecret, decryptSecret, isEncryptedSecret } = mod;
check("real module loaded (encryptSecret is a function)", typeof encryptSecret === "function");
check("real module loaded (decryptSecret is a function)", typeof decryptSecret === "function");
if (typeof encryptSecret !== "function" || typeof decryptSecret !== "function") process.exit(1);

const SECRET = "test-only-passphrase-not-a-real-secret";

// The real functions read the key from the environment, not from an argument —
// so this test has to stand the environment up rather than pass a value in.
process.env.PENDING_REGISTRATION_SECRET = SECRET;

/* The bug itself. */
const enc = encryptSecret("Str0ng-Passw0rd!");
check(
  "encrypt -> decrypt round-trips (the regression that shipped broken)",
  decryptSecret(enc) === "Str0ng-Passw0rd!",
  "the REAL decryptSecret returned something other than the original password",
);
check("envelope is non-empty and prefixed enc:v1:", enc.startsWith("enc:v1:"));
check("envelope splits into five colon segments", enc.split(":").length === 5);
check(
  "parts[0]='enc' and parts[1]='v1' (the two segments the guard must read)",
  enc.split(":")[0] === "enc" && enc.split(":")[1] === "v1",
);

/* Every value must round-trip, not just the first. */
for (const v of ["a", "hunter2", "p@ssw0rd-with-symbols!#%", "x".repeat(200), "🔐 unicode ✓"]) {
  check(`round-trips value (${v.length} chars)`, decryptSecret(encryptSecret(v)) === v);
}

/* Fresh IV per call. */
const a = encryptSecret("same");
const b = encryptSecret("same");
check("each encryption uses a fresh IV", a !== b);
check("both still decrypt to the same value",
  decryptSecret(a) === "same" && decryptSecret(b) === "same");

/* Failure modes must fail CLOSED and stay distinguishable from success. */
const tamper = (s, i) => { const p = s.split(":"); p[i] = p[i].slice(0, -2) + "AA"; return p.join(":"); };
check("tampered ciphertext is rejected", decryptSecret(tamper(enc, 4)) === null);
check("tampered auth tag is rejected", decryptSecret(tamper(enc, 3)) === null);
check("tampered IV is rejected", decryptSecret(tamper(enc, 2)) === null);
check("truncated envelope is rejected", decryptSecret(enc.slice(0, 20)) === null);
check("plaintext is rejected", decryptSecret("just-a-password") === null);
check("null and undefined are rejected",
  decryptSecret(null) === null && decryptSecret(undefined) === null);

/* A wrong key must yield null, not a garbage password. */
process.env.PENDING_REGISTRATION_SECRET = "a-different-secret";
check("wrong key is rejected (returns null, never garbage)", decryptSecret(enc) === null);
process.env.PENDING_REGISTRATION_SECRET = SECRET;

/* A missing key must throw at encrypt time, never silently store plaintext. */
const saved = process.env.PENDING_REGISTRATION_SECRET;
delete process.env.PENDING_REGISTRATION_SECRET;
let threw = false;
try { encryptSecret("x"); } catch { threw = true; }
check("a missing PENDING_REGISTRATION_SECRET throws instead of storing plaintext", threw);
process.env.PENDING_REGISTRATION_SECRET = saved;

/* Double-sealing guard used by seal(). */
check("isEncryptedSecret recognises an envelope", isEncryptedSecret(enc) === true);
check("isEncryptedSecret rejects plaintext", isEncryptedSecret("plain-password") === false);

/* The known-broken guard must not come back. */
const src = readFileSync(SRC, "utf8");
check("shipped guard reads BOTH prefix segments",
  /parts\[0\]\s*!==\s*["']enc["']/.test(src) && /parts\[1\]\s*!==\s*["']v1["']/.test(src),
  "the unreachable parts[0] !== 'v1' form must not return");
check("shipped destructuring skips both prefix segments",
  /const\s*\[\s*,\s*,\s*ivB64/.test(src),
  "expected const [, , ivB64, tagB64, ctB64] = parts");

console.log("");
for (const f of failures) console.log(`  [FAIL] ${f}`);
console.log(`\n${"=".repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(62)}`);
console.log(
  fail === 0
    ? "Envelope verified against the real module: passwords round-trip, every tamper fails closed."
    : "ENVELOPE BROKEN — the webhook cannot read parked passwords.",
);
process.exit(fail === 0 ? 0 : 1);