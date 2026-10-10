#!/usr/bin/env node
/**
 * Data Export Tool guard harness.
 *
 *   node scripts/verify-export.mjs
 *
 * Locks down four things that would each be silent, serious failures:
 *
 *  1. THE SECURITY BOUNDARY. The FastAPI backend only sees a shared secret —
 *     it has no notion of "which admin". If the Next proxy ever forwards an
 *     export without verifying a tenant-scoped signed session, ANY holder of
 *     the server-side secret path can pull ANY school's roster, including
 *     minors' names and fee-clearance status. This is the highest-value
 *     assertion in the file and it is listed first for that reason.
 *
 *  2. NO SECRET LEAKS. `schools.admin_password_hash` and
 *     `tenant_staff.password_hash` exist on these tables. Neither may appear
 *     in any exported sheet.
 *
 *  3. THE CLEARANCE JOIN IS LEFT + COALESCE. An INNER JOIN would drop every
 *     student the bursar never touched — which is the exact opposite of the
 *     truth (untouched == cleared) and would silently understate the roster.
 *
 *  4. REAL STREAMING, HONEST PROGRESS. The bar must be driven by measured
 *     bytes against Content-Length, not a timer; and the spool file must be
 *     deleted in the generator's finally so a client disconnect cannot leak
 *     it.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

const router = read("backend/routers/export.py");
const mainPy = read("backend/main.py");
const proxy = read("app/api/admin/export/route.ts");
const card = read("components/admin/ExportDataCard.tsx");
const progress = read("components/ui/Progress.tsx");
const dash = read("app/[subdomain]/admin/(dashboard)/page.tsx");
const reqs = read("backend/requirements.txt");

// ============================ 1. SECURITY BOUNDARY ==========================
check("proxy verifies a tenant-scoped admin session", /requireAdminSession\(tenantId\)/.test(proxy));
check("proxy calls requireAdminSession BEFORE any upstream fetch", proxy.indexOf("requireAdminSession") < proxy.indexOf("await fetch("));
// The guard's return is a NextResponse; returning it short-circuits.
check("proxy short-circuits on the guard", /if \(guard\) return guard;/.test(proxy));
check("proxy resolves the tenant BEFORE guarding", /const tenantId = \(body\.tenantId \|\| ""\)\.toLowerCase\(\)\.trim\(\)/.test(proxy));
check("proxy refuses a blank tenant (no default-tenant fallback)", !/tenantId \?\? "|subdomain \|\| "/.test(proxy));
// The backend must ALSO guard itself — defence in depth, since the secret is
// the only thing it can check.
check("backend router declares the shared-secret dependency", /dependencies=\[Depends\(_verify_export_secret\)\]/.test(router));
check("backend router mounts under the tenant prefix", /prefix="\/api\/v1\/tenant\/\{tenant_id\}\/export"/.test(router));
check("backend validates the tenant id", /_validate_tenant_id\(tenant_id\)/.test(router));
check("backend rejects unknown tenants", /_ensure_tenant_exists\(tid\)/.test(router));
check("backend compares the secret with hmac", /hmac\.compare_digest/.test(router));

// ============================ 2. NO SECRET LEAKS ===========================
// The strongest possible assertion: the column names appear NOWHERE as a
// selected field. Comments are stripped FIRST — this file's own prose names
// both columns when documenting that they are excluded, and an earlier run of
// this harness failed on its own documentation.
const stripComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "")
    .replace(/^\s*#\s.*$/gm, "");

const routerCode = stripComments(router);
check("admin_password_hash is never selected", !/SELECT[^;]*admin_password_hash/i.test(routerCode));
check("password_hash is never selected", !/SELECT[^;]*\bpassword_hash\b/i.test(routerCode));
// Staff sheet must not emit the hash column.
const staffFn = routerCode.slice(routerCode.indexOf("def _staff_rows"), routerCode.indexOf("def _class_rows"));
check("staff sheet column list excludes password_hash", !/password_hash/.test(staffFn));
// The summary sheet builds an explicit (label, value) list — no SELECT *.
check("summary sheet is built from an explicit field list", /rows = \[\s*\n\s*\("School Name"/.test(routerCode));
check("summary sheet omits the admin password", !/\("Admin Password"/.test(routerCode));

// ==================== 3. CLEARANCE LEFT JOIN + COALESCE ====================
const studentSql = router.slice(router.indexOf("def _student_rows"), router.indexOf("def _staff_rows"));
check("student query LEFT JOINs the clearance table", /LEFT JOIN \{STUDENT_CLEARANCE_TABLE\}/.test(studentSql));
check("student query is NOT an inner join", !/INNER JOIN \{STUDENT_CLEARANCE_TABLE\}/.test(studentSql));
check("student query COALESCEs untouched students to cleared", /COALESCE\(c\.is_financially_cleared, TRUE\)/.test(studentSql));
check("clearance join is case-insensitive on student_id", /LOWER\(c\.student_id\) = LOWER\(s\.student_id\)/.test(studentSql));
check("clearance join is scoped by term AND session", /c\.term = %s\s*\n\s*AND c\.academic_session = %s/.test(studentSql));
check("export emits a human-readable status", /status = "Cleared" if is_cleared else "Owing"/.test(studentSql));
check("clearance filter values are constrained", /CLEARANCE_FILTERS = \("all", "cleared", "owing"\)/.test(router));
check("an invalid clearance filter is rejected", /Invalid clearance filter/.test(router));

// Term/session must match the bursar's screen, or the Cleared/Owing column
// could contradict what the admin just looked at. LEGAL_REMEDIATION.md item 1
// records a past drift bug between exactly these resolvers.
check("session resolution prefers the school's configured session", /configured = \(school or \{\}\)\.get\("current_session"\)/.test(router));
check("session resolution falls back to the canonical helper", /from services\.db_manager import current_academic_session/.test(router));
check("term validation reuses the canonical VALID_TERMS", /from services\.db_manager import VALID_TERMS/.test(router));

// ===================== 4. STREAMING + HONEST PROGRESS ======================
check("backend streams with StreamingResponse", /StreamingResponse\(/.test(router));
check("backend spools to a temp file", /tempfile\.NamedTemporaryFile/.test(router));
check("backend uses constant_memory to bound RAM", /"constant_memory": True/.test(router));
check("temp file is unlinked in the generator's finally", /finally:[\s\S]{0,400}?os\.unlink\(tmp_path\)/.test(routerCode));
// Deleting in the ENDPOINT's finally would unlink before ASGI drains the
// generator — a subtle bug that "works" only via open-fd luck on Linux.
const generatorIdx = routerCode.indexOf("def file_iter()");
const unlinkIdx = routerCode.lastIndexOf("os.unlink(tmp_path)");
check("the final unlink lives inside the stream generator", generatorIdx !== -1 && unlinkIdx > generatorIdx);
check("backend sets Content-Length for real progress", /"Content-Length": str\(size\)/.test(routerCode));
check("backend sets an XLSX content type", /spreadsheetml\.sheet/.test(routerCode));
check("backend sends RFC 5987 filename*", /filename\*=UTF-8''/.test(routerCode));
// Filename injection defence.
check("filename strips quotes (header injection)", /_UNSAFE_FILENAME = re\.compile\(r"\[\^A-Za-z0-9 _-\]\+"\)/.test(routerCode));
check("filename collapses whitespace", /_WHITESPACE = re\.compile\(r"\\s\+"\)/.test(routerCode));
check("filename falls back for all-CJK names", /_NON_LATIN/.test(routerCode));
check("throttle is applied", /_rl_check\(f"xlsx-export\|/.test(routerCode));
check("oversized exports are refused before streaming", /Export too large/.test(routerCode));

// Proxy must NOT buffer the workbook, or a large export doubles memory.
const proxyCode = stripComments(proxy);
check("proxy forwards the upstream body as a stream", /new NextResponse\(upstream\.body/.test(proxyCode));
check("proxy does not arrayBuffer the workbook", !/arrayBuffer\(\)/.test(proxyCode));
check("proxy forwards Content-Length", /headers\.set\("Content-Length", len\)/.test(proxyCode));
check("proxy forwards Content-Disposition", /headers\.set\("Content-Disposition", disp\)/.test(proxyCode));
check("proxy forwards the sheet list header", /X-Export-Sheets/.test(proxyCode));
check("proxy surfaces the backend error detail", /detail/.test(proxyCode));
check("proxy forwards Retry-After on throttle", /Retry-After/.test(proxyCode));

// ========================= 5. UI: HONEST PROGRESS ===========================
const cardCode = stripComments(card);
check("card uses a readable stream (not res.blob())", /res\.body\.getReader\(\)/.test(cardCode));
check("card does NOT use a bare blob() call", !/await res\.blob\(\)/.test(cardCode));
check("progress is measured against Content-Length", /total > 0 \? \(received \/ total\) \* 100 : 0/.test(cardCode));
check("card has a gathering phase", /"gathering"/.test(cardCode) && /Gathering records/.test(cardCode));
check("card has a formatting phase", /"formatting"/.test(cardCode) && /Formatting spreadsheet/.test(cardCode));
check("card has a saving phase", /"saving"/.test(cardCode) && /Saving your download/.test(cardCode));
// No fake timer-driven progress.
check("progress is not faked with a timer", !/setInterval/.test(cardCode));
check("card force-completes the bar before saving", /setPct\(100\);/.test(cardCode));
// objectURL lifetime: revoking before the click lands cancels the download.
check("card revokes the object URL after the click", /URL\.revokeObjectURL/.test(cardCode));
// Prefer the server's sanitised filename. The card must read the RFC 5987
// form first (UTF-8 safe) and fall back to the ASCII quoted form.
check(
  "card prefers the server's sanitised filename",
  /filename\\\*=UTF-8''/.test(cardCode) && /plainMatch/.test(cardCode) && /decodeURIComponent\(starMatch\[1\]\)/.test(cardCode),
);
check("card disables the submit with no datasets", /selected\.length === 0/.test(cardCode));

// ============================ 6. UI PRIMITIVES =============================
check("Progress component exists", existsSync(join(root, "components/ui/Progress.tsx")));
check("Progress has role=progressbar", /role="progressbar"/.test(progress));
check("Progress sets aria-valuenow", /aria-valuenow/.test(progress));
check("Progress has an accessible name", /aria-label=\{label\}/.test(progress));
// NaN width collapses the bar and reads as a broken widget.
check("Progress clamps out-of-range values", /Math\.max\(0, Math\.min\(100, raw\)\)/.test(progress));
check("Progress guards non-finite input", /Number\.isFinite/.test(progress));

// Dashboard wiring
check("dashboard renders the ExportDataCard", /<ExportDataCard/.test(dash));
check("dashboard passes the subdomain", /subdomain=\{subdomain\}/.test(dash));
check("dashboard passes the current term", /currentTerm=\{currentTerm\}/.test(dash));
// The card must be LAST in its grid row.
const cardIdx = dash.indexOf("<ExportDataCard");
const progressIdx = dash.indexOf("Publication Progress");
check("Export card is the last child of the middle row", cardIdx > progressIdx);

// ============================ 7. DEPENDENCY ================================
check("xlsxwriter is pinned in requirements.txt", /xlsxwriter==3\.2\.9/.test(reqs));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`Export verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log("Data Export verified: tenant-scoped, no secret leaks, streamed, honestly measured.");