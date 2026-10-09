/**
 * Guards the Financial Clearance / Administrative Hold feature.
 *
 * The invariant this suite exists to protect is the one that a leak would
 * silently violate: a held student's grades, class averages, ranks and remarks
 * must never appear in a PUBLIC report response. Most of these checks are
 * therefore about ABSENCE — the fields must be blank, not merely hidden by CSS.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

const dbm = read("backend/services/db_manager.py");
const report = read("backend/routers/report.py");
const clearance = read("backend/routers/clearance.py");
const mainPy = read("backend/main.py");
const allocations = read("backend/routers/allocations.py");
const reaper = read("backend/scripts/purge_orphan_students.py");
const proxy = read("app/api/admin/clearance/route.ts");
const manager = read("components/admin/ClearanceManager.tsx");
const card = read("components/report-card/StudentReportCard.tsx");
const errState = read("components/report-card/ReportErrorState.tsx");

// ---------------------------------------------------------------- DDL

check("student_term_clearance table is created", /CREATE TABLE IF NOT EXISTS \{STUDENT_CLEARANCE_TABLE\}/.test(dbm));
check("table-name constant exists", /STUDENT_CLEARANCE_TABLE = "student_term_clearance"/.test(dbm));
check("table uses the subdomain tenant column with CASCADE", /subdomain VARCHAR\(60\) NOT NULL REFERENCES \{SCHOOLS_REGISTRY_TABLE\}\(subdomain\) ON DELETE CASCADE/.test(dbm));
// academic_session must be part of the key, else a Term 1 hold leaks into the
// same term next academic year.
check("academic_session is part of the unique key", /UNIQUE\(subdomain, student_id, term, academic_session\)/.test(dbm));
check("term is CHECK-constrained to Term 1-3", /term VARCHAR\(50\) NOT NULL CHECK \(term IN \('Term 1', 'Term 2', 'Term 3'\)\)/.test(dbm));
check("default is cleared (TRUE)", /is_financially_cleared BOOLEAN NOT NULL DEFAULT TRUE/.test(dbm));
check("the report-gate lookup index exists", /ix_clearance_lookup ON \{STUDENT_CLEARANCE_TABLE\} \(subdomain, student_id, term\)/.test(dbm));
check("the owing-count index exists", /ix_clearance_owing ON \{STUDENT_CLEARANCE_TABLE\} \(subdomain, is_financially_cleared, term\)/.test(dbm));

// Every DDL statement must be idempotent: uvicorn runs with --workers 2, so
// two processes execute lifespan concurrently on every deploy.
//
// Scope the slice to the clearance block ONLY. Slicing to the next unrelated
// banner would sweep in pre-existing tenant_staff/tenant_grades ALTERs that
// are not part of this change.
const clearanceDdlStart = dbm.indexOf("# Financial Clearance / Administrative Hold");
const clearanceDdlEnd = dbm.indexOf("# Remarks", clearanceDdlStart);
const clearanceDdl = clearanceDdlStart > -1 ? dbm.slice(clearanceDdlStart, clearanceDdlEnd) : "";
check("clearance DDL block located", clearanceDdl.length > 200);
const bareAlter = clearanceDdl.match(/ALTER TABLE(?!.*IF NOT EXISTS)/);
check("no non-idempotent ALTER TABLE in the clearance DDL", !bareAlter);
check(
  "clearance DDL issues no bare CREATE TABLE without IF NOT EXISTS",
  !/CREATE TABLE (?!IF NOT EXISTS)/.test(clearanceDdl),
);

// ------------------------------------------------------- referential safety

// db_manager.py carries a standing instruction that any student-referencing
// table must join the delete cascade. Missing it reproduces the P0 orphan bug.
check("clearance is in the student-delete cascade", /student_term_clearance/.test(allocations));
check("clearance is in the orphan reaper's DEPENDENT_TABLES", /\("student_term_clearance", "subdomain"\)/.test(reaper));

// ------------------------------------------------------- router wiring

check("clearance router is mounted in main.py", /include_router\(clearance_router\)/.test(mainPy));
check("router path is tenant-scoped", /prefix="\/api\/v1\/tenant\/\{tenant_id\}\/clearance"/.test(clearance));
check("router requires the shared secret", /Depends\(_verify_clearance_secret\)/.test(clearance));
check("router validates tenant id", /_validate_tenant_id/.test(clearance));
check("router rejects ids not on the tenant roster", /None of the supplied student_ids exist/.test(clearance));

// The roster read MUST be a LEFT JOIN + COALESCE. An INNER JOIN would hide
// every student the bursar has never touched — the exact opposite of truth.
check("roster read uses LEFT JOIN", /LEFT JOIN \{STUDENT_CLEARANCE_TABLE\}/.test(clearance));
check("untouched students default to cleared via COALESCE", /COALESCE\(c\.is_financially_cleared, TRUE\)/.test(clearance));
check("every clearance query is tenant-scoped", (clearance.match(/WHERE s\.subdomain = %s/g) || []).length >= 2);
check("bulk writes are capped", /MAX_BULK_STUDENTS = 3000/.test(clearance));

// --------------------------------------------------- report gate (the point)

check("report gate queries the clearance table", /FROM student_term_clearance/.test(report));
check("clearance gate matches on term AND academic_session", /AND term = %s AND academic_session = %s LIMIT 1/.test(report));
check("clearance gate fails CLOSED to cleared on error", /is_financially_cleared = True/.test(report));

// Ordering: the hold can only ever apply to an already-published result, so
// the clearance lookup must sit after the publication 404.
const pubIdx = report.indexOf("Publication gate");
const clearIdx = report.indexOf("Financial clearance gate");
const notFoundIdx = report.indexOf('raise HTTPException(status_code=404, detail="Report not found")');
check("clearance gate sits after the publication gate", pubIdx > -1 && clearIdx > pubIdx);
check("publication 404 precedes the clearance gate", notFoundIdx > -1 && clearIdx > notFoundIdx);

// The stripped response must blank EVERY sensitive field, not just `grades`.
// classAverage / subjectPosition / overallPosition are computed across the whole
// class roster, so leaving them in would reveal rank without revealing scores.
const withheldIdx = report.indexOf("if result_withheld and not include_draft:");
check("stripped withheld response exists", withheldIdx > -1);
const withheldBlock = withheldIdx > -1 ? report.slice(withheldIdx, withheldIdx + 2600) : "";
for (const [label, needle] of [
  ["grades blanked", /"grades": \[\]/],
  ["behavioural blanked", /"behavioural": \{\}/],
  ["summary nulled", /"summary": None/],
  ["template nulled", /"template": None/],
  ["form teacher remark nulled", /"form_teacher_remark": None/],
  ["principal remark nulled", /"principal_remark": None/],
  ["published_at nulled", /"published_at": None/],
  ["withheld_message present", /"withheld_message"/],
]) {
  check(`withheld response: ${label}`, needle.test(withheldBlock));
}
// The admin scope must still receive the full bundle.
check("admin scope bypasses the hold", /result_withheld and not include_draft/.test(report));
check("released responses carry an explicit status", /"result_status": "released" if is_published else "draft"/.test(report));

// --------------------------------------------- publishing must NOT clear holds

// The user requirement: a hold survives republishing. Enforced structurally by
// publish_student_results never writing this table.
//
// Extract the function body by INDENTATION, not by searching for the next
// "def": the signature spans several lines and a naive slice runs past the
// function into the table constant further down the module.
function functionBody(src, name) {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`def ${name}(`) || l.startsWith(`def ${name} (`));
  if (start === -1) return "";
  // Body ends at the next top-level construct.
//
// Two traps, both hit here:
//  - test indentation with a regex, not `str.isspace()`; that is Python, and
//    in JS it evaluates to undefined, truncating every slice to one line.
//  - a multi-line signature ends with `) -> Dict[str, Any]:` at COLUMN 0, so
//    "any non-indented line ends the function" stops at the signature itself.
//  - module-level CONSTANTS (TABLE = "...") also sit at column 0, so terminating
//    only on the next `def` would run the slice on into the constants that
//    follow the function and produce false positives.
//
// Terminate on the next `def` / `class` / comment banner / CONSTANT assignment.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^(def |class |# )/.test(l) || /^[A-Z_][A-Z0-9_]*\s*(=|:)/.test(l)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const publishFn = functionBody(dbm, "publish_student_results");
check("publish_student_results exists", publishFn.length > 500);
check(
  "publishing never writes student_term_clearance (holds survive republish)",
  publishFn.length > 500 && !/student_term_clearance|STUDENT_CLEARANCE_TABLE/.test(publishFn),
);
// And no other backend module may write the table either. Reads are allowed
// (report.py reads it); writes are not. Only clearance.py and the DDL should
// name it as an INSERT/UPDATE target.
const backendFiles = [
  "backend/routers/allocations.py",
  "backend/routers/credits.py",
  "backend/routers/command_center.py",
  "backend/routers/staff_grading.py",
  "backend/routers/admin.py",
];
const writers = backendFiles.filter((f) => {
  if (!existsSync(join(root, f))) return false;
  const s = read(f);
  return /(INSERT\s+INTO\s+student_term_clearance|UPDATE\s+student_term_clearance)/i.test(s);
});
check("no other backend module writes the clearance table", writers.length === 0, writers.join(", "));
check("clearance.py owns the write", /(INSERT INTO \{STUDENT_CLEARANCE_TABLE\})/.test(clearance));

// ---------------------------------------------------------------- proxy

check("proxy requires an admin session", /requireAdminSession/.test(proxy));
check("proxy normalises admission-number casing", /normalizeStudentId/.test(proxy));
check("proxy requires a reason for every hold", /A hold reason is required/.test(proxy));
check("proxy caps bulk size", /ids\.length > 3000/.test(proxy));
// Clearance changes must not invalidate publication caches.
check("proxy does not revalidate publication tags", !/revalidateTag/.test(proxy));

// ---------------------------------------------------------------- admin UI

check("clearance page exists", existsSync(join(root, "app/[subdomain]/admin/(dashboard)/clearance/page.tsx")));
check("admin nav links to Clearance", /admin\/clearance/.test(read("components/admin/AdminSidebar.tsx")));

// "Uncheck defaulters" must DESELECT. If it instead cleared everyone owing,
// one click would release outstanding debt — the inverse of the intent.
check("Uncheck defaulters is a selection action", /uncheckDefaulters/.test(manager));
const uncheckFn = manager.slice(manager.indexOf("const uncheckDefaulters"), manager.indexOf("const selectDefaulters"));
check(
  "Uncheck defaulters keeps cleared students selected",
  /filter\(\(r\) => effective\(r\)\)/.test(uncheckFn),
);
check("Uncheck defaulters does not write clearance", !/fetch|pending\[/.test(uncheckFn));
check("toggles are staged rather than written immediately", /pending/.test(manager) && /Apply changes/.test(manager));
check("bulk clear goes through a confirmation", /confirmBulk/.test(manager));
check("UI requires a term", /Term 1/.test(manager));

// ------------------------------------------------------------ locked state

check("withheld is a distinct report state", /"withheld"/.test(card));
check("card detects the server-authoritative status", /result_status === "withheld"/.test(card));
check("withheld branch renders before any report markup", card.indexOf('state === "withheld"') < card.indexOf("isAdminDraft ? \"blur-[3px]"));
check("locked copy comes from the server", /withheld_message/.test(card));
check("withheld is not shown to the admin", /isAdmin \? "published" : "withheld"/.test(card));
check("withheld icon variant exists", /withheld: Wallet/.test(errState));
check("Wallet icon is imported", /Wallet,/.test(errState));
// The blurred-draft overlay must never be reused for a hold — the data is
// already absent from the response, and a blur would imply data is there.
check("hold is not rendered as a blurred draft", !/state === "withheld"[\s\S]{0,400}blur-\[3px\]/.test(card));

// ------------------------------------------------------------------ report

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`Clearance verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log("Financial Clearance verified: holds are term-scoped, survive republishing, and withhold grades server-side.");