#!/usr/bin/env node
/**
 * Session cookie signing — negative-test harness for LEGAL_REMEDIATION.md P0-0.
 *
 *   node scripts/verify-session-signing.mjs
 *
 * Runs in plain Node against lib/sessionCrypto.ts, which is deliberately free of
 * `next/headers` so the crypto can be exercised without a request context. No
 * test framework is installed in this repo, and adding one for this file would
 * be a larger change than the thing being tested.
 *
 * The tests that matter are the NEGATIVE ones. P0-0 was an authentication
 * bypass, so the assertion that matters is that every way of making a cookie
 * that is not ours is rejected — not that the happy path signs correctly.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

// sessionCrypto is TypeScript. Compile it in-memory with a tiny transform
// (strip type-only syntax) rather than adding a build step or a dependency.
process.env.SESSION_SECRET ||= randomBytes(32).toString("base64url");

const { signSession, verifySession, SESSION_VERSION } = (() => {
  // Use the TypeScript compiler that is already a devDependency.
  const ts = require("typescript");
  const fs = require("node:fs");
  const src = fs.readFileSync(path.join(here, "..", "lib", "sessionCrypto.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", js)(
    mod.exports,
    require,
    mod,
    "sessionCrypto.js",
    path.join(here, "..", "lib"),
  );
  return mod.exports;
})();

const SECRET = process.env.SESSION_SECRET;
const results = [];

function check(name, fn) {
  let pass = false;
  let detail = "";
  try {
    const r = fn();
    pass = r === true || r === undefined;
    if (r !== true && r !== undefined) detail = String(r);
  } catch (e) {
    detail = `threw: ${e.message}`;
  }
  results.push({ name, pass, detail });
}

function macOf(message) {
  return createHmac("sha256", SECRET).update(message, "utf8").digest("base64url");
}

// ── happy path ─────────────────────────────────────────────────────────────
check("signs a payload into v1.<payload>.<mac>", () => {
  const t = signSession({ admin: { email: "a@b.c" }, tenant_id: "vhs" });
  return t.split(".").length === 3 && t.startsWith(`${SESSION_VERSION}.`) === true;
});

check("verifies a freshly signed payload", () => {
  const claims = verifySession(signSession({ tenant_id: "vhs", admin: { email: "a@b.c" } }));
  return claims?.tenant_id === "vhs" && claims?.admin?.email === "a@b.c";
});

check("adds iat and exp to the signed claims", () => {
  const c = verifySession(signSession({ tenant_id: "vhs" }));
  return Number.isFinite(c?.iat) && Number.isFinite(c?.exp) && c.exp > c.iat;
});

// ── negative: the P0-0 bypass itself ───────────────────────────────────────
check("REJECTS legacy unsigned JSON (the original bypass)", () => {
  // Exactly the payload that used to authenticate as platform superadmin.
  return verifySession(JSON.stringify({ superadmin: true })) === null;
});

check("REJECTS unsigned admin JSON for a real tenant", () => {
  return (
    verifySession(JSON.stringify({ admin: { email: "attacker@evil.test" }, tenant_id: "vhs" })) ===
    null
  );
});

check("REJECTS unsigned staff JSON for a real tenant", () => {
  return (
    verifySession(JSON.stringify({ staff: { id: "x", staff_id: "STAFF/1" }, tenant_id: "vhs" })) ===
    null
  );
});

// ── negative: tampering ────────────────────────────────────────────────────
check("REJECTS a flipped byte in the payload", () => {
  const t = signSession({ tenant_id: "vhs", admin: { email: "a@b.c" } });
  const [v, p, m] = t.split(".");
  const flipped = p.slice(0, -2) + (p.slice(-2, -1) === "A" ? "B" : "A") + p.slice(-1);
  return verifySession(`${v}.${flipped}.${m}`) === null;
});

check("REJECTS a zeroed MAC", () => {
  const t = signSession({ tenant_id: "vhs" });
  const [v, p] = t.split(".");
  const zeroMac = Buffer.alloc(32).toString("base64url");
  return verifySession(`${v}.${p}.${zeroMac}`) === null;
});

check("REJECTS a truncated MAC", () => {
  const t = signSession({ tenant_id: "vhs" });
  const [v, p, m] = t.split(".");
  return verifySession(`${v}.${p}.${m.slice(0, 10)}`) === null;
});

check("REJECTS a valid MAC transplanted onto a different payload", () => {
  const good = signSession({ tenant_id: "vhs", admin: { email: "a@b.c" } });
  const [, pGood, mGood] = good.split(".");
  const other = Buffer.from(
    JSON.stringify({ tenant_id: "vhs", admin: { email: "attacker@evil.test" }, iat: 1, exp: 9e9 }),
    "utf8",
  ).toString("base64url");
  return verifySession(`${SESSION_VERSION}.${other}.${mGood}`) === null;
});

check("REJECTS a payload with no MAC at all", () => {
  const t = signSession({ tenant_id: "vhs" });
  return verifySession(t.split(".").slice(0, 2).join(".")) === null;
});

check("REJECTS a MAC computed with a different secret", () => {
  const t = signSession({ tenant_id: "vhs" });
  const [v, p] = t.split(".");
  const evil = randomBytes(32).toString("base64url");
  const evilMac = createHmac("sha256", evil).update(`${v}.${p}`, "utf8").digest("base64url");
  return verifySession(`${v}.${p}.${evilMac}`) === null;
});

// ── negative: format and version ───────────────────────────────────────────
check("REJECTS an unknown format version", () => {
  const t = signSession({ tenant_id: "vhs" });
  const [, p, m] = t.split(".");
  return verifySession(`v9.${p}.${m}`) === null;
});

check("REJECTS non-base64url junk", () => {
  return verifySession("v1.!!!!.@@@@") === null;
});

check("REJECTS an array payload", () => {
  const p = Buffer.from(JSON.stringify([1, 2, 3]), "utf8").toString("base64url");
  return verifySession(`${SESSION_VERSION}.${p}.${macOf(`${SESSION_VERSION}.${p}`)}`) === null;
});

check("REJECTS a signed token with no exp", () => {
  const p = Buffer.from(JSON.stringify({ tenant_id: "vhs", iat: 1 }), "utf8").toString("base64url");
  return verifySession(`${SESSION_VERSION}.${p}.${macOf(`${SESSION_VERSION}.${p}`)}`) === null;
});

check("REJECTS a signed token with a non-numeric exp", () => {
  const p = Buffer.from(
    JSON.stringify({ tenant_id: "vhs", iat: 1, exp: "tomorrow" }),
    "utf8",
  ).toString("base64url");
  return verifySession(`${SESSION_VERSION}.${p}.${macOf(`${SESSION_VERSION}.${p}`)}`) === null;
});

// ── negative: expiry (the old maxAge was browser-only) ─────────────────────
check("REJECTS a validly signed but EXPIRED token", () => {
  const p = Buffer.from(
    JSON.stringify({ tenant_id: "vhs", iat: 1000, exp: 2000 }),
    "utf8",
  ).toString("base64url");
  return verifySession(`${SESSION_VERSION}.${p}.${macOf(`${SESSION_VERSION}.${p}`)}`) === null;
});

check("REJECTS a token expiring exactly now", () => {
  const now = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ tenant_id: "vhs", iat: 1, exp: now }), "utf8").toString(
    "base64url",
  );
  return verifySession(`${SESSION_VERSION}.${p}.${macOf(`${SESSION_VERSION}.${p}`)}`) === null;
});

// ── degenerate inputs must not throw ───────────────────────────────────────
for (const [label, value] of [
  ["undefined", undefined],
  ["null", null],
  ["empty string", ""],
  ["whitespace", "   "],
  ["single dot", "."],
  ["many dots", "v1.a.b.c.d.e"],
]) {
  check(`returns null (never throws) for ${label}`, () => verifySession(value) === null);
}

// ── report ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
console.log("=".repeat(72));
console.log("SESSION SIGNING VERIFICATION — P0-0");
console.log("=".repeat(72));
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
}
console.log("-".repeat(72));
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const r of failed) console.log(`   - ${r.name}`);
  process.exit(1);
}
console.log("All negative cases rejected. Forgery of a session cookie is closed.");
