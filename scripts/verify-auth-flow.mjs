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
  if (!/EMAIL_OTP_MAX_ATTEMPTS/.test(db)) return "no per-code attempt cap";
  if (!/attempts = attempts \+ 1/.test(db)) return "a wrong guess does not spend an attempt";
  return true;
});

check("OTP verify is rate limited", () =>
  /rate_limit\.check\(/.test(router)
    ? true
    : "no throttle on the verify endpoint — 1e6 candidates is guessable"
);

check("OTP generation is throttled and cooldown-gated", () =>
  /_cooldown_ok\(`otp:/.test(router) && /otp-send:/.test(router)
    ? true
    : "generation is unbounded — a caller could mail-bomb an address"
);

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

check("no raw OTP is ever logged", () => {
  const send = notifier.slice(
    notifier.indexOf("def send_otp_email"),
    notifier.indexOf("def send_verification_email")
  );
  if (!send) return "cannot locate send_otp_email";
  // A log line carrying the code would make the journal a second delivery path.
  const logged = /logger\.(info|warning|error|debug)\([^)]*\bcode\b/i.test(
    send.replace(/logger\.(error|warning)\("\/EMAIL-AUTH"\] refusing to send a malformed OTP[\s\S]*?\)/, "")
  );
  return !logged ? true : "a log statement appears to include the code";
});

check("OTP email builds no link (so PUBLIC_BASE_URL cannot break it)", () => {
  const send = notifier.slice(
    notifier.indexOf("def send_otp_email"),
    notifier.indexOf("def send_verification_email")
  );
  if (!send) return "cannot locate send_otp_email";
  return !/public_base_url\(\)/.test(send) && !/href=/.test(send)
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
  const m = step3.match(/disabled=\{([^}]*)\}/);
  if (!m) return "no disabled binding on the payment button";
  const expr = m[1];
  return /payBlockedByTerms/.test(expr) && /payBlockedByEmail/.test(expr)
    ? true
    : `the payment gate is "${expr}" — it must require both flags`;
});

check("the disabled payment button explains itself", () =>
  /payHint/.test(register)
    ? true
    : "a dead button with no reason shown — unblocks are impossible for the user"
);

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
  // The backend returns an honest 502 when Brevo failed. If the proxy swallowed
  // it, a broken mail config would look identical to "sent, check your inbox".
  const both = otpSend + otpVerify;
  return /if \(!res\.ok\)/.test(both)
    ? true
    : "a proxy ignores non-200 responses, hiding mail failures";
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
console.log("Auth flow verified: hashed single-use tokens, no enumeration, soft login, honest dev mode.\n");
