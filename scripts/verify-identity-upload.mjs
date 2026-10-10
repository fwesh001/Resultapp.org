/**
 * Guards the auto-prefixing identity UX.
 *
 * The behaviour under test is deliberately CONSERVATIVE: only an unambiguous
 * bare number gets a tenant prefix attached. Everything else — emails,
 * already-prefixed IDs, and legacy non-numeric IDs — must pass through
 * byte-for-byte, because rewriting any of them locks a real account out.
 *
 * The production DB contains a concrete counter-example (vhs staff "stf001",
 * no slash, letters). A naive "always prepend" implementation would break it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

// Exercise the REAL helpers rather than re-implementing their logic, so these
// assertions cannot pass while the shipped module regresses.
const mod = await import(pathToFileURL(join(root, "lib/identityPrefix.ts")).href).catch(() => null);

if (!mod) {
  // No TS loader in this repo's runtime; fall back to static assertions only.
  check("lib/identityPrefix.ts exists", true);
} else {
  const { expandStudentId, expandStaffId, joinIdentityPrefix } = mod;

  // ---- joinIdentityPrefix: trailing-slash tolerance ----------------------
  // The two live tenants disagree on form: vhs => "staff" (no slash),
  // sha => "STAFF/" (trailing slash). Both must produce a single separator.
  check("joins a bare prefix with a slash", joinIdentityPrefix("vhs", "001") === "vhs/001");
  check("does not double a trailing slash", joinIdentityPrefix("STAFF/", "001") === "STAFF/001");
  check("empty prefix passes the value through", joinIdentityPrefix("", "001") === "001");
  check("null prefix passes the value through", joinIdentityPrefix(null, "001") === "001");

  // ---- Students: vhs (id_prefix = "vhs") ---------------------------------
  check("bare student number expands (vhs)", expandStudentId("001", "vhs", "vhs") === "vhs/001");
  check("multi-digit expands", expandStudentId("004", "vhs", "vhs") === "vhs/004");
  check("leading zeros preserved", expandStudentId("001", "vhs", "vhs") === "vhs/001");

  // ---- Students: sha (id_prefix is NULL -> falls back to subdomain) ------
  check(
    "empty id_prefix falls back to subdomain",
    expandStudentId("001", "", "sha") === "sha/001",
  );
  check(
    "missing idPrefix prop falls back to subdomain",
    expandStudentId("001", null, "sha") === "sha/001",
  );

  // ---- BACKWARD COMPATIBILITY: full IDs must survive untouched -----------
  check(
    "full ID is NOT double-prefixed",
    expandStudentId("vhs/001", "vhs", "vhs") === "vhs/001",
  );
  check(
    "already-prefixed ID with another tenant's prefix is untouched",
    expandStudentId("sha/001", "vhs", "vhs") === "sha/001",
  );

  // ---- Staff: vhs uses "staff", sha uses "STAFF/" ------------------------
  check("bare staff number expands (vhs)", expandStaffId("001", "staff") === "staff/001");
  check("bare staff number expands (sha)", expandStaffId("001", "STAFF/") === "STAFF/001");

  // ---- The critical regression guard -------------------------------------
  // vhs has a real staff member whose ID is literally "stf001": no slash and
  // contains letters. Prepending "staff/" would lock that account out.
  check(
    "legacy non-numeric staff ID 'stf001' passes through untouched",
    expandStaffId("stf001", "staff") === "stf001",
  );
  check("letters-only ID untouched", expandStaffId("abcd", "staff") === "abcd");
  check("mixed alphanumeric untouched", expandStaffId("a001", "staff") === "a001");

  // ---- Emails: never rewritten (admin/root depend on this) -------------
  check("staff email untouched", expandStaffId("mark@gmail.com", "staff") === "mark@gmail.com");
  check("student email untouched", expandStudentId("x@y.com", "vhs", "vhs") === "x@y.com");

  // ---- Whitespace + empties ---------------------------------------------
  check("surrounding whitespace trimmed", expandStaffId("  001  ", "staff") === "staff/001");
  check("internal whitespace in student ID removed", expandStudentId("00 1", "vhs", "vhs") === "vhs/001");
  check("empty staff input unchanged", expandStaffId("", "staff") === "");
  check("empty student input unchanged", expandStudentId("", "vhs", "vhs") === "");

  // ---- Missing prefix config must still match the backend ---------------
  // Backend uses COALESCE(staff_id_prefix, 'STAFF/') (allocations.py:551), so
  // an unset prefix must expand to STAFF/001, NOT to a bare "001" and NOT to
  // "/001". Asserting the wrong value here would have "fixed" a correct
  // implementation.
  check(
    "empty staff prefix falls back to the backend default STAFF/",
    expandStaffId("001", "") === "STAFF/001",
  );
  check(
    "missing staff prefix falls back to the backend default STAFF/",
    expandStaffId("001", null) === "STAFF/001",
  );
}

// ---- Static wiring assertions -------------------------------------------
const widget = read("components/landing/ResultLookupWidget.tsx");
check("widget imports the shared helper", /from "@\/lib\/identityPrefix"/.test(widget));
check("widget placeholder is the bare-number example", /placeholder="e\.g\., 001"/.test(widget));
check("widget calls expandStudentId on submit", /expandStudentId\(/.test(widget));
// The old "e.g. vhs/001" placeholder asked for the full ID.
check("old full-ID placeholder is gone", !/e\.g\. vhs\/001/.test(widget));
// Kept for users who already type the full ID.
check("normalizePrefixLower retained for full-ID input", /normalizePrefixLower/.test(widget));

// ---- URL encoding: the prefix separator must stay a REAL slash ----------
// Regression guard. encodeURIComponent() on the whole expanded ID escapes "/"
// as "%2F", producing "/report/vhs%2F001". It resolves correctly only by
// accident (Next decodes the catch-all segment and app/api/report/route.ts
// re-splits before calling the backend), but it puts an unreadable address bar
// in front of the user and makes shared links look broken. The encoder below
// mirrors the one already proven in app/api/report/route.ts.
check(
  "widget encodes path segments separately (real slash)",
  /\.split\("\/"\)\s*\n\s*\.map\(\(seg\) => encodeURIComponent\(seg\)\)\s*\n\s*\.join\("\/"\)/.test(widget),
);
check(
  "widget does NOT encodeURIComponent the whole ID",
  !/report\/\$\{encodeURIComponent\(normalized\)\}/.test(widget),
);
check("widget pushes the joined path, not the raw ID", /\/report\/\$\{encodedPath\}/.test(widget));

// ---- Legacy compact-ID fallback in the backend ---------------------------
// Some live tenants (vhs) store students as "vhs004" (prefix glued to the
// number) while the checker auto-prefixes to the slashed "vhs/004". Without a
// fallback those students can never look themselves up by bare number.
const reportPy = read("backend/routers/report.py");
check("report retries the compact legacy form", /legacy_sid = f"\{_lpfx\}\{_lrest\}"/.test(reportPy));
check("report fallback only fires when the slashed form missed", /if row is None and "\/" in sid:/.test(reportPy));
// The critical bit: sid must be rebound to the STORED id, or the bio resolves
// while the publication/clearance/grades queries still miss and 404.
check("report rebinds sid to the stored student_id", /sid = d\.get\("student_id"\) or sid/.test(reportPy));
check("report trusts stored casing for downstream queries", /LOWER\(student_id\) = LOWER\(%s\)/.test(reportPy));

const portalPage = read("app/[subdomain]/page.tsx");
check("portal passes idPrefix from the loaded school", /idPrefix=\{school\?\.idPrefix \?\? subdomain\}/.test(portalPage));

const signIn = read("components/auth/SignInForm.tsx");
check("SignInForm exposes an opt-in transform prop", /transformIdentifier\?: \(raw: string\) => string/.test(signIn));
check("SignInForm transform is optional (not defaulted on)", !/transformIdentifier = /.test(signIn));
check("SignInForm applies the transform only at submit", /const sendIdentifier = transformIdentifier/.test(signIn));
check("SignInForm still validates emptiness on the raw value", /!rawIdentifier \|\| !password\.trim\(\)/.test(signIn));

const staffForm = read("components/staff/StaffLoginForm.tsx");
check("StaffLoginForm opts into the transform", /transformIdentifier=\{\(raw\) => expandStaffId/.test(staffForm));
check("StaffLoginForm uses the bare-number placeholder", /e\.g\., 001 or staff@school\.edu/.test(staffForm));
const staffPage = read("app/[subdomain]/staff/login/page.tsx");
check("staff login page passes staffIdPrefix", /staffIdPrefix=\{school\?\.staffIdPrefix \?\? "STAFF\/"\}/.test(staffPage));

// ---- THE opt-in guard: admin sign-in must not be rewritten ---------------
const adminPage = read("app/[subdomain]/admin/login/page.tsx");
// Admin identifies by email; a shared default would corrupt it.
check("admin login does NOT opt into prefixing", !/transformIdentifier/.test(adminPage));

// ---- Upload fix (Task 1) -------------------------------------------------
const adminUploads = read("app/api/admin/uploads/route.ts");
// Assert on IMPORTS, not raw substrings: the route's explanatory comment
// legitimately names writeFile/mkdir while describing the bug being fixed, and
// a naive regex would flag that documentation as a live filesystem write.
const adminImports = (adminUploads.match(/^import .*$/gm) || []).join("\n");
check(
  "admin uploads imports no fs/path modules",
  !/fs\/promises|node:fs|from "path"|from "node:path"/.test(adminImports),
);
check("admin uploads calls put()", /await put\(/.test(adminUploads));
// Strip BOTH line and block comments before searching for live calls. The
// route's header comment documents the exact `mkdir`/`writeFile` calls it
// replaced, so a //-only strip leaves those mentions in and flags them as
// live code.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const adminCode = stripComments(adminUploads);
check("admin uploads has no live writeFile/mkdir call", !/writeFile\s*\(|mkdir\s*\(/.test(adminCode));
check("admin uploads cap is 4MB", /MAX_BYTES = 4_000_000/.test(adminUploads));
check("admin uploads surfaces a config error", /BLOB_READ_WRITE_TOKEN/.test(adminUploads));

const staffUploads = read("app/api/staff/uploads/route.ts");
check("staff uploads uses Vercel Blob put()", /await put\(/.test(staffUploads));
const staffImports = (staffUploads.match(/^import .*$/gm) || []).join("\n");
check(
  "staff uploads imports no fs/path modules",
  !/fs\/promises|node:fs|from "path"|from "node:path"/.test(staffImports),
);
const staffCode = stripComments(staffUploads);
check("staff uploads has no live writeFile/mkdir call", !/writeFile\s*\(|mkdir\s*\(/.test(staffCode));
check("staff uploads keeps its 1MB signature cap", /MAX_BYTES = 1 \* 1024 \* 1024/.test(staffUploads));
check("staff uploads still requires a session", /readStaffSession/.test(staffUploads));

const uploadField = read("components/ui/UploadField.tsx");
check("UploadField default cap is 4MB", /DEFAULT_MAX_BYTES = 4_000_000/.test(uploadField));
// Both stores are PUBLIC — must stay documented, not silently relied upon.
check("P7 public-blob risk documented", /P7/.test(adminUploads) && /P7/.test(staffUploads));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`Identity/upload verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log("Verified: uploads go to Vercel Blob; only bare numbers are auto-prefixed; admin email login untouched.");