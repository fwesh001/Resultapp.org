#!/usr/bin/env node
/**
 * verify-password-forms — guards the two ways a password form silently fails.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Both bugs this gates were invisible to the type checker and to every existing
 * test suite, and both presented to the user as something else entirely:
 *
 * 1. NESTED <form>. SettingsForm wrapped all four tabs in one <form>, and the
 *    Security tab's PasswordChange opened a form of its own inside it. Nested
 *    forms are invalid HTML — the parser drops the inner start tag — so the
 *    "Change password" button bound to the OUTER form and ran the profile save.
 *    The admin was told the password changed. It never did. React then reported
 *    a hydration mismatch and re-rendered, which is why it looked intermittent.
 *
 * 2. THE OTP BURNED TWICE. verify_email_otp consumed the code, then the profile
 *    write consumed it again, so every confirmed email change died at the save
 *    with "That verification code is invalid or has expired."
 *
 * A third class is checked while we are here: every password input in the app
 * must offer a reveal control, and each field must own its own state. A single
 * shared flag is how the Security tab came to reveal all three boxes at once.
 *
 * These are source-shape checks, which is the honest tool: there is no unit test
 * that can tell you a browser will refuse to nest two forms.
 *
 * Usage:  node scripts/verify-password-forms.mjs
 * Exit:   0 all pass, 1 any failure
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let pass = 0;
let fail = 0;
const ok = (m) => {
  console.log(`  PASS  ${m}`);
  pass++;
};
const no = (m, d) => {
  console.log(`  FAIL  ${m}\n          ${d}`);
  fail++;
};
const check = (m, fn) => {
  try {
    const why = fn();
    if (why) no(m, why);
    else ok(m);
  } catch (e) {
    no(m, e.message);
  }
};

/**
 * Region of the source between two markers, inclusive of start.
 * Used to answer "is X inside this block?" without a JS parser.
 */
function slice(src, startIdx, endIdx) {
  return src.slice(startIdx, endIdx < 0 ? src.length : endIdx);
}

// ---------------------------------------------------------------------------
// 1. No component renders its own <form> inside another component's <form>
// ---------------------------------------------------------------------------

