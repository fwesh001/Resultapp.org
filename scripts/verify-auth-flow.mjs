#!/usr/bin/env node
/**
 * Email-verification / password-reset guard harness.
 *
 *   node scripts/verify-auth-flow.mjs
 *
 * This flow is the first in the app that sends a bearer-equivalent secret by
 * email, so each invariant below is one whose failure is not obvious from
 * reading the code:
 *
 *  1. TOKENS ARE HASHED AT REST — a DB dump must not yield a working reset URL.
 *  2. NO ACCOUNT ENUMERATION — forgot-password / request-verification must be
 *     byte-identical for known and unknown addresses. P0-1 closed this oracle
 *     for report cards; reintroducing it here would map every tenant's admin.
 *  3. NO PUBLIC EXISTENCE ENDPOINT — the verified flag is disclosed only after
 *     valid credentials (via the login response), never via a lookup route.
 *  4. SINGLE USE + EXPIRY — tokens are cleared by the same statement that
 *     consumes them, and carry a bounded TTL.
 *  5. THE BACKFILL EXISTS — without it, adding is_email_verified would
 *     instantly break every production login.
 *  6. SOFT LOGIN — an unverified user is never hard-blocked.
 *  7. DEV MODE NEVER FAKES SUCCESS — with no Brevo key, sending must return
 *     False, not a cheerful "check your inbox".
 *
 * Plain Node, matching the other verify-*.mjs harnesses.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const DB = path.join("backend", "services", "db_manager.py");
const NOTIFIER = path.join("backend", "services", "notifier.py");
const ROUTER = path.join("backend", "routers", "auth_flow.py");
const MAIN = path.join("backend", "main.py");
const ADMIN_AUTH = path.join("backend", "routers", "admin_auth.py");
const PLATFORM_AUTH = path.join("backend", "routers", "platform_auth.py");
const WALL = path.join("components", "auth", "VerifyEmailWall.tsx");
const SIGNIN = path.join("components", "auth", "SignInForm.tsx");
const REGISTER = path.join("components", "forms", "RegisterSchoolForm.tsx");
const OTP_SEND_PROXY = path.join("app", "api", "auth", "request-email-otp", "route.ts");
const OTP_VERIFY_PROXY = path.join("app", "api", "auth", "verify-email-otp", "route.ts");
const REGISTER_SCHOOL = path.join("app", "api", "register-school", "route.ts");

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

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const db = read(DB);
const notifier = read(NOTIFIER);
const router = read(ROUTER);
const main = read(MAIN);
const register = read(REGISTER);
const otpSend = read(OTP_SEND_PROXY);
const otpVerify = read(OTP_VERIFY_PROXY);
const registerSchool = read(REGISTER_SCHOOL);
const wall = read(WALL);
const signin = read(SIGNIN);

console.log("\nTokens: hashed at rest, single-use, expiring");
check("tokens are generated with `secrets` (CSPRNG)", () =>
  /secrets\.token_urlsafe\(/.test(db) ? true : "token generation does not use secrets.token_urlsafe"
);
check("tokens are stored as a sha256 hash", () =>
  /hashlib\.sha256\(/.test(db) ? true : "no sha256 hashing of tokens"
);
check("no plaintext token column is written", () => {
  const bad = db.match(/verification_token\s+TEXT|reset_password_token\s+TEXT(?!.*hash)/);
  return bad ? "a plaintext token column exists" : true;
});
check("both token columns are _hash columns", () =>
  /verification_token_hash\s+TEXT/.test(db) && /reset_password_token_hash\s+TEXT/.test(db)
    ? true
    : "expected *_token_hash columns"
);
check("token comparison is constant-time", () =>
  /hmac\.compare_digest/.test(db) ? true : "token/hash comparison is not constant-time"
);
check("verify clears the token in the same UPDATE that flips the flag", () =>
  /SET is_email_verified = TRUE,[\s\S]{0,160}verification_token_hash = NULL/.test(db)
    ? true
    : "verification does not null the hash atomically"
);
check("reset clears the token in the same UPDATE that sets the password", () =>
  /crypt\(%s, gen_salt\('bf'\)\)[\s\S]{0,160}reset_password_token_hash = NULL/.test(db)
    ? true
    : "password reset does not null the hash atomically"
);
check("expiry is enforced in the SQL predicate, not just in Python", () =>
  /verification_token_expires > NOW\(\)/.test(db) && /reset_password_expires > NOW\(\)/.test(db)
    ? true
    : "expiry is not enforced in the UPDATE ... WHERE clause"
);
check("TTLs are bounded and documented", () =>
  /VERIFICATION_TOKEN_TTL_MINUTES\s*=\s*24 \* 60/.test(db) && /RESET_TOKEN_TTL_MINUTES\s*=\s*60/.test(db)
    ? true
    : "unexpected TTL values"
);

/** Extract a python function body by brace matching, so sibling handlers
 *  can't fall outside the window (an earlier version missed a real regression
 *  because it only scanned part of the file). */
