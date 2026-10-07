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

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} demo-isolation checks passed`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
console.log("Demo isolation verified: ephemeral tenants cannot touch production.\n");