console.log("\n=== 1. settings page has no nested form ===");
check("PasswordChange is not rendered inside SettingsForm's <form>", () => {
  const src = read("components/admin/SettingsForm.tsx");
  const formOpen = src.indexOf("<form");
  const formClose = src.indexOf("</form>");
  if (formOpen === -1 || formClose === -1) return "could not locate the outer <form>";

  const pw = src.indexOf("<PasswordChange");
  if (pw === -1) return "PasswordChange is no longer rendered at all";

  // The two branches are mutually exclusive, so a correct fix leaves exactly one
  // of these in the form region and one outside it.
  const insideForm = pw > formOpen && pw < formClose;
  const guarded = /\{!isSecurity\s*&&\s*\(/.test(src) && /\{isSecurity\s*&&\s*\(/.test(src);
  if (!guarded) return "the security tab is not behind an isSecurity guard";

  if (insideForm) {
    return "PasswordChange sits between <form> and </form> — its own form will be dropped by the parser";
  }
  return null;
});

check("the profile <form> only wraps profile fields, so Enter cannot submit it from Security", () => {
  const src = read("components/admin/SettingsForm.tsx");
  if (!/<form[^>]*ref=\{formRef\}/.test(src)) return "the form is not ref'd, so the dirty check cannot work";
  if (!/!isSecurity && \(/.test(src)) return "the form renders unconditionally on every tab";
  return null;
});

check("Save Changes is not offered on the Security tab", () => {
  const src = read("components/admin/SettingsForm.tsx");
  // It must live inside the same !isSecurity branch as the form.
  const guard = src.indexOf("!isSecurity && (");
  const btn = src.indexOf("Save Changes");
  const close = src.indexOf("</form>");
  if (guard === -1) return "no isSecurity guard found";
  if (btn === -1) return "the Save Changes button is missing";
  if (!(btn > guard && btn < close)) {
    return "Save Changes is reachable on the Security tab, where it has no profile fields to write";
  }
  return null;
});

// ---------------------------------------------------------------------------
// 2. The OTP is burned exactly once
// ---------------------------------------------------------------------------

console.log("\n=== 2. the email-change OTP is burned once, not twice ===");
check("email_change verifies WITHOUT consuming; registration still consumes", () => {
  const src = read("backend/routers/auth_flow.py");
  if (!/if payload\.purpose == "email_change":/.test(src)) {
    return "verify_email_otp does not branch on purpose";
  }
  if (!/check_email_otp\(/.test(src)) return "email_change does not use the non-consuming check";
  if (!/consume_email_otp\(/.test(src)) return "registration no longer consumes — that would allow replay";
  // The consume must be in the else branch, i.e. registration only.
  const checkAt = src.indexOf('if payload.purpose == "email_change":');
  const checkEnd = src.indexOf("else:", checkAt);
  const consumeAt = src.indexOf("consume_email_otp(", checkEnd);
  if (!(consumeAt > checkEnd)) return "consume_email_otp is not in the non-email_change branch";
  return null;
});

check("check_email_otp exists and shares one implementation with consume", () => {
  const src = read("backend/services/db_manager.py");
  if (!/def check_email_otp\(/.test(src)) return "check_email_otp is missing";
  if (!/def _email_otp_pass\(/.test(src)) return "the shared core is missing";
  // Both must delegate, so a fix to the attempt-counting cannot be applied to
  // one and forgotten in the other.
  const consume = src.slice(src.indexOf("def consume_email_otp("), src.indexOf("def check_email_otp("));
  const check = src.slice(src.indexOf("def check_email_otp("));
  if (!/burn=True/.test(consume)) return "consume_email_otp does not pass burn=True";
  if (!/burn=False/.test(check)) return "check_email_otp does not pass burn=False";
  return null;
});

check("a wrong guess still spends an attempt (brute-force cap survives)", () => {
  const src = read("backend/services/db_manager.py");
  const core = src.slice(src.indexOf("def _email_otp_pass("), src.indexOf("def consume_email_otp("));
  if (!/attempts = attempts \+ 1/.test(core)) {
    return "the shared core no longer increments attempts — a 6-digit code becomes an unlimited oracle";
  }
  // The increment must run on BOTH paths. On the success path the code above
  // has already returned (twice: burn and no-burn), so structurally what matters
  // is that the increment sits after the LAST of those returns — otherwise it is
  // unreachable on the non-consuming path and check_email_otp would never count.
  const matchedAt = core.indexOf("if matched and not expired and not exhausted:");
  const incAt = core.indexOf("attempts = attempts + 1");
  if (matchedAt === -1 || incAt === -1) return "could not locate the match test / attempt increment";
  const between = core.slice(matchedAt, incAt);
  const returns = (between.match(/return True/g) || []).length;
  if (returns < 2) {
    return `only ${returns} success return(s) before the attempt increment — the non-consuming path may never count`;
  }
  return null;
});

check("Verify applies the change itself instead of asking for a second click", () => {
  const src = read("components/admin/SettingsForm.tsx");
  const verifyAt = src.indexOf("async function verifyOtp(");
  if (verifyAt === -1) return "verifyOtp is missing";
  const body = slice(src, verifyAt, src.indexOf("\n  async function ", verifyAt + 10));
  if (!/await saveEmailChange\(/.test(body)) {
    return "verifyOtp does not save — it still only sets otpState and leaves the change unapplied";
  }
  if (/save the form to apply/i.test(read("components/admin/SettingsForm.tsx"))) {
    return "stale copy still tells the admin to press Save";
  }
  return null;
});

check("saveEmailChange writes only the email, never the whole profile", () => {
  const src = read("components/admin/SettingsForm.tsx");
  const at = src.indexOf("async function saveEmailChange(");
  if (at === -1) return "saveEmailChange is missing";
  const body = slice(src, at, src.indexOf("\n  async function ", at + 10));

  // Compare OBJECT KEYS, not prose. A substring search over the whole function
  // matches the word "address" inside the toast text and a comment, which is
  // how the first version of this check cried wolf on correct code.
  const jsonAt = body.indexOf("JSON.stringify({");
  if (jsonAt === -1) return "saveEmailChange does not send a JSON payload";
  const jsonEnd = body.indexOf("});", jsonAt);
  const payload = slice(body, jsonAt, jsonEnd);

  const allowed = new Set(["subdomain", "email", "otp_verified", "otp_code"]);
  const keys = [...payload.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]);
  const extra = keys.filter((k) => !allowed.has(k));
  if (extra.length) {
    return `saveEmailChange also sends ${extra.join(", ")} — a confirmed email would drag along unrelated edits`;
  }
  if (!keys.includes("email")) return "saveEmailChange does not send the email";
  if (!/otp_verified:\s*true/.test(payload)) return "saveEmailChange does not carry the proof";
  return null;
});

check("the outer Save no longer sends an OTP that is already spent", () => {
  const src = read("components/admin/SettingsForm.tsx");
  const at = src.indexOf("async function handleSubmit(");
  const body = slice(src, at, src.indexOf("\n  const inputClassName", at));
  if (/payload\.otp_code\s*=/.test(body)) {
    return "handleSubmit still forwards otp_code — it would be a second, doomed burn";
  }
  return null;
});

// ---------------------------------------------------------------------------
// 3. Every password field can be revealed, and owns its own reveal state
// ---------------------------------------------------------------------------

console.log("\n=== 3. every password field has a per-field reveal toggle ===");

const PASSWORD_FILES = [
  "components/auth/SignInForm.tsx",
  "components/auth/AdminSetupForm.tsx",
  "components/superadmin/SuperadminLoginForm.tsx",
  "components/admin/PasswordChange.tsx",
  "components/student/PasswordChangeForm.tsx",
  "components/forms/RegisterSchoolForm.tsx",
  "components/landing/ResultLookupWidget.tsx",
  "app/reset-password/page.tsx",
];

for (const rel of PASSWORD_FILES) {
  check(`${rel}: every password input has a reveal control`, () => {
    const src = read(rel);
    // Either the file delegates to the shared component, or it renders inputs
    // directly — in which case each needs its own toggle nearby.
    if (!/"password"/.test(src)) return null; // no password field in this file
    const usesShared = /PasswordToggle|PasswordField/.test(src);
    if (!usesShared && !/<Eye/.test(src)) {
      return "password inputs are present but there is no toggle anywhere in the file";
    }
    return null;
  });
}

check("no password form shares one reveal flag across several fields", () => {
  const offenders = [];
  for (const rel of PASSWORD_FILES) {
    const src = read(rel);
    // Count distinct field states vs. password inputs in files that render
    // inputs directly. A single `show` flag driving 2+ type= is the old bug.
    const generic = src.match(/\bconst \[show,\s*setShow\]/g);
    if (generic && (src.match(/\?\s*"text"\s*:\s*"password"/g) || []).length > 1) {
      offenders.push(rel);
    }
  }
  if (offenders.length) {
    return `a single \`show\` state drives multiple fields in: ${offenders.join(", ")}`;
  }
  return null;
});

check("the shared PasswordField manages its own visibility", () => {
  const src = read("components/ui/PasswordField.tsx");
  if (!/const \[visible, setVisible\] = useState\(false\)/.test(src)) {
    return "PasswordField does not own its reveal state — callers would have to share it";
  }
  if (!/type=\{visible \? "text" : "password"\}/.test(src)) return "PasswordField does not toggle the input type";
  if (!/type="button"/.test(src)) return "the toggle is missing type=button, so it would submit its form";
  return null;
});

check("Input exposes a trailing slot so login forms can host a toggle", () => {
  const src = read("components/ui/Input.tsx");
  if (!/trailing\?/.test(src)) return "Input has no trailing slot, so <Input type=password> cannot host a toggle";
  if (!/trailing && "pr-11"/.test(src)) return "the trailing control has no right padding reserved";
  return null;
});

check("the reveal button never sits on top of the password characters", () => {
  const offenders = [];
  const inputSrc = read("components/ui/Input.tsx");
  // Two legitimate ways to reserve the button's column:
  //   a) the field sets pr-1x itself, or
  //   b) it passes `trailing` and Input adds the padding centrally.
  const inputReserves = /trailing && "pr-11"/.test(inputSrc);
  for (const rel of PASSWORD_FILES) {
    const src = read(rel);
    if (!/"password"/.test(src)) continue;
    if (!/PasswordToggle|PasswordField|<Eye/.test(src)) continue;
    if (/pr-1[12]/.test(src)) continue;
    if (/trailing=/.test(src) && inputReserves) continue;
    offenders.push(rel);
  }
  if (offenders.length) {
    return `no right padding reserved for the toggle in: ${offenders.join(", ")}`;
  }
  return null;
});

// ---------------------------------------------------------------------------

console.log("\n==========================================");
console.log(`  ${pass} passed, ${fail} failed`);
console.log("==========================================");
if (fail === 0) {
  console.log("  PASSWORD FORMS OK — no nesting, one burn, every field revealable.");
} else {
  console.log("  A password form is broken. See the failures above.");
}
process.exit(fail === 0 ? 0 : 1);