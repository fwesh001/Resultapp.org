#!/usr/bin/env node
/**
 * Platform RBAC — negative-test harness for the Team page-allocation work
 * (LEGAL_REMEDIATION.md item 21: role separation on the Command Center).
 *
 *   node scripts/verify-superadmin-rbac.mjs
 *
 * Two layers, both verifyable offline:
 * 1. lib/platformPages.ts behaviour — owner sees everything, Team never leaks
 *    into a non-owner's effective set regardless of what a page_scope claims,
 *    explicit allocations REPLACE defaults, an unknown role resolves to [].
 * 2. STATIC wiring assertions — every /api/superadmin route names its page(s)
 *    through requireSuperadminPage, every Command Center page wrapper calls
 *    the guard before importing its client view, the login proxy refuses the
 *    identity-less path in production, and the backend router is mounted.
 *
 * The DB-level invariants (self-demotion, last-owner) are enforced in
 * services/db_manager.py and surfaced to the UI as 400s; those need a live
 * Postgres so they are covered by the backend, not by this file.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const results = [];
let failed = 0;

function check(name, fn) {
  let pass = false;
  let detail = "";
  try {
    const r = fn();
    pass = r === true || r === undefined;
    if (r !== true && r !== undefined) detail = String(r);
  } catch (e) {
    detail = `threw: ${e && e.message ? e.message : e}`;
  }
  if (!pass) failed += 1;
  results.push({ name, pass, detail });
}

// ---------------------------------------------------------------------------
// 1. lib/platformPages.ts behaviour
// ---------------------------------------------------------------------------

const { resolvePlatformPages, roleDefaultPages, PLATFORM_PAGES, OWNER_ONLY_PAGES, isPlatformPageId } =
  (() => {
    const ts = require("typescript");
    const fs = require("node:fs");
    const src = readFileSync(path.join(root, "lib", "platformPages.ts"), "utf8");
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} };
    new Function("exports", "require", "module", "filename", "dirname", js)(
      mod.exports,
      require,
      mod,
      "platformPages.js",
      path.join(root, "lib"),
    );
    return mod.exports;
  })();

check("owner resolves to every page incl. team", () =>
  JSON.stringify([...resolvePlatformPages("owner", null)].sort()) === JSON.stringify([...PLATFORM_PAGES].sort()),
);

check("admin defaults exclude team", () => !roleDefaultPages("admin").includes("team"));

check("support/mod defaults are empty", () => roleDefaultPages("support").length === 0);

check("explicit allocation replaces defaults for support", () => {
  const pages = resolvePlatformPages("support", ["tickets", "ledger"]);
  return pages.includes("tickets") && pages.includes("ledger") && pages.length === 2;
});

check("explicit allocation replaces defaults for admin", () => {
  const pages = resolvePlatformPages("admin", ["tickets"]);
  return pages.length === 1 && pages.includes("tickets");
});

check("team cannot enter a non-owner set even by claim", () => {
  const pages = resolvePlatformPages("admin", ["team", "tickets"]);
  return !pages.includes("team") && pages.length === 1;
});

check("unknown role with no allocation is empty", () => resolvePlatformPages("", null).length === 0);

check("non-array allocation falls back to role defaults", () => {
  const pages = resolvePlatformPages("admin", { pages: "tickets" });
  return pages.length === roleDefaultPages("admin").length;
});

check("isPlatformPageId rejects unknown ids", () => isPlatformPageId("dashboard") && !isPlatformPageId("control"));

check("owner-only pages are a strict subset of pages", () =>
  OWNER_ONLY_PAGES.every((p) => PLATFORM_PAGES.includes(p)));

// ---------------------------------------------------------------------------
// 2. Static wiring of the guards
// ---------------------------------------------------------------------------

const superadminAuthSrc = readFileSync(path.join(root, "lib", "superadminAuth.ts"), "utf8");
check("requireSuperadminPage exists and fails closed on empty scope", () =>
  superadminAuthSrc.includes("wanted.some((p) => access.pages.includes(p))") &&
  superadminAuthSrc.includes("status: 403"));
check("production treats an identity-less session as nothing", () => {
  const i = superadminAuthSrc.indexOf("if (!identity?.adminId) {");
  if (i < 0) return false;
  // The PROD branch inside must mint pages: [] (deny everything).
  const block = superadminAuthSrc.slice(i, i + 700);
  return block.includes("if (PROD)") && block.includes("pages: [],");
});
check("member pages resolve from the DB lookup, not the cookie claim", () =>
  superadminAuthSrc.includes("pages: member.pages ?? []"));

const guardSrc = readFileSync(path.join(root, "lib", "superadminGuard.tsx"), "utf8");
check("page guard returns inline denial (no redirect loop)", () =>
  guardSrc.includes("return <SuperadminDenied") && !guardSrc.includes(`redirect("/superadmin?denied=`));

// Every *View wrapper under the dashboard calls the enforcement before render.
const expectedPages = {
  "app/superadmin/(dashboard)/page.tsx": "dashboard",
  "app/superadmin/(dashboard)/tenants/page.tsx": "tenants",
  "app/superadmin/(dashboard)/tenants/[tenantId]/page.tsx": "tenants",
  "app/superadmin/(dashboard)/adjustments/page.tsx": "adjustments",
  "app/superadmin/(dashboard)/tickets/page.tsx": "tickets",
  "app/superadmin/(dashboard)/ledger/page.tsx": "ledger",
  "app/superadmin/(dashboard)/waivers/page.tsx": "waivers",
  "app/superadmin/(dashboard)/notifications/page.tsx": "notifications",
  "app/superadmin/(dashboard)/vitals/page.tsx": "vitals",
  "app/superadmin/(dashboard)/settings/page.tsx": "settings",
  "app/superadmin/(dashboard)/team/page.tsx": "team",
};
for (const [file, page] of Object.entries(expectedPages)) {
  let src;
  try {
    src = readFileSync(path.join(root, file), "utf8");
  } catch {
    check(`wrapper exists: ${file}`, () => false);
    continue;
  }
  check(`wrapper enforces "${page}": ${file}`, () =>
    src.includes(`enforceSuperadminPage("${page}")`),
  );
}

// Every API route under /api/superadmin names its pages.
const routeExpectations = {
  "app/api/superadmin/tenants/route.ts": ["tenants", "adjustments"],
  "app/api/superadmin/tenants/adjustments/route.ts": ["adjustments", "tenants"],
  "app/api/superadmin/tenants/[tenantId]/route.ts": ["tenants"],
  "app/api/superadmin/tenants/[tenantId]/status/route.ts": ["tenants"],
  "app/api/superadmin/tenants/[tenantId]/delete/route.ts": ["tenants"],
  "app/api/superadmin/tenants/[tenantId]/restore/route.ts": ["tenants"],
  "app/api/superadmin/tenants/[tenantId]/reset-password/route.ts": ["tenants"],
  "app/api/superadmin/tenants/[tenantId]/grant/route.ts": ["tenants", "adjustments"],
  "app/api/superadmin/tenants/[tenantId]/adjust/route.ts": ["tenants", "adjustments"],
  "app/api/superadmin/ledger/route.ts": ["ledger"],
  "app/api/superadmin/ledger/export/route.ts": ["ledger"],
  "app/api/superadmin/audit-logs/route.ts": ["ledger", "tenants"],
  "app/api/superadmin/stats/route.ts": ["dashboard"],
  "app/api/superadmin/tickets/route.ts": ["tickets"],
  "app/api/superadmin/tickets/[id]/route.ts": ["tickets"],
  "app/api/superadmin/waivers/route.ts": ["waivers"],
  "app/api/superadmin/waivers/[id]/route.ts": ["waivers"],
  "app/api/superadmin/waivers/[id]/void/route.ts": ["waivers"],
  "app/api/superadmin/notifications/broadcast/route.ts": ["notifications"],
  "app/api/superadmin/notifications/templates/route.ts": ["notifications"],
  "app/api/superadmin/notifications/templates/[eventType]/route.ts": ["notifications"],
  "app/api/admin/config/credit-price/route.ts": ["settings"],
  "app/api/admin/config/free-credits/route.ts": ["settings"],
  "app/api/admin/vitals/route.ts": ["vitals"],
  "app/api/waiver/sweep/route.ts": ["waivers"],
  "app/api/superadmin/platform-admins/route.ts": ["requireSuperadminOwner"],
  "app/api/superadmin/platform-admins/[adminId]/route.ts": ["requireSuperadminOwner"],
  "app/api/superadmin/platform-admins/[adminId]/password/route.ts": ["requireSuperadminOwner"],
};
for (const [file, tokens] of Object.entries(routeExpectations)) {
  let src;
  try {
    src = readFileSync(path.join(root, file), "utf8");
  } catch {
    check(`route exists: ${file}`, () => false);
    continue;
  }
  for (const token of tokens) {
    check(
      token === "requireSuperadminOwner"
        ? `owner-gated: ${file}`
        : `route guards "${token}": ${file}`,
      () =>
        token === "requireSuperadminOwner"
          ? src.includes("requireSuperadminOwner()")
          : src.includes('requireSuperadminPage(') && src.includes(JSON.stringify(token)),
    );
  }
}

// The identity-less login path refuses in production.
const loginSrc = readFileSync(path.join(root, "app", "api", "superadmin", "login", "route.ts"), "utf8");
check("legacy env-password login refuses in production", () =>
  /PROD && expected/.test(loginSrc) && loginSrc.includes("403"));
check("login header documents the phase-out", () => loginSrc.includes("page allocation"));

// Layout wires the scope into the shell.
const layoutSrc = readFileSync(path.join(root, "app", "superadmin", "(dashboard)", "layout.tsx"), "utf8");
check("layout resolves access and passes pages to the shell", () =>
  layoutSrc.includes("resolveSuperadminAccess") && layoutSrc.includes("allowedPages"));
check("layout keeps requireSuperadmin as the first guard", () =>
  layoutSrc.indexOf("requireSuperadmin") > -1 &&
  layoutSrc.indexOf("requireSuperadmin") < layoutSrc.indexOf("resolveSuperadminAccess"));

// The Team UI cannot mint owners server-side is a backend invariant; here the
// static check is that the create form allows only admin/support.
const teamSrc = readFileSync(path.join(root, "components", "superadmin", "TeamView.tsx"), "utf8");
check("Team create form offers only Admin/Mod roles", () =>
  teamSrc.includes('id: "admin"') && teamSrc.includes('id: "support"') &&
  !teamSrc.includes('id: "owner"'));

// Backend: the adjust endpoint + notification template exist.
const adminRouterSrc = readFileSync(path.join(root, "backend", "routers", "admin.py"), "utf8");
check("backend has the adjust endpoint with a required reason", () =>
  adminRouterSrc.includes("/tenants/{subdomain}/adjust") &&
  adminRouterSrc.includes("min 3 characters"));
check("backend rejects deduct past balance (409)", () =>
  adminRouterSrc.includes("Insufficient balance") && adminRouterSrc.includes("status_code=409"));
check("backend dispatches TOKEN_ADJUSTED after commit", () =>
  adminRouterSrc.includes('dispatch_event(\n                "TOKEN_ADJUSTED"') ||
  adminRouterSrc.includes('"TOKEN_ADJUSTED"'));
check("backend writes DEDUCT ledger rows", () => adminRouterSrc.includes("DEDUCT_CREDITS"));

const dbSrc = readFileSync(path.join(root, "backend", "services", "db_manager.py"), "utf8");
check("notification template TOKEN_ADJUSTED is seeded", () => dbSrc.includes('"event_type": "TOKEN_ADJUSTED"'));
check("platform_admins gains page_scope column (idempotent)", () =>
  dbSrc.includes("ADD COLUMN IF NOT EXISTS page_scope JSONB"));
check("last-owner guard exists", () =>
  dbSrc.includes("_assert_last_owner_guard") && dbSrc.includes("last active owner"));
check("self-modification guard exists", () =>
  dbSrc.includes("You cannot change your own role or deactivate yourself"));

// Backend router mounted.
const mainSrc = readFileSync(path.join(root, "backend", "main.py"), "utf8");
check("platform admins router is mounted", () =>
  mainSrc.includes("routers.platform_admins import router as platform_admins_router"));

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\nverify-superadmin-rbac — ${results.length} assertions`);
let shown = 0;
for (const r of results) {
  if (!r.pass) {
    console.log(`  FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    shown += 1;
  }
}
if (shown === 0) console.log("  all negative-path and wiring assertions passed");
process.exit(failed > 0 ? 1 : 0);
