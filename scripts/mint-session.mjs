#!/usr/bin/env node
/**
 * Mint a legitimately signed session cookie for integration testing.
 *   node scripts/mint-session.mjs <kind> <tenant> [email]
 * Prints a bare cookie VALUE (no name= prefix).
 *
 * Uses the same SESSION_SECRET the running app reads from .env.local, so the
 * token verifies. Only useful against a local/dev instance.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

// Load SESSION_SECRET from .env.local the way Next does.
const envPath = path.join(root, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const ts = require("typescript");
const src = fs.readFileSync(path.join(root, "lib", "sessionCrypto.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", js)(
  mod.exports, require, mod, "sessionCrypto.js", path.join(root, "lib"),
);
const { signSession } = mod.exports;

const [kind, tenant, email] = process.argv.slice(2);
let payload;
if (kind === "admin") {
  payload = { admin: { email: email || "admin@test.school" }, tenant_id: tenant };
} else if (kind === "staff") {
  payload = {
    staff: { id: "11111111-1111-1111-1111-111111111111", staff_id: "STAFF/001",
             full_name: "Test Teacher", email: email || "t@test.school", role: "Teacher" },
    tenant_id: tenant,
  };
} else if (kind === "superadmin") {
  payload = { superadmin: true, admin_id: "22222222-2222-2222-2222-222222222222",
              email: email || "owner@resultapp.org", role: "owner",
              created_at: new Date().toISOString() };
} else {
  console.error("usage: node scripts/mint-session.mjs <admin|staff|superadmin> <tenant> [email]");
  process.exit(2);
}
process.stdout.write(signSession(payload));