function pyBody(src, name) {
  const start = src.indexOf(`def ${name}(`);
  if (start === -1) return null;
  let depth = 0;
  let seen = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(") { depth += 1; seen = true; }
    else if (ch === ")") { depth -= 1; if (seen && depth === 0) { /* past signature */ } }
    if (seen && depth === 0 && ch === ":") {
      // Walk forward to the end of the indented block.
      const rest = src.slice(i + 1);
      const lines = rest.split("\n");
      const indent = (/^\s*/.exec(lines[0]) || [""])[0].length;
      const body = [rest];
      for (let j = 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.trim() === "") { body.push(line); continue; }
        const li = (/^\s*/.exec(line) || [""])[0].length;
        if (li <= indent && !/^\s*(#|""")/.test(line)) break;
        body.push(line);
      }
      return body.join("\n");
    }
  }
  return null;
}

console.log("\nNo account enumeration");
check("forgot-password returns the same generic body regardless of existence", () => {
  const body = pyBody(router, "forgot_password");
  if (!body) return "forgot_password not found";
  const returns = (body.match(/return _GENERIC_SENT/g) || []).length;
  return returns >= 2 ? true : `expected >=2 identical returns (found ${returns}) — one branch may differ`;
});
check("request-verification is also uniformly generic", () => {
  const body = pyBody(router, "request_verification");
  if (!body) return "request_verification not found";
  const returns = (body.match(/return _GENERIC_SENT/g) || []).length;
  return returns >= 2 ? true : `expected >=2 identical returns (found ${returns})`;
});
// The decisive check: an unknown address must NEVER produce a distinguishing
// status code in either handler.
check("no handler reveals account existence via a 4xx status", () => {
  const offenders = [];
  for (const fn of ["forgot_password", "request_verification"]) {
    const body = pyBody(router, fn);
    if (!body) { offenders.push(`${fn}: not found`); continue; }
    const m = body.match(/raise HTTPException\(\s*status_code\s*=\s*(4\d\d)/);
    if (m) offenders.push(`${fn}: raises ${m[1]} for some branch`);
  }
  return offenders.length === 0 ? true : offenders.join("; ");
});
check("no public 'does this account exist' endpoint", () =>
  /@router\.get\(["']\/verify-status["']/.test(router)
    ? "/verify-status is an enumeration oracle — the flag belongs in the login response only"
    : true
);
check("verify-email failure does not reveal why it failed", () =>
  /invalid or has expired/.test(router) ? true : "verify-email distinguishes failure causes"
);

console.log("\nThe backfill that prevents a production lockout");
check("is_email_verified column is added idempotently", () =>
  /ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN/.test(db)
    ? true
    : "no idempotent ADD COLUMN IF NOT EXISTS for is_email_verified"
);
check("existing rows are backfilled to verified", () =>
  /UPDATE \{_tbl\} SET is_email_verified = TRUE/.test(db)
    ? true
    : "no backfill — every existing admin would fail to sign in"
);
check("backfill is scoped so NEW rows stay unverified", () =>
  /is_email_verified = FALSE AND created_at < NOW\(\) - INTERVAL/.test(db)
    ? true
    : "backfill would also mark new signups as verified, defeating the flow"
);
check("staff accounts are untouched", () =>
  /tenant_staff/.test(db) && !/ALTER TABLE \{TENANT_STAFF_TABLE\} ADD COLUMN IF NOT EXISTS is_email_verified/.test(db)
    ? true
    : "staff table was modified — out of agreed scope"
);
check("only schools + platform_admins are in scope", () =>
  /_AUTH_TABLES\s*=\s*\(\s*"schools",\s*"platform_admins"\s*\)/.test(db)
    ? true
    : "unexpected table scope"
);
check("table names are whitelisted (no SQL injection)", () =>
  /def _resolve_auth_table/.test(db) && /if table in _AUTH_TABLES/.test(db)
    ? true
    : "table identifiers are not whitelisted"
);

console.log("\nSoft login — never a hard block");
check("login response exposes email_verified", () =>
  /email_verified/.test(read(ADMIN_AUTH)) && /email_verified/.test(read(PLATFORM_AUTH))
    ? true
    : "login responses do not return the verified flag"
);
check("SignInForm holds navigation instead of rejecting login", () =>
  /setUnverified/.test(signin) && /router\.push/.test(signin)
    ? true
    : "sign-in does not implement the soft-login gate"
);
check("the wall offers a continue escape hatch", () =>
  /Continue to my portal/.test(wall) ? true : "no way past the interstitial — that is a hard block"
);
check("the wall tells users to check spam", () =>
  /Check your spam folder/i.test(wall) ? true : "missing the spam-folder prompt (personal sender address)"
);
check("resend copy avoids claiming delivery for unknown accounts", () =>
  /If that address has an account/i.test(wall)
    ? true
    : "resend copy implies a real account exists — enumeration by copy"
);

console.log("\nDev mode must not fake a send");
check("send_auth_email returns False with no API key", () => {
  const fn = notifier.slice(notifier.indexOf("def send_auth_email"));
  const block = fn.slice(0, fn.indexOf('payload = {'));
  return /not cfg\["api_key"\][\s\S]{0,400}return False/.test(block)
    ? true
    : "missing key returns something other than False";
});
check("verification/reset senders surface the failure", () =>
  /Verification email NOT delivered/.test(notifier) && /Reset email NOT delivered/.test(notifier)
    ? true
    : "send failure is swallowed"
);
check("raw tokens are never logged", () =>
  /raw_token\}\s*$|link not logged/.test(notifier) && !/logger\.(info|warning|error)\([^)]*\{raw_token\}/.test(notifier)
    ? true
    : "a raw token reaches the logs — logs are not a secure channel"
);
check("Brevo 401/403 is logged loudly", () =>
  /401, 403/.test(notifier) ? true : "a bad API key fails silently"
);

console.log("\nWiring");
check("auth_flow router is registered in main.py", () =>
  /from routers\.auth_flow import router as auth_flow_router/.test(main) &&
  /app\.include_router\(auth_flow_router\)/.test(main)
    ? true
    : "auth_flow router is not mounted"
);
check("auth_flow is secret-gated", () =>
  /dependencies=\[Depends\(_verify_auth_secret\)\]/.test(router)
    ? true
    : "auth_flow router is not secret-gated"
);
check("verification email is sent after the registry row exists", () => {
  const i = main.indexOf("issue_verification_token(admin_email");
  const j = main.indexOf("register_school(");
  if (i === -1) return "no verification send during provisioning";
  return i > j ? true : "verification is sent before the registry row exists, so it can never match";
});
check("Brevo config uses env vars", () =>
  /BREVO_API_KEY/.test(notifier) && /BREVO_SENDER_EMAIL/.test(notifier)
    ? true
    : "Brevo config not read from environment"
);
check("links honour PUBLIC_BASE_URL (no domain yet)", () =>
  /PUBLIC_BASE_URL/.test(notifier) ? true : "no way to point links at a non-domain host"
);
check("no auth proxy leaks the shared secret to the browser", () => {
  const proxies = ["app/api/auth/verify-email", "app/api/auth/forgot-password", "app/api/auth/reset-password"]
    .map((p) => read(path.join(...p.split("/")) + "/route.ts"));
  return proxies.every((p) => !/NEXT_PUBLIC_.*SECRET|SESSION_SECRET/.test(p))
    ? true
    : "a proxy references a secret that could reach the client";
});

// ---------------------------------------------------------------------------
// Registration OTP (6-digit inbox-ownership proof).
//
// A 6-digit code is 1e6 candidates, so the controls that matter are the attempt
// cap and the throttle — NOT the hash. These checks exist so a later refactor
// cannot silently drop the caps and leave the endpoint enumerable in practice.
// ---------------------------------------------------------------------------
console.log("\nRegistration OTP — inbox ownership before payment");

check("OTP endpoints exist and are secret-gated", () => {
  if (!/@router\.post\("\/request-email-otp"/.test(router)) return "no /request-email-otp route";
  if (!/@router\.post\("\/verify-email-otp"/.test(router)) return "no /verify-email-otp route";
  return router.includes("dependencies=[Depends(_verify_auth_secret)]")
    ? true
    : "the router is no longer secret-gated";
});

check("OTP codes are never stored in the clear", () => {
  if (!/code_hash/.test(db)) return "no code_hash column";
  return /hash_auth_token\(raw\)/.test(db)
    ? true
    : "the raw code appears to be stored rather than hashed";
});

check("OTP is single-use and expires", () => {
  if (!/consumed_at = NOW\(\)/.test(db)) return "a successful verify does not burn the code";
  if (!/expires_at/.test(db)) return "no expiry column";
  return /EMAIL_OTP_TTL_MINUTES/.test(db) && /int\(os\.getenv/.test(db)
    ? true
    : "no bounded, configurable TTL";
});

check("brute force is capped by an attempt limit", () => {
  if (!/attempts = attempts \+ 1/.test(db)) return "a wrong guess does not spend an attempt";
  // Assert the cap is a SMALL literal, not merely that the name exists —
  // a 6-digit code is 1e6 candidates, so a cap set to 100000 is no cap at all.
  const cap = /EMAIL_OTP_MAX_ATTEMPTS\s*=\s*(\d+)/.exec(db);
  if (!cap) return "EMAIL_OTP_MAX_ATTEMPTS is not a literal integer";
  const n = Number(cap[1]);
  if (n < 1 || n > 10) {
    return `the attempt cap is ${n} — with only 1e6 candidates it must be small (<=10)`;
  }
  // And it must not be silently overridable by env.
  if (/EMAIL_OTP_MAX_ATTEMPTS\s*=\s*int\(\s*os\.getenv/.test(db)) {
    return "the attempt cap is env-configurable — an operator typo would disable it";
  }
  return true;
});

check("OTP TTL is short and bounded", () => {
  const ttl = /EMAIL_OTP_TTL_MINUTES\s*=\s*int\(\s*os\.getenv\([^,]+,\s*"(\d+)"/.exec(db);
  if (!ttl) return "EMAIL_OTP_TTL_MINUTES has no literal default";
  const m = Number(ttl[1]);
  return m > 0 && m <= 60
    ? true
    : `the default TTL is ${m} minutes — a typed code should expire far sooner`;
});

check("OTP verify is rate limited", () =>
  /rate_limit\.check\(/.test(router)
    ? true
    : "no throttle on the verify endpoint — 1e6 candidates is guessable"
);

check("OTP generation is throttled and cooldown-gated", () => {
  // The key is built as f"otp:{payload.purpose}:{email}" — a literal backtick
  // would never match.
  if (!/_cooldown_ok\(\s*f?"otp:/.test(router)) return "no cooldown gate on generation";
  return /otp-send:/.test(router)
    ? true
    : "no per-address generation cap — a caller could mail-bomb an address";
});

check("OTP verify is race-safe (row locked)", () =>
  /FOR UPDATE/.test(db) ? true : "two concurrent submits of one code could both win"
);

check("OTP request reveals nothing about account existence", () => {
  const fn = router.slice(
    router.indexOf("def request_email_otp"),
    router.indexOf("def verify_email_otp")
  );
  if (!fn) return "cannot locate request_email_otp";
  return /is_email_verified|schools|platform_admins/.test(fn)
    ? "the send path branches on account state — that is an enumeration oracle"
    : true;
});

check("OTP verify collapses wrong/expired/replayed into one message", () => {
  const fn = router.slice(router.indexOf("def verify_email_otp"));
  if (!fn) return "cannot locate verify_email_otp";
  return /incorrect or has expired/.test(fn)
    ? true
    : "the failure message does not merge the failure modes (oracle risk)";
});

/** Strip docstrings and comments so prose can't satisfy (or trip) a check. */
const stripProse = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/("""|''')[\s\S]*?\1/g, "");

check("no raw OTP is ever logged", () => {
  const send = stripProse(
    notifier.slice(
      notifier.indexOf("def send_otp_email"),
      notifier.indexOf("def send_verification_email")
    )
  );
  if (!send) return "cannot locate send_otp_email";
  // Only interpolation of the code variable matters — a message that merely
  // says "code not logged" is the opposite of a leak.
  return !/logger\.\w+\([^)]*\{code\}/.test(send)
    ? true
    : "a log statement interpolates the raw code";
});

check("OTP email builds no link (so PUBLIC_BASE_URL cannot break it)", () => {
  const send = stripProse(
    notifier.slice(
      notifier.indexOf("def send_otp_email"),
      notifier.indexOf("def send_verification_email")
    )
  );
  if (!send) return "cannot locate send_otp_email";
  return !/public_base_url\s*\(/.test(send) && !/href=/.test(send)
    ? true
    : "the OTP email builds a URL — it should be a typed code";
});

// ---------------------------------------------------------------------------
// Wizard gating — payment must not be reachable without consent + a proven inbox.
// ---------------------------------------------------------------------------
console.log("\nRegistration wizard — payment gating");

check("Pay is gated on BOTH consent and verified email", () => {
  const step3 = register.slice(register.indexOf("if (currentStep === 3) {"));
  if (!step3) return "cannot locate Step 3";
  // The button binds a derived flag; resolve it rather than demanding the
  // whole expression be inline.
  const bound = step3.match(/disabled=\{([^}]*)\}/);
  if (!bound) return "no disabled binding on the payment button";
  const flag = bound[1].trim();
  const def = new RegExp(`const ${flag} =([^;]+);`).exec(step3);
  if (!def) return `cannot resolve "${flag}" — the button may never be gated`;
  const expr = def[1];
  return /payBlockedByTerms/.test(expr) && /payBlockedByEmail/.test(expr)
    ? true
    : `"${flag}" is "${expr.trim()}" — it must require both flags`;
});

check("the consent flag itself is derived from the checkbox", () => {
  const def = /const payBlockedByTerms =([^;]+);/.exec(register);
  if (!def) return "payBlockedByTerms is not defined";
  return /!values\.acceptTerms/.test(def[1])
    ? true
    : "payBlockedByTerms does not read the consent checkbox";
});

check("the email flag itself is derived from the verified state", () => {
  const def = /const payBlockedByEmail =([^;]+);/.exec(register);
  if (!def) return "payBlockedByEmail is not defined";
  return /!isEmailVerified/.test(def[1])
    ? true
    : "payBlockedByEmail does not read isEmailVerified";
});

check("the disabled payment button explains itself", () =>
  /payHint/.test(register)
    ? true
    : "a dead button with no reason shown — unblocks are impossible for the user"
);

check("Step 1 cannot be left without a verified inbox", () => {
  const fn = register.slice(
    register.indexOf("async function handleStep1Next"),
    register.indexOf("function handleStep2Next")
  );
  if (!fn) return "cannot locate handleStep1Next";
  // The flag must be CHECKED, not merely read — `!isEmailVerified` with an
  // early return is the gate; a bare reference would not be.
  const guard = fn.match(/if\s*\(!isEmailVerified\)\s*\{[\s\S]*?\n\s*\}/);
  if (!guard) return "handleStep1Next has no !isEmailVerified early-return guard";
  if (!/return;/.test(guard[0])) return "the guard does not return before advancing";
  // And the guard must come BEFORE the step transition, or it is decorative.
  const guardAt = fn.indexOf("!isEmailVerified");
  const advanceAt = fn.indexOf("setCurrentStep(2)");
  if (advanceAt === -1) return "handleStep1Next never advances to Step 2";
  return guardAt < advanceAt
    ? true
    : "the email check runs after the step transition — it blocks nothing";
});

check("Step 2 cannot be left without passing its own validation", () => {
  const fn = register.slice(
    register.indexOf("function handleStep2Next"),
    register.indexOf("function goBack")
  );
  if (!fn) return "cannot locate handleStep2Next";
  const guardAt = fn.indexOf("validateStep2()");
  const advanceAt = fn.indexOf("setCurrentStep(3)");
  if (guardAt === -1) return "handleStep2Next does not call validateStep2()";
  if (advanceAt === -1) return "handleStep2Next never advances to Step 3";
  return /if\s*\(!validateStep2\(\)\)\s*return/.test(fn) && guardAt < advanceAt
    ? true
    : "validateStep2() does not gate the transition";
});

check("Step 1 validation runs before the email gate", () => {
  const fn = register.slice(
    register.indexOf("async function handleStep1Next"),
    register.indexOf("function handleStep2Next")
  );
  const vAt = fn.indexOf("validateStep1()");
  const gAt = fn.indexOf("!isEmailVerified");
  return vAt !== -1 && gAt !== -1 && vAt < gAt
    ? true
    : "field errors should be reported before the verification gate";
});

check("OTP proxies fail loudly on missing configuration", () => {
  // A missing BACKEND_URL used to fall through to a hardcoded droplet IP whose
  // port was closed, surfacing as an opaque 502 indistinguishable from a Brevo
  // failure. Both proxies must name the misconfiguration instead.
  for (const [name, src] of [["request-email-otp", otpSend], ["verify-email-otp", otpVerify]]) {
    if (!/BACKEND_API_SECRET/.test(src)) return `${name} does not reference BACKEND_API_SECRET`;
    if (!/missing BACKEND_API_SECRET/.test(src)) {
      return `${name} has no explicit missing-BACKEND_API_SECRET guard`;
    }
    // Backend resolution moved into the shared resolveBackendBase() helper,
    // so the guard is the call to it plus a bail-out on !ok.
    if (!/resolveBackendBase\(\)/.test(src)) {
      return `${name} does not validate the backend URL via resolveBackendBase()`;
    }
    if (!/if \(!backend\.ok\)/.test(src)) {
      return `${name} calls resolveBackendBase() but does not bail when it fails`;
    }
    if (!/status: 500/.test(src)) {
      return `${name} does not report a misconfiguration as 500`;
    }
  }
  return true;
});

check("OTP proxies never fall back to a hardcoded backend", () => {
  // The specific regression: a static IP fallback re-introduces the closed-port
  // call that made this bug undiagnosable. Only EXECUTABLE code counts — the
  // proxies document the old fallback by name in their header comment, so the
  // source must be stripped of comments before this is meaningful.
  const banned = /159\.223\.178\.34|127\.0\.0\.1:8000|localhost:8000/;
  for (const [name, src] of [["request-email-otp", otpSend], ["verify-email-otp", otpVerify]]) {
    const code = stripProse(src);
    if (banned.test(code)) return `${name} still references a hardcoded backend address in code`;
    // No fallback chain: exactly one env var, via the shared resolver.
    if (/PROVISION_API_URL|NEXT_PUBLIC_API_URL|API_URL/.test(code)) {
      return `${name} reads an alternative backend env var — that reintroduces the fallback chain`;
    }
    // The resolved base must be what gets used, not a re-read of the env var.
    if (/\$\{backend\.base\}/.test(code)) continue;
    if (/\$\{BACKEND_URL\}/.test(code)) {
      return `${name} interpolates the raw env var instead of the validated backend.base`;
    }
  }
  return true;
});

check("a Markdown-pasted BACKEND_URL is rejected, not fetched", () => {
  // Production incident: BACKEND_URL was set to
  // "[https://api.resultapp.org](https://api.resultapp.org)". fetch() threw
  // ERR_INVALID_URL, every proxy 502'd, and the HTML error body broke the
  // client's res.json() — so a rich-text paste presented as "email failed".
  const lib = read(path.join("lib", "api", "authProxy.ts"));
  if (!/export function resolveBackendBase/.test(lib)) {
    return "there is no resolveBackendBase() validator in lib/api/authProxy.ts";
  }
  if (!/new URL\(/.test(lib)) return "the validator never parses the URL";
  // It must reject bracket/paren/whitespace shapes, not merely fail to parse.
  // Assert the rejection is reachable: the bracket/paren/whitespace test must
  // still be CALLED, not merely declared. A deleted constant leaves the
  // declaration absent; a deleted call leaves an unused one.
  if (!/MARKDOWN_LINK_RE\.test\(/.test(lib)) {
    return "MARKDOWN_LINK_RE is declared but never tested — the rich-text paste is no longer rejected";
  }
  if (!/const MARKDOWN_LINK_RE =/.test(lib)) {
    return "there is no Markdown-link detection pattern";
  }
  // And the shared helper must be wired into the generic postAuth too.
  if (!/resolveBackendBase\(\)/.test(lib)) {
    return "postAuth does not use the validator";
  }
  if (!/Server misconfigured/.test(lib)) {
    return "postAuth does not return a named misconfiguration";
  }
  return true;
});

check("OTP proxies log the target host on transport failure", () => {
  for (const [name, src] of [["request-email-otp", otpSend], ["verify-email-otp", otpVerify]]) {
    const fn = src.slice(src.indexOf("} catch"));
    if (!fn) return `${name} has no catch block`;
    if (!/console\.error/.test(fn)) return `${name} does not log on transport failure`;
    if (!/host/.test(fn)) {
      return `${name} logs the failure but not the host it called`;
    }
  }
  return true;
});

check("OTP proxies never log the secret or the OTP code", () => {
  for (const [name, src] of [["request-email-otp", otpSend], ["verify-email-otp", otpVerify]]) {
    const logged = src
      .split("console.error")
      .slice(1)
      .join("console.error");
    if (/PROXY_SECRET[},)]/.test(logged) && !/not set/.test(logged)) {
      return `${name} may log the shared secret`;
    }
    // verify-email-otp handles a code; it must never appear in a log statement.
    if (name === "verify-email-otp" && /\$\{code\}/.test(logged)) {
      return `${name} logs the OTP code`;
    }
  }
  return true;
});

check("editing the admin email revokes verification", () => {
  const fn = register.slice(
    register.indexOf("function handleChange"),
    register.indexOf("function resetOtp")
  );
  if (!fn) return "cannot locate handleChange";
  return /field === "adminEmail"/.test(fn) && /resetOtp\(\)/.test(fn)
    ? true
    : "changing the address leaves the old proof valid";
});

check("consent is rendered directly above the payment button", () => {
  const step3 = register.slice(register.indexOf("if (currentStep === 3) {"));
  if (!step3) return "cannot locate Step 3";
  const consent = step3.indexOf('id="acceptTerms"');
  const pay = step3.indexOf("startFlutterwaveCheckout");
  if (consent === -1) return "no consent checkbox in Step 3";
  if (pay === -1) return "no payment button in Step 3";
  return consent < pay ? true : "the consent checkbox sits after the payment button";
});

check("the admin password is never sent to Flutterwave in meta", () => {
  const m = register.match(/meta:\s*\{[\s\S]*?\}/);
  if (!m) return "no meta block found";
  return /adminPassword/.test(m[0])
    ? "meta carries the admin password — it is disclosed to a third party"
    : true;
});

check("OTP proxies never expose the shared secret", () => {
  const proxies = [otpSend, otpVerify];
  return proxies.every((p) => !/NEXT_PUBLIC_.*SECRET|SESSION_SECRET/.test(p))
    ? true
    : "an OTP proxy references a secret that could reach the client";
});

check("OTP proxies surface backend delivery failures", () => {
  // postAuth is what flattens the backend's honest 502 ("we could not send the
  // code") into an error response. If it stopped doing so, a broken Brevo
  // config would be indistinguishable from a delivered message.
  const proxyLib = read(path.join("lib", "api", "authProxy.ts"));
  if (!/if \(!res\.ok\)/.test(proxyLib)) {
    return "postAuth no longer forwards the backend's non-200 status";
  }
  // And the wizard must actually branch on it rather than showing "sent".
  return /if \(!res\.ok\)/.test(register)
    ? true
    : "the wizard ignores non-200 responses from the OTP proxies";
});

check("adminName is threaded from the wizard to the backend", () => {
  // End-to-end: wizard state -> provision payload -> FastAPI schema -> DB.
  if (!/adminName: string;/.test(register)) return "the wizard has no adminName state";
  if (!/adminName: values\.adminName\.trim\(\)/.test(register)) {
    return "the provision payload does not carry adminName";
  }
  if (!/fastApiPayload\.admin_name = adminName/.test(registerSchool)) {
    return "the proxy does not forward admin_name to FastAPI";
  }
  if (!/admin_name: Optional\[str\]/.test(main)) {
    return "ProvisionRequest has no admin_name field";
  }
  return /kwargs\.get\("admin_name"\)/.test(db)
    ? true
    : "register_school never persists admin_name";
});

check("adminName bounds agree across all three layers", () => {
  // Provisioning runs AFTER payment. If the client accepts a name the backend
  // rejects, the user pays and then gets a 422 — the worst possible ordering.
  const fe = /const ADMIN_NAME_MIN = (\d+);[\s\S]*?const ADMIN_NAME_MAX = (\d+);/.exec(register);
  const be = /admin_name: Optional\[str\] = Field\(None, min_length=(\d+), max_length=(\d+)/.exec(main);
  const px = /const ADMIN_NAME_MIN = (\d+);[\s\S]*?const ADMIN_NAME_MAX = (\d+);/.exec(registerSchool);
  if (!fe) return "the wizard does not declare ADMIN_NAME_MIN/MAX";
  if (!be) return "ProvisionRequest.admin_name declares no min/max";
  if (!px) return "the proxy does not declare ADMIN_NAME_MIN/MAX";
  const key = `${fe[1]}:${fe[2]}`;
  if (be[0] && `${be[1]}:${be[2]}` !== key) {
    return `backend bounds are ${be[1]}:${be[2]} but the wizard uses ${key}`;
  }
  if (`${px[1]}:${px[2]}` !== key) {
    return `proxy bounds are ${px[1]}:${px[2]} but the wizard uses ${key}`;
  }
  return true;
});

check("the wizard does not loosen the adminName bound", () => {
  // Regression guard for the exact bug: a client min below the backend min means
  // a short name passes Step 2, gets charged, then 422s during provisioning.
  const fn = register.slice(
    register.indexOf("function validateSecurity"),
    register.indexOf("function validateStep1")
  );
  if (!fn) return "cannot locate validateSecurity";
  if (/name\.length < 2\b/.test(fn)) {
    return "validateSecurity hardcodes a 2-character minimum";
  }
  if (!/name\.length < ADMIN_NAME_MIN/.test(fn)) {
    return "validateSecurity does not use the shared ADMIN_NAME_MIN";
  }
  // Comparing the two named constants is not enough — they must equal the
  // BACKEND bound, or both drift together and the check passes while the
  // post-payment 422 remains.
  const be = /admin_name: Optional\[str\] = Field\(None, min_length=(\d+), max_length=(\d+)/.exec(main);
  const fe = /const ADMIN_NAME_MIN = (\d+);[\s\S]*?const ADMIN_NAME_MAX = (\d+);/.exec(register);
  if (!be || !fe) return "cannot compare wizard and backend bounds";
  if (Number(fe[1]) < Number(be[1])) {
    return `the wizard accepts ${fe[1]} characters but the backend requires ${be[1]}`;
  }
  if (Number(fe[2]) > Number(be[2])) {
    return `the wizard accepts ${fe[2]} characters but the backend caps at ${be[2]}`;
  }
  return true;
});

check("an out-of-range admin name is omitted, not forwarded as empty", () => {
  // Forwarding admin_name="" would violate ProvisionRequest's min_length.
  // The proxy must drop the key instead.
  if (!/if \(adminName\) fastApiPayload\.admin_name = adminName/.test(registerSchool)) {
    return "the proxy forwards admin_name unconditionally";
  }
  const norm = registerSchool.slice(
    registerSchool.indexOf("const emailLocalPart"),
    registerSchool.indexOf("const adminPassword")
  );
  return /ADMIN_NAME_MIN/.test(norm)
    ? true
    : "the email-prefix fallback ignores the backend length bounds";
});

check("ProvisionRequest ignores unknown fields rather than 422-ing", () => {
  // This route runs post-payment: a strict schema would turn a stray key from
  // the Next.js proxy into a charged-but-unprovisioned tenant.
  //
  // Anchored to the start of a line so it can only match real code. The
  // rationale comment quotes extra="ignore" verbatim, and a loose substring
  // search would be satisfied by that comment alone.
  const cls = main.slice(main.indexOf("class ProvisionRequest"));
  if (!cls) return "cannot locate ProvisionRequest";
  if (/^\s*model_config\s*=\s*ConfigDict\(\s*extra\s*=\s*["']ignore["']/m.test(cls)) {
    return /^\s*model_config\s*=\s*ConfigDict\(\s*extra\s*=\s*["']forbid["']/m.test(cls)
      ? "ProvisionRequest forbids extra fields — a stray key would 422 a paid user"
      : true;
  }
  return "ProvisionRequest does not pin ConfigDict(extra='ignore') in code (the Pydantic default is ignore, but it must be deliberate)";
});

check("the Flutterwave customer name is the admin name, not the email prefix", () => {
  const m = /const customerName\s*=\s*([^;]+);/.exec(register);
  if (!m) return "no customerName assignment";
  return /values\.adminName/.test(m[1])
    ? true
    : "the checkout still derives the payer name from the email";
});

check("the welcome email greeting uses the admin name", () => {
  // backend derives it once, then hands it to send_welcome_email.
  if (!/admin_name = \(payload\.admin_name or admin_email\.split/.test(main)) {
    return "the backend no longer resolves admin_name from the payload";
  }
  return /admin_name=admin_name,/.test(main)
    ? true
    : "send_welcome_email is not given the resolved admin_name";
});

check("email SVG data URIs are quote-safe", () => {
  // Regression guard for a silent failure: the grid and clipboard URIs used to
  // embed raw single quotes (xmlns='...') inside an UNQUOTED url(). Per CSS
  // tokenisation that token is invalid, so every client dropped the background
  // and the markup looked correct while painting nothing.
  if (!/def _svg_data_uri/.test(notifier)) {
    return "there is no _svg_data_uri() encoder in notifier.py";
  }
  // The encoder must percent-encode quotes, not merely pass them through.
  if (!/%27/.test(notifier)) {
    return "_svg_data_uri does not encode quotes as %27 — unquoted url() will be dropped";
  }
  // The generated URIs themselves must carry no raw quote.
  for (const name of ["_EMAIL_GRID_URI", "_EMAIL_CLIP_URI"]) {
    const decl = new RegExp(`${name} = _svg_data_uri\\(`).test(notifier);
    if (!decl) return `${name} is not built via _svg_data_uri()`;
  }
  const handWritten = /data:image\/svg\+xml;charset=utf-8,"\s*\n?\s*%3Csvg/.test(notifier);
  return !handWritten
    ? true
    : "a hand-written SVG data URI survives — its encoding can silently drift again";
});

check("the email grid is not hidden under the opaque wrapper table", () => {
  // A body background paints beneath a full-width bgcolor table, so the grid
  // must sit on the padding cell to be visible at all.
  const shell = notifier.slice(
    notifier.indexOf("def _auth_email_shell"),
    notifier.indexOf("def _cta_button")
  );
  if (!shell) return "cannot locate _auth_email_shell";
  const bodyOpen = shell.split("<body")[1] || "";
  if (/background-image/.test(bodyOpen)) {
    return "the grid is on <body>, where the opaque wrapper table hides it";
  }
  if (!/background-image:url\(\{_EMAIL_GRID_URI\}\)/.test(shell)) {
    return "the grid is not applied anywhere in the shell";
  }
  return /background-repeat:repeat/.test(shell)
    ? true
    : "the grid does not tile";
});

check("the auth email keeps inline-only styling for Outlook/Gmail", () => {
  const shell = notifier.slice(
    notifier.indexOf("def _auth_email_shell"),
    notifier.indexOf("def _cta_button")
  );
  if (!shell) return "cannot locate _auth_email_shell";
  if (/<!--\[if mso\]>/.test(shell) !== true) {
    return "no Outlook conditional comments — rgba borders will vanish";
  }
  if (!/role="presentation"/.test(shell)) {
    return "layout is not table-based";
  }
  // A <style> block in <head> is stripped by Gmail and ignored by Outlook.
  // A <style> block is fine ONLY inside an <!--[if mso]--> conditional, which
  // Outlook consumes and every other client discards. A bare <style> in <head>
  // is what Gmail strips, so allow the tag only when it is conditional-wrapped.
  const styleTags = shell.match(/<style>/g) || [];
  if (styleTags.length > 0) {
    const conditional = /<!--\[if mso\]>\s*<style>/.test(shell);
    if (!conditional) {
      return "the shell depends on a bare <style> block, which Gmail strips";
    }
  }
  return true;
});

check("the OTP pill is copy-ready and high-contrast", () => {
  // NOT prose-stripped here: the pill markup lives inside an f-string body, and
  // stripProse removes triple-quoted strings wholesale — which would delete the
  // very markup being asserted. Match on the constant NAMES instead.
  const send = notifier.slice(
    notifier.indexOf("def send_otp_email"),
    notifier.indexOf("def send_verification_email")
  );
  if (!send) return "cannot locate send_otp_email";
  const has = (needle, msg) => (send.includes(needle) ? true : msg);
  // The constants must actually be defined, or referencing them is meaningless.
  const defined = (name) =>
    new RegExp(`${name}\\s*=\\s*_svg_data_uri\\(|${name}\\s*=\\s*"`).test(notifier);
  return [
    defined("_EMAIL_PILL_BG") ? true : "_EMAIL_PILL_BG is not defined",
    has("{_EMAIL_PILL_BG}", "the pill does not use the elevated pill background"),
    has("letter-spacing:12px", "the digits are not letter-spaced for legibility"),
    defined("_EMAIL_MONO") ? true : "_EMAIL_MONO is not defined",
    has("{_EMAIL_MONO}", "the code is not monospaced"),
    has("{_EMAIL_CLIP_URI}", "no clipboard cue beside the digits"),
    has("color:{_EMAIL_HEADING}", "the code is not high-contrast against the pill"),
    has("text-align:center", "the pill is not centred"),
  ].find((r) => r !== true) || true;
});

check("auth email footer carries the trust line", () =>
  /Secured by ResultApp/.test(notifier) && /Automated school portal verification/.test(notifier)
    ? true
    : "the footer trust line is missing"
);

check("a failed OTP send does not burn the resend cooldown", () => {
  // Regression guard for a debugging trap: _cooldown_ok() reserves the window
  // BEFORE the mail is attempted, so a Brevo outage made every retry inside the
  // cooldown return a neutral 200 "sent" for an email that never existed.
  if (!/def _release_cooldown/.test(router)) {
    return "there is no _release_cooldown() helper";
  }
  if (!/pop\(key, None\)/.test(router)) {
    return "_release_cooldown does not actually clear the reservation";
  }
  const fn = router.slice(
    router.indexOf("def request_email_otp"),
    router.indexOf("def verify_email_otp")
  );
  if (!fn) return "cannot locate request_email_otp";
  // The release must sit on the not-delivered path, before the raise.
  const fail = fn.indexOf("if not delivered:");
  const rel = fn.indexOf("_release_cooldown(");
  const raiseAt = fn.indexOf("HTTPException", fail);
  if (fail === -1) return "the send path has no failure branch";
  if (rel === -1) return "a failed send never releases the cooldown";
  return rel < raiseAt
    ? true
    : "the cooldown is released after the error is raised — the retry is still blocked";
});

check("a successful OTP send keeps its cooldown (anti-abuse intact)", () => {
  const fn = router.slice(
    router.indexOf("def request_email_otp"),
    router.indexOf("def verify_email_otp")
  );
  if (!fn) return "cannot locate request_email_otp";
  // LAST return _OTP_SENT is the success exit. The first two are earlier exits
  // (cooldown-hit, rate-limited) whose tails would include the failure branch
  // and make this check fire spuriously.
  const successAt = fn.lastIndexOf("return _OTP_SENT");
  if (successAt === -1) return "cannot locate the success return";
  const beforeSuccess = fn.slice(0, successAt);
  const releases = (beforeSuccess.match(/_release_cooldown\(/g) || []).length;
  return releases === 1
    ? true
    : `expected exactly one cooldown release before the success return, found ${releases}`;
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
console.log("Auth flow verified: hashed single-use tokens, no enumeration, soft login, honest dev mode.\n");
