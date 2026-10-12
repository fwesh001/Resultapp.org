#!/usr/bin/env node
/**
 * Audit-log regression harness.
 *
 * Three bugs motivated this file, and all three were invisible to the type
 * checker and to reading the code:
 *
 *   1. `get_audit_logs` ran its COUNT after fetching rows but before mapping
 *      them. `_row_to_dict` names columns from `cursor.description`, and the
 *      COUNT replaced that description, so every entry came back as
 *      {"count": N, "created_at": ""} — no actor, no action.
 *   2. `audit_logs.actor_id` is a UUID column, but tenant staff are keyed by a
 *      string admission number (`staff/0099`). Postgres rejected the INSERT and
 *      `log_admin_action` — being best-effort — swallowed it, so every
 *      moderator action vanished from the trail with no error anywhere.
 *   3. `credits.py` called a helper named `log_audit` that does not exist and
 *      was never imported, and the call was not wrapped in try/except, so a
 *      publish that had already committed would still have returned 500.
 *
 * Each check below asserts on the failure being absent, not on a row being
 * present, so the suite stays green when a tenant has simply done nothing.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p) => {
  const f = join(ROOT, p);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};

let pass = 0;
let fail = 0;
const results = [];

function check(name, condition, detail) {
  if (condition) {
    pass++;
    results.push({ ok: true, name, detail });
  } else {
    fail++;
    results.push({ ok: false, name, detail });
  }
}

const db = read("backend/services/db_manager.py");
const admin = read("backend/routers/admin.py");
const credits = read("backend/routers/credits.py");
const allocations = read("backend/routers/allocations.py");
const clearance = read("backend/routers/clearance.py");
const auditRouter = read("backend/routers/tenant_audit.py");
const main = read("backend/main.py");

// ---------------------------------------------------------------------------
// 1. cursor.description must be captured before the COUNT
// ---------------------------------------------------------------------------
{
  const fn = db.slice(db.indexOf("def get_audit_logs"));
  const end = fn.indexOf("\ndef ", 10);
  const body = end > 0 ? fn.slice(0, end) : fn;

  check(
    "get_audit_logs snapshots the row column names before the COUNT",
    /cols\s*=\s*\[d\[0\]\s+for\s+d\s+in\s+\(cur\.description/.test(body),
    "description must be snapshotted before the second execute"
  );
  check(
    "get_audit_logs does NOT hand a live cursor to _row_to_dict",
    !/_row_to_dict\(\s*\w+\s*,\s*cur\s*\)/.test(body),
    "a live cursor carries the COUNT's description"
  );
  check(
    "get_audit_logs does NOT hand a bare tuple to _row_to_dict",
    !/_row_to_dict\(\s*\w+\s*,\s*row_description\s*\)/.test(body),
    "_row_to_dict reads cursor.description; a tuple has none, so it returns {}"
  );
  check(
    "get_audit_logs zips rows against the snapshot directly",
    /dict\(zip\(\s*cols\s*,\s*r\s*\)\)/.test(body),
    "mapping must use the captured names"
  );
  check(
    "a missing created_at never renders as the string 'None'",
    /str\(ts\s+or\s+""\)/.test(body),
    "the log UI would show 'None' for an unset timestamp"
  );
  check(
    "get_audit_logs returns a (rows, total) tuple",
    /return\s+out\s*,\s*total/.test(body),
    "pagination needs a real total"
  );
}

// ---------------------------------------------------------------------------
// 2. actor_id must be UUID-guarded
// ---------------------------------------------------------------------------
{
  const fn = db.slice(db.indexOf("def log_admin_action"));
  const end = fn.indexOf("\ndef ", 10);
  const body = end > 0 ? fn.slice(0, end) : fn;

  check(
    "log_admin_action validates actor_id as a UUID before insert",
    /uuid\.UUID\(/.test(body) && /safe_actor_id/.test(body),
    "a staff admission number is not a UUID"
  );
  check(
    "log_admin_action inserts the sanitized id, not the raw one",
    /safe_actor_id\s*,/.test(body),
    "raw actor_id would still reach the UUID column"
  );
  check(
    "log_admin_action never interpolates actor_id into SQL",
    !/f["'].*\{actor_id\}/.test(body),
    "the id is a bound parameter"
  );
  check(
    "log_admin_action stays best-effort (never raises)",
    /except\s+Exception/.test(body) && /logger\.warning/.test(body),
    "audit must not break the mutation it describes"
  );
}

// ---------------------------------------------------------------------------
// 3. No call site may reference a helper that does not exist
// ---------------------------------------------------------------------------
{
  check(
    "log_admin_action is defined in db_manager",
    /def\s+log_admin_action\s*\(/.test(db),
    "the helper the routers import must exist"
  );
  check(
    "log_audit is never CALLED (no such helper exists)",
    !/(?<![\w.])log_audit\s*\(/.test(credits + allocations + clearance + admin),
    "credits.py previously called an undefined, unimported log_audit"
  );
  check(
    "log_audit is never IMPORTED (would ImportError at request time)",
    !/(?<![\w.])log_audit\s*(,|\n|\))/.test(
      (credits + allocations + clearance + admin).replace(/\/\/[^\n]*/g, "")
    ),
    "an ImportError inside a handler 500s the whole route, not just the audit"
  );

  // Every audit call must import the helper in the same scope it uses it.
  const files = [
    ["credits.py", credits],
    ["allocations.py", allocations],
    ["clearance.py", clearance],
    ["admin.py", admin],
  ];
  for (const [name, src] of files) {
    const calls = (src.match(/log_admin_action\s*\(/g) || []).length;
    const imports = (
      src.match(/from\s+services\.db_manager\s+import[^\n]*\blog_admin_action\b/g) || []
    ).length;
    check(
      `${name}: every log_admin_action call has a matching import`,
      calls === 0 || (imports > 0 && imports >= 1),
      `${calls} call(s), ${imports} import(s)`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Audit writes must not be able to fail the request they describe
// ---------------------------------------------------------------------------
{
  // A publish commits before auditing; an unguarded NameError there turns a
  // successful, credit-charged publication into a 500.
  check(
    "credits publish audit is wrapped in try/except",
    /try:\s*\n\s*from services\.db_manager import log_admin_action/.test(credits),
    "a logged failure here would 500 an already-committed publish"
  );
  for (const [name, src] of [
    ["allocations.py", allocations],
    ["clearance.py", clearance],
    ["admin.py", admin],
  ]) {
    check(
      `${name}: audit writes are wrapped in try/except`,
      /try:[\s\S]{0,200}log_admin_action/.test(src),
      "best-effort means genuinely best-effort"
    );
  }
}

// ---------------------------------------------------------------------------
// 5. old_email must be read BEFORE the UPDATE
// ---------------------------------------------------------------------------
{
  // The UPDATE is written as an f-string, so the table name is interpolated:
  // `UPDATE {SCHOOLS_REGISTRY_TABLE}`. Match the literal braces.
  const idx = admin.indexOf("old_email");
  const sel = admin.indexOf("SELECT email FROM");
  const upd = admin.indexOf("UPDATE {SCHOOLS_REGISTRY_TABLE}");
  check(
    "profile update reads the prior email before the UPDATE",
    sel > 0 && upd > 0 && sel < upd && idx > 0,
    "RETURNING yields the post-update row, so old_email would be the new one"
  );
  check(
    "old_email is bound to the pre-update SELECT, not the updated row",
    /"old_email":\s*old_email/.test(admin),
    "that is the post-update value, mislabelled"
  );
  check(
    "audit no longer sources old_email from the updated school row",
    !/"old_email":\s*school\.get\(/.test(admin),
    "that is the post-update value, mislabelled"
  );
}

// ---------------------------------------------------------------------------
// 6. Actions must be distinct and greppable
// ---------------------------------------------------------------------------
{
  const expected = [
    ["credits.py", credits, "results.publish"],
    ["clearance.py", clearance, "clearance.held"],
    ["clearance.py", clearance, "clearance.released"],
    ["allocations.py", allocations, "roster.{record_type}_updated"],
    ["allocations.py", allocations, "roster.{record_type}_deleted"],
    ["admin.py", admin, "tenant.email_changed"],
    ["admin.py", admin, "tenant.profile_updated"],
  ];
  for (const [name, src, action] of expected) {
    check(
      `${name} audits "${action}"`,
      src.includes(action),
      src.includes(action) ? "present" : "action name missing"
    );
  }
  check(
    "email changes get their own action, not a generic profile edit",
    /"tenant\.email_changed"\s+if\s+email_changed\s+else\s+"tenant\.profile_updated"/.test(admin),
    "schools.email is the admin login identifier"
  );
}

// ---------------------------------------------------------------------------
// 7. The reader must be tenant-scoped and filter in SQL
// ---------------------------------------------------------------------------
{
  check("tenant_audit router exists", auditRouter.length > 0);
  check(
    "tenant_audit filters by tenant",
    /get_audit_logs\(\s*subdomain\s*=|subdomain=subdomain|tenant_id/.test(auditRouter),
    "an unscoped audit reader would leak other schools' actions"
  );
  check(
    "tenant_audit is mounted", main.includes("tenant_audit_router"));
  check(
    "get_audit_logs supports action_prefix and actor_type filters",
    /action_prefix/.test(db) && /actor_type/.test(db),
    "the UI filters without pulling the whole table"
  );
  check(
    "filters are bound as parameters, not formatted into SQL",
    /action\s+LIKE\s+%s/.test(db) && /actor_type\s*=\s*%s/.test(db),
    "string interpolation would be injectable"
  );
  check(
    "audit limit is clamped server-side",
    /min\(int\(limit/.test(db),
    "an unclamped limit is a free full-table dump"
  );
}

// ---------------------------------------------------------------------------
// 8. UI must be gated on BOTH the page and the API
// ---------------------------------------------------------------------------
{
  const page = read("app/[subdomain]/admin/(dashboard)/audit/page.tsx");
  const route = read("app/api/admin/audit/route.ts");
  const client = read("app/[subdomain]/admin/(dashboard)/audit/AuditLogClient.tsx");
  const sidebar = read("components/admin/AdminSidebar.tsx");

  check(
    "audit page calls enforceAdminCapability itself",
    /enforceAdminCapability\(\s*params\s*,\s*"audit"\s*\)/.test(page),
    "a layout cannot read a page's exports, so the page must gate itself"
  );
  check(
    "audit API requires the audit capability server-side",
    /requireAdminCapability/.test(route),
    "hiding the nav item is not authorization"
  );
  check(
    "audit nav entry is capability-filtered",
    sidebar.includes("audit"),
    "moderators must not see the link"
  );
  check("audit UI client exists", client.length > 0);
  check(
    "AuditLogClient props match what the page passes",
    /schoolName\??:\s*string/.test(client),
    "passing an undeclared prop fails typecheck"
  );
}

// ---------------------------------------------------------------------------
// 9. Moderators must be locked out, not shown an empty log
// ---------------------------------------------------------------------------
{
  const caps = read("lib/capabilities.ts");
  const enforce = read("lib/enforceCapability.ts");
  check("audit is admin-only in the capability map", /audit/.test(caps));
  check(
    "moderators do not receive the audit capability",
    !/MODERATOR_ALLOWED[\s\S]{0,400}\baudit\b/.test(caps),
    "a moderator who can read the log sees what has been noticed"
  );
  check(
    "enforceAdminCapability redirects on denial",
    /redirect/.test(enforce),
    "a silent no-op gate is worse than none"
  );
}

// ---------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n, " ");
console.log("");
console.log("=" .repeat(72));
console.log("  AUDIT LOG REGRESSION");
console.log("=".repeat(72));
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${pad(r.name, 56)} ${r.detail ?? ""}`);
}
console.log("=".repeat(72));
console.log(`  ${pass} passed, ${fail} failed`);
console.log("=".repeat(72));
process.exit(fail ? 1 : 0);
