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

/** Mirrors middleware.ts dedupeRepeatedPrefix(). */
function dedupeRepeatedPrefix(pathname) {
  const trimmed = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "/";
  const segments = trimmed.split("/");
  if (segments.length < 2 || segments.length % 2 !== 0) return pathname;
  const half = segments.length / 2;
  const first = segments.slice(0, half);
  const second = segments.slice(half);
  if (first.join("/") === second.join("/")) return `/${first.join("/")}`;
  return pathname;
}

/** Mirrors middleware.ts extractTenant(). Returns { slug, demoId } or null. */
function extractTenant(host, pathname = "/") {
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname) return null;
  const labels = hostname.split(".");

  if (labels.length === 2 && (labels[1] === "localhost" || labels[1] === "127.0.0.1")) {
    return labels[0] && labels[0] !== "www" ? { slug: labels[0], demoId: null } : null;
  }
  const BASE = "resultapp.org";
  if (hostname === BASE || hostname === `www.${BASE}`) return null;
  if (hostname === `demo.${BASE}`) {
    const first = pathname.split("/").filter(Boolean)[0] || "";
    const RESERVED = new Set(["www","api","admin","app","dashboard","resultapp","mail","support","help","billing","ops","status","superadmin","demo","_next","favicon"]);
    if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(first) || RESERVED.has(first)) return null;
    return { slug: first, demoId: first };
  }
  if (labels.length > 2) {
    return labels[0] && labels[0] !== "www" ? { slug: labels[0], demoId: null } : null;
  }
  return null;
}

const DEMO_ESCAPE = new Set(["about","pricing","contact","support","register","login","forgot-password","reset-password","verify-email","dashboard","privacy","terms","refund-policy","robots.txt","sitemap.xml","demo"]);

/** Mirrors the middleware() rewrite decision. */
function rewrite(host, pathname) {
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/superadmin") ||
    pathname.startsWith("/favicon") ||
    /\.[a-zA-Z]+$/.test(pathname)
  ) {
    return pathname;
  }
  const hostname = host.split(":")[0].toLowerCase();
  // Demo-host escape hatch runs BEFORE tenant extraction.
  if (hostname === "demo.resultapp.org") {
    if (pathname === "/" || pathname === "") return "/demo";
    const first = pathname.split("/").filter(Boolean)[0] || "";
    if (DEMO_ESCAPE.has(first)) return `REDIRECT:https://resultapp.org${pathname}`;
  }
  const tenant = extractTenant(host, pathname);
  if (!tenant) {
    if (hostname === "demo.resultapp.org" && (pathname === "/" || pathname === "")) {
      return "/demo";
    }
    return pathname;
  }
  const withoutSlug = normalizePath(pathname, tenant.demoId ?? tenant.slug);
  return `/${tenant.slug}${dedupeRepeatedPrefix(withoutSlug)}`;
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
  assert.deepEqual(extractTenant("vhs.resultapp.org"), { slug: "vhs", demoId: null }));
check("tenant with port detected", () =>
  assert.deepEqual(extractTenant("vhs.resultapp.org:443"), { slug: "vhs", demoId: null }));
check("vhs.localhost:3000 detected (was marketing page)", () =>
  assert.deepEqual(extractTenant("vhs.localhost:3000"), { slug: "vhs", demoId: null }));
check("vhs.127.0.0.1:3000 detected", () =>
  assert.deepEqual(extractTenant("vhs.127.0.0.1:3000"), { slug: "vhs", demoId: null }));
check("apex not a tenant", () =>
  assert.equal(extractTenant("resultapp.org"), null));
check("www apex not a tenant", () =>
  assert.equal(extractTenant("www.resultapp.org"), null));
check("bare localhost not a tenant", () =>
  assert.equal(extractTenant("localhost:3000"), null));
check("www.localhost not a tenant", () =>
  assert.equal(extractTenant("www.localhost:3000"), null));

console.log("\nPath-routed demo tenants (demo.resultapp.org/<id>)");
check("demo id extracted from first path segment", () =>
  assert.deepEqual(extractTenant("demo.resultapp.org", "/0001/admin"), { slug: "0001", demoId: "0001" }));
check("demo rewrite keeps tenant prefix once", () =>
  assert.equal(rewrite("demo.resultapp.org", "/0001/admin/login"), "/0001/admin/login"));
check("demo root path collapses to tenant root", () =>
  assert.equal(rewrite("demo.resultapp.org", "/0001"), "/0001/"));
