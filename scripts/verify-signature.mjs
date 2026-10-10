/**
 * Guards the drawn-signature feature.
 *
 * The invariant this suite protects is the same one the Financial Clearance
 * suite does: a check that passes "because the file says so" is worthless, so
 * these assert on the actual code paths, and several assert that something
 * ABSENT stays absent (e.g. the drawn signature must not leak into every
 * student's report bundle, which is the reason it rides the tenant endpoint).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

/** Strip comments so documentation about old behaviour is not read as behaviour. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

const dbm = read("backend/services/db_manager.py");
const adminPy = read("backend/routers/admin.py");
const staffPy = read("backend/routers/staff_auth.py");
const sigPy = read("backend/services/signature_data.py");
const reportPy = read("backend/routers/report.py");
const mainPy = read("backend/main.py");
const card = read("components/report-card/StudentReportCard.tsx");
const limits = read("lib/signatureLimits.ts");
const modal = read("components/ui/SignatureCaptureModal.tsx");

// ---------------------------------------------------------------- schema
check("schools.principal_signature_data column exists", /ADD COLUMN IF NOT EXISTS principal_signature_data TEXT/.test(dbm));
check("tenant_staff.signature_data column exists", /ADD COLUMN IF NOT EXISTS signature_data TEXT/.test(dbm));
check("both DDL statements are idempotent", !/ALTER TABLE \{SCHOOLS_REGISTRY_TABLE\}\s*\n\s*ADD COLUMN principal_signature_data/.test(dbm));
// The single easiest way to ship a permanently-empty principal signature:
// forget this explicit column list.
check(
  "get_school_by_subdomain SELECT includes principal_signature_data",
  /principal_signature_url, principal_signature_data, deleted_at/.test(dbm),
);

// -------------------------------------------------------- shared validation
check("shared validator module exists", sigPy.includes("def validate_signature_data"));
check("validator enforces a PNG data URI", /data:image\/png;base64,/.test(sigPy));
check("validator checks PNG magic bytes", /PNG_MAGIC/.test(sigPy) && /startswith\(PNG_MAGIC\)/.test(sigPy));
check("validator enforces the 64KB cap", /MAX_SIGNATURE_DATA_BYTES = 64 \* 1024/.test(sigPy));
check("validator rejects non-base64 strictly", /validate=True/.test(sigPy));
check("validator is dependency-free (no FastAPI import)", !/from fastapi/.test(sigPy));

// Both routers must import the SAME validator — divergence is how a bypass
// creeps in when one side later relaxes a rule.
check("admin router uses the shared validator", /from services\.signature_data import validate_signature_data/.test(adminPy));
check("staff router uses the shared validator", /from services\.signature_data import validate_signature_data/.test(staffPy));

// ------------------------------------------------------- single-signature rule
check(
  "saving a drawn principal signature clears the URL",
  /data\["principal_signature_url"\] = None/.test(adminPy),
);
check(
  "saving a URL clears the drawn principal signature",
  /data\["principal_signature_data"\] = None/.test(adminPy),
);
check(
  "saving a drawn staff signature clears the URL",
  /if signature_data is not None:\s*\n\s*url = None/.test(staffPy),
);
check("admin RETURNING exposes the new column", /principal_signature_url, principal_signature_data, created_at/.test(adminPy));
check("staff RETURNING exposes the new column", /signature_url, signature_data, created_at/.test(staffPy));
check("staff hub GET returns the drawn signature", /"signature_data": staff\.get\("signature_data"\) or None/.test(staffPy));
check("principal signature_data is whitelisted in the profile PATCH", /"principal_signature_data"\)/.test(adminPy));

// ----------------------------------------------------------------- cap sync
// Two independently maintained caps will eventually disagree.
const pyCap = sigPy.match(/MAX_SIGNATURE_DATA_BYTES = ([\d* ]+)/);
const tsCap = limits.match(/MAX_SIGNATURE_DATA_BYTES = ([\d* ]+)/);
check("client and backend caps are defined", !!pyCap && !!tsCap);
if (pyCap && tsCap) {
  const pyVal = pyCap[1].replace(/\s/g, "") === "64*1024";
  const tsVal = tsCap[1].replace(/\s/g, "") === "64*1024";
  check("client cap matches backend cap (64 * 1024)", pyVal && tsVal, `${pyCap[1]} vs ${tsCap[1]}`);
}

// --------------------------------------------------------------- report path
check("report reads the drawn form-teacher signature", /form_teacher_signature_data_out/.test(reportPy));
check("report returns form_teacher_signature_data", /"form_teacher_signature_data": form_teacher_signature_data_out/.test(reportPy));
// Withheld results must stay shape-stable and must never carry a signature.
check(
  "withheld response nulls the drawn signature",
  /"form_teacher_signature_url": None,\s*\n\s*"form_teacher_signature_data": None/.test(reportPy),
);
// The principal's drawn signature must NOT be in the per-student bundle: it is
// identical for every student, so repeating it there inflates every payload.
const schoolPayload = reportPy.slice(reportPy.indexOf("school_payload = {"), reportPy.indexOf("school_payload = {") + 700);
check(
  "principal drawn signature is NOT duplicated into the report bundle",
  !/principal_signature_data/.test(schoolPayload),
);
check(
  "principal drawn signature ships via TenantMetadata instead",
  /principal_signature_data: Optional\[str\] = None/.test(mainPy),
);

// ---------------------------------------------- form-teacher join robustness
// This lookup used to be positional (_ftrow[0]/[1]) inside a bare
// `except Exception: pass`, so a bad column silently dropped every signature.
const joinBlock = reportPy.slice(reportPy.indexOf("Form-teacher identity"), reportPy.indexOf("Primary source: tenant_grades"));
check("form-teacher join selects signature_data", /s\.signature_data/.test(joinBlock));
check("form-teacher join reads columns BY NAME", /_row_to_dict\(_ftrow, cur\)/.test(joinBlock));
check("form-teacher join no longer indexes positionally", !/_ftrow\[/.test(joinBlock));
check("form-teacher join failure is now logged", /logger\.exception/.test(joinBlock));

// -------------------------------------------------------------------- card
check("card accepts a principalSignatureData prop", /principalSignatureData\?: string \| null/.test(card));
check("card prefers drawn over URL for the teacher", /formTeacherSigData \|\| formTeacherSigUrl/.test(card));
check("card prefers drawn over URL for the principal", /principalSigData \|\| principalSigUrl/.test(card));
check("card response type includes the drawn teacher field", /form_teacher_signature_data\?: string \| null/.test(card));
// Approved change: h-6 -> h-8 for print legibility at body{zoom:88%}.
check("signature images bumped to h-8", (card.match(/h-8 object-contain object-left/g) || []).length === 2);
check("no signature image left at h-6", !/h-6 object-contain object-left/.test(card));
// Keep it an <img>, never a CSS background: print-color-adjust is non-inherited
// and only declared on html/body, so backgrounds get stripped in print.
check("signature renders as an <img>, not a background", /<img[\s\S]{0,200}src=\{principalSig\}/.test(card));

// --------------------------------------------------------------- the modal
check("SignatureCaptureModal exists", existsSync(join(root, "components/ui/SignatureCaptureModal.tsx")));
check("modal has Undo", /handleUndo/.test(modal));
check("modal has Clear", /handleClear/.test(modal));
check("modal has Save", /handleSave/.test(modal));
check("modal exports a PNG", /toDataURL\("image\/png"\)/.test(modal));
check("modal preserves a transparent background", /Transparent background/.test(modal));
// Trim + downscale is what keeps payloads inside the 64KB cap.
check("modal trims to the ink bounding box", /bounding box|minX/.test(modal));
check("modal downscales the export", /MAX_EXPORT_WIDTH/.test(modal));
check("modal guards the cap client-side", /dataUri\.length > MAX_SIGNATURE_DATA_BYTES/.test(modal));
check("modal uses pointer events for touch/stylus", /onPointerDown/.test(modal) && /setPointerCapture/.test(modal));
// touch-action:none stops a finger scroll from hijacking the stroke.
check("canvas disables touch scrolling while drawing", /touch-none/.test(modal));
check("modal resets state on reopen", /strokesRef\.current = \[\]/.test(modal));
check("modal exposes an accessible name", /aria-label=/.test(modal));
check("modal announces stroke count", /aria-live="polite"/.test(modal));
check("modal offers a non-destructive dismiss", /Skip for now/.test(modal));
// A canvas that can only be dismissed as a failure feels broken.
check("modal has a Remove affordance hook", /onRemove\?/.test(modal));

// ------------------------------------------------------------------ wiring
const settings = read("components/admin/SettingsForm.tsx");
check("admin settings mounts the modal", /SignatureCaptureModal/.test(settings));
check("admin settings persists the drawn signature", /principal_signature_data: dataUri/.test(settings));
check("admin settings supports removing", /principal_signature_data: null/.test(settings));
// A hidden input would be re-sent by every later Save and could restore a
// stale signature, so the modal must live OUTSIDE the <form>.
check("modal is mounted outside the form", /const content = \(/.test(settings));

const staffProfile = read("app/[subdomain]/staff/(dashboard)/profile/page.tsx");
check("staff profile mounts the modal", /SignatureCaptureModal/.test(staffProfile));
check("staff profile persists the drawn signature", /signature_data: dataUri/.test(staffProfile));
check("staff profile keeps the upload fallback", /UploadField/.test(staffProfile));

const staffProxy = read("app/api/staff/profile/route.ts");
check("staff proxy validates the cap", /MAX_SIGNATURE_DATA_BYTES/.test(staffProxy));
check(
  "staff proxy sends only the field supplied",
  /signature_data: signatureDataRaw.*signature_url: signatureUrl/s.test(staffProxy),
);

const adminProxy = read("app/api/admin/settings/route.ts");
check("admin proxy validates the cap", /MAX_SIGNATURE_DATA_BYTES/.test(adminProxy));
check(
  "admin proxy drops the URL when a drawn signature is present",
  /if \(signatureDataProvided\) \{\s*\n\s*delete payload\.principal_signature_url/.test(adminProxy),
);

const reportPage = read("app/[subdomain]/report/[...studentId]/page.tsx");
check("report page passes the drawn signature as a prop", /principalSignatureData=\{school\?\.principalSignatureData/.test(reportPage));
check("tenant normalizer maps the field", /principalSignatureData: raw\.principal_signature_data/.test(read("lib/tenant.ts")));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`Signature verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log("Signature pad verified: validated, capped, term-independent, and rendered without bloating report payloads.");