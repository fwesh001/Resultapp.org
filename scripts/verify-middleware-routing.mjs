/**
 * Middleware routing regression tests.
 *
 * These encode the exact bugs being fixed:
 *   - vhs.resultapp.org/vhs  404'd because the rewrite produced /vhs/vhs
 *   - vhs.localhost:3000 fell through to the marketing site because the old
 *     "two labels or fewer means bare domain" rule swallowed it
 *   - apex / www must pass through untouched
 *
 * normalizePath is duplicated here (rather than imported) because middleware.ts
 * is TypeScript for the Next build; this script runs directly under node. The
 * two must stay in sync — the assertions below pin the behaviour.
 */
import assert from "node:assert";

function normalizePath(pathname, subdomain) {
  const prefix = `/${subdomain}`;
  if (pathname === prefix) return "/";
  if (pathname.startsWith(`${prefix}/`)) {
    return pathname.slice(prefix.length) || "/";
  }
  return pathname;
}

/** Mirrors middleware.ts extractTenant(). */
function extractTenant(host) {
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname) return null;
  const labels = hostname.split(".");

  if (labels.length === 2 && (labels[1] === "localhost" || labels[1] === "127.0.0.1")) {
    return labels[0] && labels[0] !== "www" ? labels[0] : null;
  }
  const BASE = "resultapp.org";
  if (hostname === BASE || hostname === `www.${BASE}`) return null;
  if (labels.length > 2) {
    return labels[0] && labels[0] !== "www" ? labels[0] : null;
  }
  return null;
}

let pass = 0;
const fails = [];

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    fails.push(`  [FAIL] ${name}: ${err.message}`);
  }
}

console.log("\nPath normalization");
check("root stays root", () => assert.equal(normalizePath("/", "vhs"), "/"));
check("nested admin path untouched", () =>
  assert.equal(normalizePath("/admin/login", "vhs"), "/admin/login"));
check("slug-as-path collapses to root (was /vhs/vhs -> 404)", () =>
  assert.equal(normalizePath("/vhs", "vhs"), "/"));
check("slug with trailing slash collapses to root", () =>
  assert.equal(normalizePath("/vhs/", "vhs"), "/"));
check("slug + nested path collapses to nested", () =>
  assert.equal(normalizePath("/vhs/admin/login", "vhs"), "/admin/login"));
check("prefix-lookalike NOT stripped (/vhsadmin)", () =>
  assert.equal(normalizePath("/vhsadmin", "vhs"), "/vhsadmin"));
check("different slug NOT stripped", () =>
  assert.equal(normalizePath("/other", "vhs"), "/other"));
check("stripped once, not recursively", () =>
  assert.equal(normalizePath("/vhs/vhs", "vhs"), "/vhs"));

console.log("\nTenant detection");
check("production tenant host detected", () =>
  assert.equal(extractTenant("vhs.resultapp.org"), "vhs"));
check("tenant with port detected", () =>
  assert.equal(extractTenant("vhs.resultapp.org:443"), "vhs"));
check("vhs.localhost:3000 detected (was marketing page)", () =>
  assert.equal(extractTenant("vhs.localhost:3000"), "vhs"));
check("vhs.127.0.0.1:3000 detected", () =>
  assert.equal(extractTenant("vhs.127.0.0.1:3000"), "vhs"));
check("apex not a tenant", () =>
  assert.equal(extractTenant("resultapp.org"), null));
check("www apex not a tenant", () =>
  assert.equal(extractTenant("www.resultapp.org"), null));
check("bare localhost not a tenant", () =>
  assert.equal(extractTenant("localhost:3000"), null));
check("www.localhost not a tenant", () =>
  assert.equal(extractTenant("www.localhost:3000"), null));

console.log(`\n${pass}/${pass + fails.length} middleware checks passed`);
if (fails.length) {
  console.log("\nFAILED:");
  for (const f of fails) console.log(f);
  process.exit(1);
}
console.log("Middleware tenant routing is sound.\n");