check("bare demo host falls through (landing owns /)", () =>
  assert.equal(extractTenant("demo.resultapp.org", "/"), null));
check("bare demo host rewrites to landing page", () =>
  assert.equal(rewrite("demo.resultapp.org", "/"), "/demo"));
check("apex root untouched", () =>
  assert.equal(rewrite("resultapp.org", "/"), "/"));
check("demo marketing path escapes to apex (pricing)", () =>
  assert.equal(rewrite("demo.resultapp.org", "/pricing"), "REDIRECT:https://resultapp.org/pricing"));
check("demo escape keeps deep path + query shape", () =>
  assert.equal(rewrite("demo.resultapp.org", "/register"), "REDIRECT:https://resultapp.org/register"));
check("demo legal path escapes (privacy)", () =>
  assert.equal(rewrite("demo.resultapp.org", "/privacy"), "REDIRECT:https://resultapp.org/privacy"));
check("demo /demo canonicalizes to apex landing", () =>
  assert.equal(rewrite("demo.resultapp.org", "/demo"), "REDIRECT:https://resultapp.org/demo"));
check("production marketing path untouched (no redirect)", () =>
  assert.equal(rewrite("resultapp.org", "/pricing"), "/pricing"));
check("production tenant path untouched by escape list", () =>
  assert.equal(rewrite("vhs.resultapp.org", "/register"), "/vhs/register"));
check("reserved demo id rejected (api)", () =>
  assert.equal(extractTenant("demo.resultapp.org", "/api/x"), null));
check("reserved demo id rejected (superadmin)", () =>
  assert.equal(extractTenant("demo.resultapp.org", "/superadmin"), null));
check("reserved demo id rejected (demo)", () =>
  assert.equal(extractTenant("demo.resultapp.org", "/demo"), null));
check("short demo id rejected", () =>
  assert.equal(extractTenant("demo.resultapp.org", "/ab"), null));
check("demo system paths bypass untouched", () =>
  assert.equal(rewrite("demo.resultapp.org", "/api/tenant/0001"), "/api/tenant/0001"));
check("production rewrite unchanged by demo branch", () =>
  assert.equal(rewrite("vhs.resultapp.org", "/admin/login"), "/vhs/admin/login"));

console.log("\nDoubled route collapsing");
check("/admin/login/admin/login -> /admin/login", () =>
  assert.equal(dedupeRepeatedPrefix("/admin/login/admin/login"), "/admin/login"));
check("/admin/admin -> /admin", () =>
  assert.equal(dedupeRepeatedPrefix("/admin/admin"), "/admin"));
check("/admin/(dashboard)/results x2 collapses", () =>
  assert.equal(
    dedupeRepeatedPrefix("/admin/(dashboard)/results/admin/(dashboard)/results"),
    "/admin/(dashboard)/results",
  ));
check("single route untouched", () =>
  assert.equal(dedupeRepeatedPrefix("/admin/login"), "/admin/login"));
check("odd segment count untouched", () =>
  assert.equal(dedupeRepeatedPrefix("/a/b/c"), "/a/b/c"));
check("halves differing = untouched (real deep route)", () =>
  assert.equal(dedupeRepeatedPrefix("/admin/students/grades"), "/admin/students/grades"));
check("root untouched", () =>
  assert.equal(dedupeRepeatedPrefix("/"), "/"));
check("empty -> root", () =>
  assert.equal(dedupeRepeatedPrefix(""), "/"));

console.log("\nCombined pipeline (slug-strip then dedupe)");
const pipeline = (path, sub) => dedupeRepeatedPrefix(normalizePath(path, sub));
check("/admin/login/admin/login -> /admin/login", () =>
  assert.equal(pipeline("/admin/login/admin/login", "vhs"), "/admin/login"));
check("/vhs/admin/login/admin/login -> /admin/login (slug first, then dedupe)", () =>
  assert.equal(pipeline("/vhs/admin/login/admin/login", "vhs"), "/admin/login"));
check("/admin/login -> /admin/login (untouched)", () =>
  assert.equal(pipeline("/admin/login", "vhs"), "/admin/login"));
check("/vhs -> /", () =>
  assert.equal(pipeline("/vhs", "vhs"), "/"));
check("/vhs/admin -> /admin", () =>
  assert.equal(pipeline("/vhs/admin", "vhs"), "/admin"));

console.log(`\n${pass}/${pass + fails.length} middleware checks passed`);
if (fails.length) {
  console.log("\nFAILED:");
  for (const f of fails) console.log(f);
  process.exit(1);
}
console.log("Middleware tenant routing is sound.\n");