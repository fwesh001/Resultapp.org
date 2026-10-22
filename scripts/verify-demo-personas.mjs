#!/usr/bin/env node
/**
 * Demo persona onboarding guards.
 *
 * The seeder creates a curated cast; the UI advertises it. These checks pin
 * the WIRING between the two halves, so the credentials card can never drift:
 *
 *   node scripts/verify-demo-personas.mjs
 *
 * (Row-level correctness against a live database is a deployment check — the
 * static layer here mirrors scripts/verify-demo-isolation.mjs style.)
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
const personasLib = read(path.join("lib", "demoPersonas.ts"));
const credCard = read(path.join("components", "demo", "DemoCredentialsCard.tsx"));
const demoHelp = read(path.join("components", "demo", "DemoHelp.tsx"));
const demoBanner = read(path.join("components", "demo", "DemoBanner.tsx"));
const launcher = read(path.join("components", "demo", "DemoLauncher.tsx"));
const tenantLayout = read(path.join("app", "[subdomain]", "layout.tsx"));
const tenantHome = read(path.join("app", "[subdomain]", "page.tsx"));
const helpDict = read(path.join("lib", "demoHelpContent.ts"));

// Extract persona IDs from the manifest once, so the expected sets are derived
// rather than re-listed by hand here.
const studentIds = [...personasLib.matchAll(/studentId: "(STD\d+)"/g)].map((m) => m[1]);
const staffIds = [...personasLib.matchAll(/staffId: "(DEMO-\S+?)"/g)].map((m) => m[1]);

console.log("\nSeeder produces the advertised cast");
check("personas lib advertises staff personas", () =>
  new Set(staffIds).size >= 4 ? true : `only ${staffIds.length} staff personas found`
);
check("personas lib advertises student personas", () =>
  new Set(studentIds).size >= 5 ? true : `only ${studentIds.length} student personas found`
);
for (const id of new Set(staffIds)) {
  check(`demo.py seeds ${id}`, () => (demoSvc.includes(id) ? true : "not referenced by the seeder"));
}
for (const id of new Set(studentIds)) {
  check(`demo.py seeds ${id}`, () => (demoSvc.includes(id) ? true : "not referenced by the seeder"));
}

console.log("\nCredentials card renders the whole manifest");
check("student panel iterates the manifest (no hand-listed rows)", () =>
  /DEMO_STUDENT_PERSONAS\.map/.test(credCard)
    ? true
    : "card lists students manually — new personas would silently not render"
);
check("staff panel iterates the manifest", () =>
  /DEMO_STAFF_PERSONAS\.map/.test(credCard) ? true : "card lists staff manually"
);
check("card resolves persona action tokens (no literal ** links)", () =>
  /function resolveHref/.test(credCard) && /\*\*admin-login\*\*/.test(credCard)
    ? true
    : "action tokens are not resolved to tenant paths"
);
check("admin email derives from the subdomain (per-tenant, never hardcoded)", () =>
  /demoAdminEmail\(subdomain\)/.test(credCard)
    ? true
    : "card does not build the demo admin email from the tenant id"
);

console.log("\nOnboarding surfaces are wired for demo tenants only");
check("tenant layout gates the help guide on isDemoTenant", () =>
  /isDemoTenant/.test(tenantLayout) && /demo && <DemoHelp/.test(tenantLayout)
    ? true
    : "DemoHelp renders for non-demo tenants"
);
check("homepage strip is demo-gated", () =>
  /school\.demo &&\s*\(/.test(tenantHome) && /DemoCredentialsCard/.test(tenantHome)
    ? true
    : "homepage credentials strip is missing or not demo-gated"
);
check("strip uses the compact variant", () =>
  /variant="strip"/.test(tenantHome)
    ? true
    : "homepage renders the full modal card inside the hero"
);

console.log("\nAuto-open + trigger plumbing (one flag, one event, multiple triggers)");
check("provisioning writes the once-flag before redirecting", () =>
  launcher.includes("DEMO_GUIDE_STORAGE_KEY") && /sessionStorage\.setItem/.test(launcher) && /window\.location\.href = data\.url/.test(launcher)
    ? true
    : "launcher does not write DEMO_GUIDE_STORAGE_KEY before redirecting"
);
check("launcher reads the flag constant from the shared lib", () =>
  /import \{ DEMO_GUIDE_STORAGE_KEY \} from "@\/lib\/demoPersonas"/.test(launcher)
    ? true
    : "flag name re-declared locally in the launcher — drift risk"
);
check("guide consumes and clears the once-flag", () =>
  demoHelp.includes("DEMO_GUIDE_STORAGE_KEY") && /removeItem/.test(demoHelp)
    ? true
    : "DemoHelp does not consume the post-provision flag — the popup would replay on reload"
);
check("banner makes the guide reachable from any page", () =>
  demoBanner.includes("DEMO_GUIDE_EVENT") && /dispatchEvent/.test(demoBanner)
    ? true
    : "DemoBanner cannot reopen the guide"
);
check("guide listens for the banner trigger", () =>
  /addEventListener/.test(demoHelp) && demoHelp.includes("DEMO_GUIDE_EVENT")
    ? true
    : "DemoHelp does not listen for the open-guide event"
);
check("guide renders the credentials card with the tenant id", () =>
  /<DemoCredentialsCard/.test(demoHelp) && /<DemoHelp subdomain=\{subdomain\}/.test(tenantLayout)
    ? true
    : "DemoHelp does not include the credentials card bound to the tenant id"
);
check("login pages remain auto-open surfaces", () =>
  /\/\(admin\|staff\|student\)\\\/login/.test(demoHelp)
    ? true
    : "LOGIN_PATH_RE no longer covers all three login portals"
);

console.log("\nHelp copy teaches the personas");
check("FAQs name the moderator persona story", () =>
  /Moderator/.test(helpDict) ? true : "help copy never mentions the Moderator Console"
);
check("FAQs name the seeded student cases", () => {
  for (const id of ["STD001", "STD002", "STD013", "STD020"]) {
    if (!helpDict.includes(id)) return `demoHelpContent.ts never mentions ${id}`;
  }
  return true;
});

console.log(`\n${results.length - results.filter((r) => !r.pass).length}/${results.length} demo-persona checks passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}

console.log("\nReseeded-state walkthrough (what each persona must render):");
const matrix = [
  ["STD001", "public link", 'locked "Sign in to view result" preview'],
  ["STD001", "student sign-in", "full published report card (the Scholar)"],
  ["STD002", "any viewer", '"Result Withheld — Administrative Hold (fees)"'],
  ["STD003", "student sign-in", 'published + "No academic records found … (e.g. absent)"'],
  ["STD013", "public link", '"No Published Result" 404 (unpublished draft)'],
  ["STD013", "admin session", 'blurred "Draft — Pending Publication" preview'],
  ["STD020", "student sign-in", '"No results published yet" dashboard'],
  ["STD001", "?academic_session=2025/2026", "prior-session archive card"],
];
for (const [sid, viewer, expected] of matrix) {
  console.log(`  - ${sid} · ${viewer} → ${expected}`);
}
console.log("Demo personas verified.\n");
