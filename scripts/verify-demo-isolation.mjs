#!/usr/bin/env node
/**
 * Demo-isolation guards.
 *
 * Ephemeral demo tenants must NEVER touch production surfaces: no Vercel /
 * Cloudflare writes, no emails, no payments, no MRR pollution, no indexing.
 * Each invariant below is one whose violation would be silent in normal
 * testing (demos "work" either way) but dangerous at scale.
 *
 *   node scripts/verify-demo-isolation.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

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

const demoSvc = read(path.join("backend", "services", "demo.py"));
const demoRouter = read(path.join("backend", "routers", "demo.py"));
const main = read(path.join("backend", "main.py"));
const admin = read(path.join("backend", "routers", "admin.py"));
const notifier = read(path.join("backend", "services", "notifications.py"));
const middleware = read("middleware.ts");
const robots = read(path.join("app", "robots.ts"));
const tenant = read(path.join("lib", "tenant.ts"));
const registerSchool = read(path.join("app", "api", "register-school", "route.ts"));

console.log("\nDemo provisioning touches nothing external");
check("demo service never imports Vercel/Cloudflare helpers", () =>
  /vercel_domains|CLOUDFLARE|_cf_api|api\.vercel\.com/.test(demoSvc)
    ? "demo.py reaches for domain/DNS infrastructure"
    : true
);
check("demo service never sends email", () =>
  /send_welcome_email|send_verification_email|dispatch_event|Brevo|brevo/i.test(demoSvc)
    ? "demo.py can send mail"
    : true
);
check("demo router never touches payments", () =>
  /flutterwave|Flutterwave|transaction_id|amount_ngn/.test(demoRouter)
    ? "demo router handles money"
    : true
);
check("demo seed writes are deterministic (fixed RNG seed)", () =>
  /random\.Random\(\s*(?:\d+|[A-Z_]+)\s*\)/.test(demoSvc) && /DEMO_RNG_SEED\s*=\s*\d+/.test(demoSvc)
    ? true
    : "no fixed seed — demos would differ per launch"
);

console.log("\nDemo namespace cannot collide with paid tenants");
check("paid provisioning rejects the demo- prefix", () =>
  /startswith\("demo-"\)/.test(main) ? true : "main.py provision has no demo- guard"
);
check("sweep LIKE pattern escapes the hyphen-prefix correctly", () =>
  /LIKE 'demo-%%'/.test(demoSvc) ? true : "sweep prefix match is wrong (LIKE 'demo%' would match real tenants)"
);
check("sweep has an age gate and a row limit", () =>
  /created_at < NOW\(\)/.test(demoSvc) && /LIMIT %s/.test(demoSvc)
    ? true
    : "sweep can delete young or unbounded rows"
);
check("demo tx_refs rejected by paid registration", () =>
  /demo\[-_\]/.test(registerSchool) ? true : "register-school proxy does not reject demo tx_refs"
);

console.log("\nDemo rows excluded from production aggregates");
check("MRR queries exclude demo subdomains", () =>
  (admin.match(/subdomain NOT LIKE 'demo-%'/g) || []).length >= 2
    ? true
    : "platform stats can count demo ledger rows as revenue"
);
check("notification broadcasts skip demo tenants", () =>
  /subscription_status.*<> 'demo'/.test(notifier) ? true : "broadcasts fan out to demo inboxes"
);

console.log("\nDemo traffic is unindexable and unroutable to system paths");
check("middleware tags demo responses noindex", () =>
  /X-Robots-Tag.*noindex, nofollow/.test(middleware) ? true : "no X-Robots-Tag on demo responses"
);
check("robots.ts disallows the demo host", () =>
  /demo\.resultapp\.org/.test(robots) && /disallow: "\/"/.test(robots)
    ? true
    : "robots.ts has no demo-host branch"
);
check("demo ids cannot shadow reserved paths", () =>
  /RESERVED_DEMO_IDS/.test(middleware) && /"superadmin"/.test(middleware)
    ? true
    : "no reserved-id guard on the demo branch"
);

console.log("\nDemo UI is strictly flag-gated");
check("isDemoTenant is data-driven, not hostname-driven", () => {
  const m = tenant.match(/export function isDemoTenant[\s\S]*?\n\}/);
  if (!m) return "isDemoTenant helper missing";
  if (/hostname|window\.location|headers\(\)/.test(m[0])) {
    return "demo detection sniffs the hostname instead of the registry flag";
  }
  return true;
});

console.log("\nSession resumption (cookie + Continue)");
const demoProxy = read(path.join("app", "api", "demo", "provision", "route.ts"));
const launcher = read(path.join("components", "demo", "DemoLauncher.tsx"));
check("proxy enforces max 2 launches per IP per hour", () =>
  /MAX_PER_WINDOW = 2/.test(demoProxy) ? true : "proxy limit is not 2/hour"
);
check("active_demo cookie is cross-subdomain with 1h TTL", () => {
  if (!/ACTIVE_DEMO_COOKIE = "active_demo"/.test(demoProxy)) return "cookie name missing in proxy";
  if (!/ACTIVE_DEMO_DOMAIN = "\.resultapp\.org"/.test(demoProxy)) return "cookie is not shared across subdomains";
  if (!/ACTIVE_DEMO_MAX_AGE_S = 3600/.test(demoProxy)) return "cookie TTL is not 1 hour";
  return true;
});
check("launcher cookie name matches the proxy writer", () => {
  const a = /ACTIVE_DEMO_COOKIE = "([^"]+)"/.exec(demoProxy);
  const b = /ACTIVE_DEMO_COOKIE = "([^"]+)"/.exec(launcher);
  if (!a || !b) return "cookie constant missing on one side";
  return a[1] === b[1] ? true : `proxy writes ${a[1]} but launcher reads ${b[1]}`;
});
check("Continue verifies liveness before reuse", () =>
  /\/api\/tenant\//.test(launcher) && /available/.test(launcher)
    ? true
    : "Continue does not check the classroom still exists"
);
check("swept classroom degrades to fresh launch", () =>
  /clearActiveDemo/.test(launcher) ? true : "stale cookie is never cleared"
);

console.log("\nEscape hatches and polish");
const demoBanner = read(path.join("components", "demo", "DemoBanner.tsx"));
const layoutFooter = read(path.join("components", "layout", "Footer.tsx"));
const modal = read(path.join("components", "ui", "Modal.tsx"));
check("banner register link is absolute", () =>
  /href="https:\/\/resultapp\.org\/register"/.test(demoBanner)
    ? true
    : "banner link is relative and would misroute on the demo host"
);
check("footer Demo link is absolute and in Product list", () => {
  const start = layoutFooter.indexOf("Product");
  if (start < 0) return "Product section not found in footer";
  const product = layoutFooter.slice(start, layoutFooter.indexOf("</ul>", start));
  if (!product.includes("https://demo.resultapp.org")) return "Demo link is not absolute";
  return />Demo<\/a>/.test(product) ? true : "Demo link not inside the Product list";
});
check("modal close button pinned top-right", () =>
  /absolute right-4 top-4/.test(modal) ? true : "modal X is not pinned top-right"
);
check("landing pill removed", () => {
  const landing = read(path.join("app", "demo", "page.tsx"));
  return /INTERACTIVE DEMO/.test(landing) ? "pill copy still present" : true;
});

console.log("\nContextual help");
const helpDict = read(path.join("lib", "demoHelpContent.ts"));
const demoHelp = read(path.join("components", "demo", "DemoHelp.tsx"));
check("help covers login, roster, billing, grading + fallback", () => {
  // Route matchers are written as /\/admin\/login/ — strip escapes so the
  // assertions read as the paths a visitor actually visits.
  const flat = helpDict.replace(/\\/g, "");
  for (const re of [/\/admin\/login/, /\/staff\/login/, /\/admin\/billing/, /grading/]) {
    if (!re.test(flat)) return `no dictionary entry matching ${re}`;
  }
  return /DEMO_HELP_FALLBACK/.test(helpDict) ? true : "no fallback guide";
});
check("accordion is single-open with aria wiring", () =>
  /openIndex === i/.test(demoHelp) && /aria-expanded/.test(demoHelp) && /aria-controls/.test(demoHelp)
    ? true
    : "help accordion is not single-open/accessible"
);
check("auto-open is login-only and session-gated", () => {
  if (!/LOGIN_PATH_RE/.test(demoHelp)) return "no login-path gate on auto-open";
  if (!/sessionStorage/.test(demoHelp)) return "auto-open is not once-per-session";
  return true;
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} demo-isolation checks passed`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
console.log("Demo isolation verified: ephemeral tenants cannot touch production.\n");
