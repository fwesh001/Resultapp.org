#!/usr/bin/env node
/**
 * Student Authentication + Preview Mode guard harness.
 *
 *   node scripts/verify-student-auth.mjs
 *
 * Students had no identity until this change: the public report was open to
 * anyone who could guess a sequential admission number. These checks lock down
 * the five ways that can silently come undone:
 *
 *  1. HASHING. `password_hash` must be produced by pgcrypto inside Postgres.
 *     A Python-side bcrypt, or — far worse — an f-string interpolating the
 *     plaintext into the INSERT, would leak credentials into query logs and
 *     into any SQL-error surface.
 *
 *  2. THE PREVIEW GATE IS SERVER-SIDE. This is the highest-value assertion in
 *     the file and it is first for that reason. app/api/report forwards the
 *     upstream body VERBATIM, so a locked preview that left grades in the JSON
 *     would expose every score in devtools no matter what the UI drew. The
 *     strip must live in report.py.
 *
 *  3. `verified_student` CANNOT BE CLIENT-SET. It is derived from the httpOnly
 *     cookie and gated on the session's id MATCHING the requested id. "Has a
 *     session" is not sufficient: admission numbers are sequential and
 *     per-school, so that mistake would hand one child another's report.
 *
 *  4. THE THREE 404-ADJACENT STATES STAY DISTINCT. notFound (cannot confirm the
 *     student exists) / withheld (a bursary hold) / locked (needs the student's
 *     password). Collapsing any two either re-opens the roster oracle or shows
 *     a fee hold as a sign-in prompt.
 *
 *  5. THE FEE HOLD STILL OUTRANKS EVERYTHING. A correct password must not see
 *     through an administrative hold.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

const dbManager = read("backend/services/db_manager.py");
const studentAuth = read("backend/routers/student_auth.py");
const reportPy = read("backend/routers/report.py");
const allocations = read("backend/routers/allocations.py");
const demoPy = read("backend/services/demo.py");
const mainPy = read("backend/main.py");

const sessionTs = read("lib/session.ts");
const studentAuthTs = read("lib/studentAuth.ts");
const loginProxy = read("app/api/student/login/route.ts");
const logoutProxy = read("app/api/student/logout/route.ts");
const pwProxy = read("app/api/student/password/route.ts");
const resultsProxy = read("app/api/student/results/route.ts");
const reportProxy = read("app/api/report/route.ts");
const reportPage = read("app/[subdomain]/report/[...studentId]/page.tsx");
const card = read("components/report-card/StudentReportCard.tsx");
const widget = read("components/landing/ResultLookupWidget.tsx");
const dashLayout = read("app/[subdomain]/student/(dashboard)/layout.tsx");
const dashPage = read("app/[subdomain]/student/(dashboard)/page.tsx");
const pwPage = read("app/[subdomain]/student/(dashboard)/password/page.tsx");
const loginPage = read("app/[subdomain]/student/login/page.tsx");
const prompt = read("components/student/PasswordChangePrompt.tsx");

// ===================== 1. SCHEMA + HASHING =================================
const ddlStudent = dbManager.slice(
  dbManager.indexOf("CREATE TABLE IF NOT EXISTS ${TENANT_STUDENTS_TABLE}") >= 0
    ? dbManager.indexOf("CREATE TABLE IF NOT EXISTS ${TENANT_STUDENTS_TABLE}")
    : 0,
);
check(
  "tenant_students gains a password_hash column",
  /ALTER TABLE \$\{TENANT_STUDENTS_TABLE\} ADD COLUMN IF NOT EXISTS password_hash/.test(ddlStudent) ||
    /ALTER TABLE \{TENANT_STUDENTS_TABLE\} ADD COLUMN IF NOT EXISTS password_hash/.test(dbManager),
);
check(
  "existing students are backfilled BEFORE the NOT NULL constraint",
  dbManager.indexOf("SET password_hash = crypt('123456', gen_salt('bf')) WHERE password_hash IS NULL") <
    dbManager.indexOf("{TENANT_STUDENTS_TABLE} ALTER COLUMN password_hash SET NOT NULL"),
  "add-backfill-constrain order is load-bearing: constraining first fails on every pre-existing row",
);
check(
  "password_hash is constrained NOT NULL",
  /\{TENANT_STUDENTS_TABLE\} ALTER COLUMN password_hash SET NOT NULL/.test(dbManager),
);
check(
  "must_change_password column is added",
  /ADD COLUMN IF NOT EXISTS must_change_password/.test(dbManager),
);

// Hashing stays INSIDE Postgres: every student INSERT embeds
// crypt(..., gen_salt('bf')) in the SQL template, and the only plaintext that
// crosses the wire is the documented shared default (DEFAULT_ROSTER_PASSWORD,
// imported lazily in allocations.py to dodge the module cycle), which the
// must-change-password prompt rotates on first login. Pinning the
// parameterized shape keeps a refactor from quietly moving hashing
// client-side (bcrypt/passlib in Python) or binding an ad-hoc password string
// instead of the shared constant.
check(
  "single-create hashes the roster default inside Postgres (parameterized crypt)",
  /VALUES \(%s, %s, %s, %s, %s, crypt\(%s, gen_salt\('bf'\)\), TRUE\)/.test(allocations) &&
    /gender, DEFAULT_ROSTER_PASSWORD\)/.test(allocations),
);
check(
  "batch import hashes the roster default inside Postgres",
  /\["\(%s, %s, %s, %s, %s, crypt\(%s, gen_salt\('bf'\)\), TRUE\)"\] \* len\(fresh\)/.test(allocations) &&
    /c\["gender"\], DEFAULT_ROSTER_PASSWORD\]/.test(allocations),
);
check(
  "demo seeder hashes the roster default inside Postgres via template",
  // Demo rows opt OUT of must_change_password (FALSE): the demo credentials
  // are printed on the onboarding card, so the password-change nag would
  // desync the advertised PIN. Hashing itself still happens inside Postgres
  // — the inside-Postgres invariant is what this check protects.
  /template="\(%s, %s, %s, %s, %s, crypt\('123456', gen_salt\('bf'\)\), FALSE\)"/.test(demoPy),
);
check(
  "no client-side hashing dependency in the roster path (pgcrypto only)",
  !/(^|[^\w.])import\s+(bcrypt|passlib)\b|from\s+(bcrypt|passlib)\s+import/.test(allocations),
);

// ===================== 2. BACKEND ROUTER ===================================
check("student router is mounted in main.py", /student_auth_router/.test(mainPy));
check("login route exists", /@router\.post\("\/login"/.test(studentAuth));
check("results route exists", /@router\.get\("\/results"/.test(studentAuth));
check("password route exists", /@router\.post\("\/password"/.test(studentAuth));

// student_id must be a BODY field. FastAPI silently promotes a bare path-style
// param to a QUERY param, which 422'd every real request once already.
const pwModel = studentAuth.slice(
  studentAuth.indexOf("class StudentPasswordChange"),
  studentAuth.indexOf("class StudentPasswordChange") + 320,
);
check(
  "student_id is in the password-change BODY model",
  /student_id:\s*str/.test(pwModel),
  "as a bare function param it becomes a query param and every request 422s",
);
check(
  "password hash comparison uses pgcrypto crypt()",
  /password_hash = crypt\(%s, password_hash\)/.test(studentAuth),
);
check(
  "login uses LOWER() id matching (case-insensitive)",
  /LOWER\(student_id\) = LOWER\(%s\)/.test(studentAuth),
);
check(
  "login is uniform 401 for unknown student AND wrong password",
  /detail="Invalid admission number or password"/.test(studentAuth) &&
    // One message, so neither outcome is distinguishable.
    !/No such student/.test(studentAuth),
);
check(
  "login rejects an empty identifier or password",
  /identifier and password are required/.test(studentAuth),
);
check(
  "rate limit uses a per-account bucket",
  /student-login:\{tid\}:\{ident\.lower\(\)\}/.test(studentAuth),
);
check(
  "rate limit uses a SEPARATE per-IP bucket",
  /student-login-ip:/.test(studentAuth),
);
check(
  "rate limit never reuses the shared report bucket",
  !/check\(\s*f?"report:/.test(studentAuth),
  "the report bucket is keyed {ip}:{tenant} and would let one child's failed"
    + " attempts lock out every other child behind the same NAT",
);
check(
  "password change verifies the CURRENT password",
  /AND password_hash = crypt\(%s, password_hash\)/.test(studentAuth),
);
check("password change clears must_change_password", /must_change_password = FALSE/.test(studentAuth));
check(
  "minimum new-password length is 6",
  /MIN_STUDENT_PASSWORD = 6/.test(studentAuth),
);
check(
  "password change rejects reusing the current password",
  /must differ from the current one/.test(studentAuth),
);
check(
  "results endpoint is PUBLISHED-only (published_at filter)",
  /if d\.get\("published_at"\) is not None/.test(studentAuth),
);
check(
  "results endpoint is NOT pinned to one academic session",
  !/academic_session = %s/.test(studentAuth),
  "every other result_publications read pins a session, which is correct for"
    + " 'is this released?' but useless for 'what has this child ever been given?'",
);
check(
  "results confirms the student exists in THIS tenant first",
  /Student not found/.test(studentAuth),
);

// ===================== 3. THE PREVIEW GATE (server-side) ==================
check(
  "report.py accepts a verified_student scope",
  /verified_student: bool = Query\(/.test(reportPy),
);
const withheldIdx = reportPy.indexOf("if result_withheld and not include_draft");
const lockedIdx = reportPy.indexOf("if result_locked");
check(
  "report.py has a result_locked branch",
  lockedIdx > -1,
);
check(
  "the FEE HOLD branch comes FIRST (password cannot see through a hold)",
  withheldIdx > -1 && lockedIdx > -1 && withheldIdx < lockedIdx,
);
check(
  "locked requires published AND unverified AND non-admin",
  /result_locked = \([\s\S]{0,220}?is_published[\s\S]{0,120}?not verified_student[\s\S]{0,120}?not include_draft/.test(
    reportPy,
  ),
);
// Slice from `if result_locked:` to the end of that return dict. The literal is
// right after the branch header, so indexOf("return {", lockedIdx) would cut the
// window ~30 chars in and inspect nothing.
const lockedBody = reportPy.slice(lockedIdx, lockedIdx + 1400);
check("locked branch window captured the whole payload", /"behavioural":\s*\{\}/.test(lockedBody));
for (const field of [
  "grades",
  "summary",
  "template",
  "groupedTemplate",
  "behavioural",
  "attendance",
  "form_teacher_remark",
  "principal_remark",
  "form_teacher_signature_data",
]) {
  // Python literals, not JSON: None / [] / {}.
  check(
    `locked payload empties ${field}`,
    new RegExp(`"${field}":\\s*(None|\\[\\]|\\{\\})`).test(lockedBody),
  );
}
check(
  "locked keeps the student bio (shared links stay useful)",
  /"student": student/.test(lockedBody),
);
check(
  "locked sets result_status to locked",
  /"result_status": "locked"/.test(lockedBody),
);

// ===================== 4. PROXY TRUST BOUNDARY =============================
check(
  "report proxy imports the student guard",
  /from "@\/lib\/studentAuth"/.test(reportProxy),
);
check(
  "report proxy derives verified_student from the session",
  /studentMayView\(tenantId, studentId\)/.test(reportProxy),
);
check(
  "report proxy NEVER reads verified_student from the query string",
  !/searchParams\.get\("verified_student"\)/.test(reportProxy),
  "otherwise ?verified_student=true would unlock any classmate's card",
);
check(
  "studentMayView requires an id MATCH, not mere session presence",
  /studentIds\.some\(\(id\) => studentIdsMatch\(id, requestedStudentId\)\)/.test(studentAuthTs),
);
check(
  "studentIdsMatch tolerates the legacy compact id form",
  /compact\(left\) === compact\(right\)/.test(studentAuthTs),
  "vhs stores both vhs/004 and vhs004; without this a student is shown a"
    + " locked preview of their OWN card",
);
check(
  "student guard binds the session to the expected tenant",
  /if \(expected && tenantId !== expected\) return null/.test(studentAuthTs),
);
check(
  "student guard rejects a session with no student id",
  /if \(!studentId \|\| !session\.student\) return null/.test(studentAuthTs),
);
check(
  "student guard clears an invalid cookie",
  /clearSessionCookie\(SESSION_COOKIES\.student\)/.test(studentAuthTs),
);

// ===================== 5. SESSION COOKIE ===================================
check("student_session is registered", /student:\s*"student_session"/.test(sessionTs));
check(
  "student_session participates in bulk clearing",
  /SESSION_COOKIES\.student/.test(sessionTs) &&
    sessionTs.indexOf("student,") > -1,
);

// ===================== 6. PROXIES ==========================================
check("login proxy mints the student session", /setSessionCookie\(SESSION_COOKIES\.student/.test(loginProxy));
check(
  "login proxy allowlists claims (no pass-through of future backend fields)",
  /const claims = \{/.test(loginProxy),
);
check(
  "login proxy never returns the signed token to the client",
  !/NextResponse\.json\([\s\S]{0,200}token/.test(loginProxy),
);
// The secret must be read from server env only, never exposed to the browser.
// A route handler body runs server-side; the real risk is a NEXT_PUBLIC_ leak
// or handing the secret back in the JSON response.
check(
  "login proxy reads the secret from server env (no NEXT_PUBLIC secret)",
  /process\.env\.BACKEND_API_SECRET/.test(loginProxy) &&
    !/NEXT_PUBLIC.*SECRET/.test(loginProxy),
);
// Assert on the ACTUAL return expressions, not a loose 300-char window: a wide
// window spans past one NextResponse.json(...) call and matches unrelated code.
const loginReturns = [...loginProxy.matchAll(/NextResponse\.json\(([\s\S]*?)\);/g)].map((m) => m[1]);
check(
  "login proxy returns no secret in any response body",
  loginReturns.length > 0 && loginReturns.every((body) => !/\bsecret\b/i.test(body)),
  `checked ${loginReturns.length} response bodies`,
);

// Match the CALL, not any textual mention: the bulk clearer is named in a
// comment explaining why this endpoint deliberately does not use it.
const logoutStripsComments = logoutProxy.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
check(
  "logout clears ONLY the student cookie",
  /clearSessionCookie\(SESSION_COOKIES\.student\)/.test(logoutStripsComments) &&
    !/clearAllSessionCookies/.test(logoutStripsComments),
  "an admin or staff signed in on the same browser must survive a student signing out",
);
check(
  "password proxy is session-guarded",
  /requireStudentSession/.test(pwProxy),
);
check(
  "password proxy takes student_id from the SESSION, not the body",
  /student_id: identity\.studentId/.test(pwProxy),
);
check(
  "password proxy ignores any client-supplied student id",
  /body\.studentId/.test(pwProxy) === false,
);
check(
  "results proxy takes student_id from the SESSION, not the query",
  /student_id=\$\{encodeURIComponent\(identity\.studentId\)\}/.test(resultsProxy),
);

// ===================== 7. PORTAL UI =========================================
check("student dashboard layout is session-guarded", /readStudentSession\(subdomain\)/.test(dashLayout));
check(
  "dashboard redirects to login when unauthenticated",
  /redirect\(`\/\$\{subdomain\}\/student\/login`\)/.test(dashLayout),
);
check(
  "dashboard cross-tenant session is rejected by the guard",
  /readStudentSession\(subdomain\)/.test(dashLayout),
);
check(
  "dashboard reads the history from the verified session id",
  /student_id=\$\{encodeURIComponent\(identity\.studentId\)\}/.test(dashPage),
);
check(
  "archive links carry BOTH term and academic_session",
  /academic_session=\$\{encodeURIComponent\(session\)\}/.test(dashPage),
  "term alone resolves against the school's CURRENT session, so archived"
    + " links would silently render the wrong year",
);
check("password page exists and is guarded", /readStudentSession/.test(pwPage));

// Soft prompt, never a hard gate.
check(
  "default-password banner is dismissible",
  /setDismissed\(true\)/.test(prompt),
);
check(
  "banner dismissal is NOT treated as fixing the password",
  !/must_change_password = FALSE/.test(prompt),
);
check(
  "banner dismissal is stored client-side only",
  /localStorage/.test(prompt),
);
check(
  "banner reads localStorage in an effect (no hydration mismatch)",
  /useEffect/.test(prompt),
);

// Login page must not be an open redirect.
check(
  "login page rejects absolute / protocol-relative return URLs",
  /nextRaw\.startsWith\("\/"\) && !nextRaw\.startsWith\("\/\/"\)/.test(loginPage),
  "?next=https://evil.example would bounce a family off-site right after"
    + " they typed their child's password",
);

// ===================== 8. RESULT CHECKER ===================================
check("checker now asks for a password", /student-password/.test(widget));
check(
  "checker verifies the password BEFORE navigating",
  /await fetch\("\/api\/student\/login"/.test(widget) &&
    /router\.push\(buildReportPath/.test(widget),
);
check(
  "checker surfaces a login error instead of navigating anyway",
  /setError\(data\.error/.test(widget),
);
check("checker disables the button while authenticating", /disabled=\{busy\}/.test(widget));
check("checker hints at the default password", /123456/.test(widget));
check(
  "checker still builds a per-segment encoded path",
  /\.split\("\/"\)\s*\.map\(\(seg\) => encodeURIComponent\(seg\)\)/.test(widget),
);

// ===================== 9. REPORT PAGE + CARD ===============================
check("report page resolves the student viewer", /studentMayView\(tenantId, studentId\)/.test(reportPage));
check(
  "report page defaults to the public viewer on any failure",
  /viewer: "admin" \| "student" \| "public"/.test(reportPage),
);
check(
  "printing requires a VERIFIED visitor",
  /canPrint = isPublished && \(isAdminPreview \|\| studentAuthorized\)/.test(reportPage),
  "printing a locked preview yields a blank card that reads as a real empty result",
);
check(
  "report page forwards academic_session to the card",
  /academicSession=\{effectiveSession\}/.test(reportPage),
);
check(
  "card accepts the student viewer",
  /viewer: "admin" \| "student" \| "public"/.test(card),
);
check(
  "card has a distinct 'locked' render state",
  /\| "locked"/.test(card),
);
check(
  "locked is NOT collapsed into notFound",
  /state = isAdmin \? "published" : "locked"/.test(card),
);
check(
  "locked is NOT collapsed into withheld",
  /data\?\.locked_message/.test(card),
);
check(
  "locked card links to sign-in and returns to the same card",
  /student\/login/.test(card) && /academic_session/.test(card),
);
check(
  "card forwards academic_session on the client fetch",
  /qs\.set\("academic_session", requestedSession\)/.test(card),
);

// ============================ REPORT =======================================
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(
    `  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`,
  );
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`Student auth verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log(
  "Student auth verified: pgcrypto-hashed, session-scoped, server-stripped preview, no roster oracle.",
);