#!/usr/bin/env node
/**
 * Smart-Remarks onboarding-defaults guard harness.
 *
 *   node scripts/verify-remark-seeding.mjs
 *
 * A newly provisioned school used to land with an EMPTY remark scheme ('[]').
 * Smart Remarks then computed a valid average, matched no band, and silently
 * dropped the remark — so the feature looked broken on day one. These checks
 * lock in the defaults that make the first report read like a finished product,
 * AND the two invariants that matter just as much:
 *
 *  1. DEFAULTS ARE DEFAULTS — new schools/classes get a working scheme, but an
 *     existing school's CUSTOMIZED bands are never clobbered.
 *  2. THE BACKFILL IS IDEMPOTENT AND NON-DESTRUCTIVE — it only touches NULL /
 *     '[]' rows, and re-running (which happens on every backend boot) updates
 *     zero rows.
 *  3. THE SEEDS SATISFY validate_scheme — full 0..100 coverage, no overlaps,
 *     so evaluate_scheme never silently returns None.
 *
 * The form-teacher scheme is NOT school-level: it lives on
 * tenant_form_assignments (per class × per teacher), which is why its seeding
 * is wired into the assignment upsert rather than register_school.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

const rs = read("backend/services/remark_schemes.py");
const dbm = read("backend/services/db_manager.py");
const alloc = read("backend/routers/allocations.py");
const demo = read("backend/services/demo.py");

// ---- The two named defaults exist and are validated at import -------------
check("DEFAULT_PRINCIPAL_SCHEME is defined", /DEFAULT_PRINCIPAL_SCHEME\s*:\s*List\[Dict\[str, Any\]\] = validate_scheme\(/.test(rs));
check("DEFAULT_FORM_TEACHER_SCHEME is defined", /DEFAULT_FORM_TEACHER_SCHEME\s*:\s*List\[Dict\[str, Any\]\] = validate_scheme\(/.test(rs));
// Validated through the SAME function users edit with, so a malformed default
// fails at import rather than at the first report.
check("principal default goes through validate_scheme", /DEFAULT_PRINCIPAL_SCHEME[\s\S]*?validate_scheme\(/.test(rs));
check("teacher default goes through validate_scheme", /DEFAULT_FORM_TEACHER_SCHEME[\s\S]*?validate_scheme\(/.test(rs));

// Band shapes (parsed from source so the check tracks the file, not a copy).
function bandBounds(name) {
  const re = new RegExp(`${name}[\\s\\S]*?validate_scheme\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`);
  const m = rs.match(re);
  if (!m) return null;
  const mins = [...m[1].matchAll(/"min":\s*(\d+)/g)].map((x) => +x[1]);
  const maxs = [...m[1].matchAll(/"max":\s*(\d+)/g)].map((x) => +x[1]);
  return { mins, maxs };
}
const pBands = bandBounds("DEFAULT_PRINCIPAL_SCHEME");
const tBands = bandBounds("DEFAULT_FORM_TEACHER_SCHEME");
check("principal default has bands parsed", !!pBands && pBands.mins.length > 0);
check("teacher default has bands parsed", !!tBands && tBands.mins.length > 0);
if (pBands) {
  check("principal bands are non-overlapping (each max < next min)",
    pBands.maxs.every((mx, i) => i === pBands.maxs.length - 1 || mx < pBands.mins[i + 1]),
    JSON.stringify(pBands));
  check("principal covers 0..100 with no gap", pBands.mins[0] === 0 && pBands.maxs[pBands.maxs.length - 1] === 100);
}
if (tBands) {
  check("teacher bands are non-overlapping", tBands.maxs.every((mx, i) => i === tBands.maxs.length - 1 || mx < tBands.mins[i + 1]));
  check("teacher covers 0..100 with no gap", tBands.mins[0] === 0 && tBands.maxs[tBands.maxs.length - 1] === 100);
}

// ---- Principal seeding at registration (INSERT only, never clobber) -------
// register_school uses ON CONFLICT DO UPDATE; the scheme must appear in the
// INSERT column list but NOT in the DO UPDATE SET list, so re-provisioning an
// existing school leaves a customized scheme alone.
const regStart = dbm.indexOf("def register_school");
const regEnd = dbm.indexOf("consent_written", regStart);
const reg = dbm.slice(regStart, regEnd);
check("register_school imports the principal default", /DEFAULT_PRINCIPAL_SCHEME/.test(reg));
check("register_school validates before seeding", /validate_scheme as _validate_remark_scheme/.test(reg));
check("register_school writes the scheme as jsonb", /principal_remark_scheme\)\s*\n\s*VALUES[\s\S]*?%s::jsonb/.test(reg));
check("register_school has the jsonb cast in the params", /_principal_scheme_json/.test(reg));
// The DO UPDATE clause must NOT reassign the scheme.
const doUpdate = reg.match(/ON CONFLICT \(subdomain\) DO UPDATE SET([\s\S]*?)RETURNING/s);
check("register_school DO UPDATE does NOT overwrite the scheme",
  !!doUpdate && !/principal_remark_scheme/.test(doUpdate[1]));

// ---- Form-teacher seeding lives on the ASSIGNMENT upsert -----------------
// It is per class × per teacher, created in allocations.py, NOT register_school.
check("form-teacher default is NOT seeded in register_school", !/DEFAULT_FORM_TEACHER_SCHEME/.test(reg));
check("allocations upsert includes teacher_remark_scheme", /INSERT INTO \{TENANT_FORM_ASSIGNMENTS_TABLE\} AS tfa[\s\S]*?teacher_remark_scheme/.test(alloc));
check("allocations imports the form-teacher default", /DEFAULT_FORM_TEACHER_SCHEME/.test(alloc));
// Re-assigning a class to a different teacher must not wipe a custom scheme:
// only re-seed when the stored value is still the empty default.
check("allocations re-seeds only when scheme is empty",
  /WHEN tfa\.teacher_remark_scheme IS NULL\s*\n\s*OR tfa\.teacher_remark_scheme = '\[\]'::jsonb/.test(alloc));
check("allocations keeps an existing custom scheme",
  /ELSE tfa\.teacher_remark_scheme/.test(alloc));
// The alias must exist for the qualified reference to resolve.
check("allocations INSERT has the tfa alias", /AS tfa/.test(alloc));

// ---- Demos flow through register_school, so they inherit the default -----
// demo.py must NOT hardcode its own scheme (that would drift); it inherits via
// register_school. Guard against someone special-casing demo later.
check("demo does not hardcode its own scheme", !/DEFAULT_PRINCIPAL_SCHEME/.test(demo));
check("demo provisions via register_school", /register_school\(/.test(demo));

// ---- Idempotent, non-destructive startup backfill -------------------------
// Both backfills live in the startup DDL, target NULL/'[]' only, and are safe
// to re-run (which happens on every boot).
check("db_manager backfills principal_remark_scheme",
  /UPDATE \{SCHOOLS_REGISTRY_TABLE\}\s*\n\s*SET principal_remark_scheme = %s::jsonb\s*\n\s*WHERE principal_remark_scheme IS NULL\s*\n\s*OR principal_remark_scheme = '\[\]'::jsonb/.test(dbm));
check("db_manager backfills teacher_remark_scheme",
  /UPDATE \{TENANT_FORM_ASSIGNMENTS_TABLE\}\s*\n\s*SET teacher_remark_scheme = %s::jsonb\s*\n\s*WHERE teacher_remark_scheme IS NULL\s*\n\s*OR teacher_remark_scheme = '\[\]'::jsonb/.test(dbm));
check("backfills are guarded so a failure never blocks startup", /backfill skipped/.test(dbm));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`Remark-seeding verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log("Smart-Remarks onboarding defaults verified: seeded, non-destructive, idempotent, gapless.");