#!/usr/bin/env node
/**
 * Platform Vitals guard harness — asserts server telemetry is unreachable
 * without a valid superadmin session.
 *
 *   node scripts/verify-vitals-guard.mjs
 *
 * Phase 4 shipped a new telemetry surface (server OS, kernel, disk, memory,
 * PostgreSQL connections, uptime). That data is operationally sensitive, so
 * the invariant is: NO unauthenticated or forged caller may reach it.
 *
 * Three complementary checks, because any single one can drift:
 *
 *  1. STATIC (AST) — the vitals proxy MUST call requireSuperadmin() before it
 *     does anything else, and MUST NOT reuse the frontend-only health route
 *     (which is unauthenticated and can report healthy while FastAPI is down).
 *  2. CONFIG — the backend router MUST be secret-gated, not public.
 *  3. PATH REUSE — no client code may read telemetry from an unguarded route.
 *
 * Mirrors the approach in verify-report-ui-leak.mjs (plain Node + the
 * TypeScript compiler already present as a devDependency; no test framework).
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const ts = require("typescript");

const VITALS_PROXY = path.join("app", "api", "admin", "vitals", "route.ts");
const VITALS_ROUTER = path.join("backend", "routers", "vitals.py");
const VITALS_PAGE = path.join("app", "superadmin", "(dashboard)", "vitals", "page.tsx");
const HEALTH_ROUTE = path.join("app", "api", "health", "route.ts");

const results = [];
function check(name, fn) {
  let pass = false;
  let detail = "";
  try {
    const r = fn();
    pass = r === true || r === undefined;
    if (r !== true && r !== undefined) detail = String(r);
  } catch (e) {
    pass = false;
    detail = e && e.message ? e.message : String(e);
  }
  results.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${!pass && detail ? ` — ${detail}` : ""}`);
}

function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX
  );
}

console.log("\nStatic: vitals proxy must be session-guarded before any work");

const proxySrc = fs.readFileSync(path.join(root, VITALS_PROXY), "utf8");

check("proxy calls requireSuperadmin()", () => {
  // AST scan, not a text scan: a doc comment naming requireSuperadmin() must
  // not be able to satisfy this check on its own.
  const sf = parse(VITALS_PROXY);
  let found = false;
  const visit = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "requireSuperadmin"
    ) {
      found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found ? true : "requireSuperadmin() is never actually called — the route is unauthenticated";
});

check("requireSuperadmin() is imported from the signed-session guard", () =>
  /import\s*\{[^}]*requireSuperadmin[^}]*\}\s*from\s*["']@\/lib\/superadminAuth["']/.test(proxySrc)
    ? true
    : "must import requireSuperadmin from @/lib/superadminAuth (HMAC-verified)"
);

check("requireSuperadmin() runs BEFORE the backend fetch", () => {
  const guardAt = proxySrc.indexOf("requireSuperadmin()");
  const fetchAt = proxySrc.indexOf("await fetch(");
  if (guardAt === -1) return "requireSuperadmin() not found";
  if (fetchAt === -1) return "backend fetch not found";
  return guardAt < fetchAt
    ? true
    : `fetch at offset ${fetchAt} precedes the auth guard at ${guardAt}`;
});

check("the guard's 401 response is returned, not swallowed", () =>
  /if\s*\(\s*guard\s*\)\s*return\s+guard\s*;/.test(proxySrc)
    ? true
    : "expected `if (guard) return guard;` so an unauthenticated call 401s"
);

// The historical trap: the platform has a frontend-only /api/health route that
// reports healthy regardless of backend state and carries no auth. Scan the AST
// for real string references so the explanatory comment (which deliberately
// names that route to say why it is NOT used) does not trip the check.
check("proxy does NOT source telemetry from the public health route", () => {
  const sf = parse(VITALS_PROXY);
  const offenders = [];
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) {
      if (/api\/health/.test(n.text)) {
        offenders.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: "${n.text.trim()}"`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return offenders.length === 0
    ? true
    : `proxy makes a real request to the unauthenticated health route: ${offenders.join("; ")}`;
});

check("proxy injects the shared secret server-side and never to the client", () => {
  if (!/X-API-SECRET-KEY/.test(proxySrc)) return "no X-API-SECRET-KEY header sent to the backend";
  if (/NEXT_PUBLIC_[A-Z_]*SECRET/.test(proxySrc)) return "secret referenced via a NEXT_PUBLIC_ var (leaks to browser)";
  return true;
});

check("proxy is dynamic (telemetry must never be cached)", () =>
  /export const dynamic\s*=\s*["']force-dynamic["']/.test(proxySrc)
    ? true
    : "missing `export const dynamic = 'force-dynamic'` — a cached route would serve stale metrics"
);

console.log("\nConfig: backend vitals router must be secret-gated");

const routerSrc = fs.readFileSync(path.join(root, VITALS_ROUTER), "utf8");

check("router applies the shared-secret dependency", () => {
  if (!/APIRouter\(/.test(routerSrc)) return "no APIRouter definition found";
  if (!/dependencies\s*=\s*\[\s*Depends\(_verify_superadmin_secret\)\s*\]/.test(routerSrc)) {
    return "router is not gated by _verify_superadmin_secret — it would be world-readable";
  }
  return true;
});

check("router is mounted under /api/v1/admin (never a public prefix)", () =>
  /prefix\s*=\s*["']\/api\/v1\/admin\/vitals["']/.test(routerSrc)
    ? true
    : 'expected prefix "/api/v1/admin/vitals"'
);

check("router compares the secret in constant time", () =>
  /hmac\.compare_digest/.test(routerSrc)
    ? true
    : "secret comparison must use hmac.compare_digest"
);

check("router was registered in main.py", () => {
  const mainSrc = fs.readFileSync(path.join(root, "backend", "main.py"), "utf8");
  return /from routers\.vitals import router as vitals_router/.test(mainSrc) &&
    /app\.include_router\(vitals_router\)/.test(mainSrc)
    ? true
    : "vitals_router is not imported and included in main.py";
});

console.log("\nSurface: telemetry must be reachable only through the guarded proxy");

const pageSrc = fs.readFileSync(path.join(root, VITALS_PAGE), "utf8");

check("dashboard reads telemetry from the guarded proxy only", () => {
  const hits = pageSrc.match(/\/api\/[a-z0-9/_-]+/gi) || [];
  const offenders = [...new Set(hits)].filter((h) => !h.startsWith("/api/admin/vitals"));
  return offenders.length === 0
    ? true
    : `page references other API routes: ${offenders.join(", ")}`;
});

check("dashboard page is a client component with polling", () =>
  /use client/.test(pageSrc) && /setInterval/.test(pageSrc)
    ? true
    : "page must be a client component using setInterval for the 60s poll"
);

check("poll interval is 60 seconds", () =>
  /POLL_MS\s*=\s*60_000|60\s*\*\s*1000/.test(pageSrc)
    ? true
    : "expected a 60_000ms polling interval"
);

check("guarded vitals page lives under the (dashboard) session-guarded group", () => {
  const rel = VITALS_PAGE.split(path.sep).join("/");
  return rel.startsWith("app/superadmin/(dashboard)/") ? true : `unexpected path: ${rel}`;
});

check("health route is untouched (not repurposed for telemetry)", () => {
  if (!fs.existsSync(path.join(root, HEALTH_ROUTE))) return true;
  const healthSrc = fs.readFileSync(path.join(root, HEALTH_ROUTE), "utf8");
  return /vitals/i.test(healthSrc)
    ? "the public health route now exposes vitals — that route is unauthenticated"
    : true;
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
console.log("Vitals guard verified: server telemetry requires a signed superadmin session.\n");
