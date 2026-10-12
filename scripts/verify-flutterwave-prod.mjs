#!/usr/bin/env node
/**
 * Flutterwave production-readiness regression.
 *
 * Every check here guards a failure that is INVISIBLE until money is involved.
 * A missing public key, a test key serving real tenants, or a webhook that
 * verifies but does nothing all present as a perfectly normal-looking payment
 * screen. None of them produce an error until a school is charged and nothing
 * ships.
 *
 * The bias is toward asserting the ABSENCE of a bad state (no test literal in
 * source, no alias chain, no silent fallback) rather than the presence of a
 * good one, because the bad states are the ones that ship.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p) => {
  const f = join(ROOT, p);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = "") => {
  if (ok) { pass++; results.push({ ok: true, name }); }
  else { fail++; results.push({ ok: false, name, detail }); }
};

const fw = read("lib/flutterwave.ts");
const registerForm = read("components/forms/RegisterSchoolForm.tsx");
const billingCheckout = read("components/billing/BillingCheckout.tsx");
const webhook = read("app/api/flutterwave/webhook/route.ts");
const cryptoLib = read("lib/pendingRegistrationCrypto.ts");
const pendingLib = read("lib/pendingRegistrations.ts");
const holdRoute = read("app/api/register-school/hold/route.ts");
const freeCreditsRoute = read("app/api/admin/config/free-credits/route.ts");
const pricing = read("lib/pricing.ts");

/** Every .ts/.tsx under app, components, lib — for "no bad literal anywhere". */
function sourceFiles(dir, acc = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) sourceFiles(rel, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(rel);
  }
  return acc;
}
const allSource = sourceFiles("app")
  .concat(sourceFiles("components"))
  .concat(sourceFiles("lib"))
  .map((p) => ({ p, s: read(p) }));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ===========================================================================
// 1. CANONICAL ENV NAMES — exactly one per setting
// ===========================================================================
{
  const code = stripComments(fw);
  // Aliases that must not appear in CODE (prose about them is fine and wanted).
  const deadAliases = [
    "FLW_SECRET_KEY",
    "FLW_SECRET_HASH",
    "FLW_WEBHOOK_HASH",
    "NEXT_PUBLIC_FLW_PUBLIC_KEY",
    "NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY_TEST",
  ];
  for (const a of deadAliases) {
    const live = code.includes(a);
    check(
      `env alias ${a} is gone from lib/flutterwave.ts code`,
      !live,
      live ? "still read as a fallback" : ""
    );
  }
  // And across the whole tree, so a new file cannot reintroduce one.
  for (const a of deadAliases) {
    const offenders = allSource
      .map((f) => ({ p: f.p, s: stripComments(f.s) }))
      .filter((f) => f.s.includes(a));
    check(
      `env alias ${a} appears in no source file`,
      offenders.length === 0,
      offenders.map((o) => o.p).join(", ")
    );
  }

  check(
    "secret key reads FLUTTERWAVE_SECRET_KEY only",
    /process\.env\.FLUTTERWAVE_SECRET_KEY/.test(code),
  );
  check(
    "public key reads NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY only",
    /process\.env\.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY/.test(code),
  );
  check(
    "webhook hash reads FLUTTERWAVE_WEBHOOK_SECRET_HASH only",
    /process\.env\.FLUTTERWAVE_WEBHOOK_SECRET_HASH/.test(code),
  );
}

// ===========================================================================
// 2. NO TEST KEY MAY REACH A REAL TENANT
// ===========================================================================
{
  const dummy = allSource.filter((f) => stripComments(f.s).includes("dummy-key"));
  check(
    "no FLWPUBK_TEST dummy fallback exists anywhere",
    dummy.length === 0,
    dummy.map((d) => d.p).join(", ")
  );

  // A hardcoded FLWPUBK_TEST- literal in shipped code is always a bug now.
  const literal = allSource
    .map((f) => ({ p: f.p, s: f.s }))
    .filter((f) => /["']FLWPUBK_TEST-[A-Za-z0-9]/.test(f.s) || /["']FLWSECK_TEST-[A-Za-z0-9]/.test(f.s));
  check(
    "no hardcoded FLWPUBK_TEST-/FLWSECK_TEST- literal in source",
    literal.length === 0,
    literal.map((l) => l.p).join(", ")
  );

  check(
    "registering school uses the live key and never a demo key",
    /getFlutterwavePublicKey\(\)/.test(registerForm) &&
      !/getPublicKeyForTenant/.test(registerForm),
    "registration is always a real tenant"
  );
  check(
    "billing selects the key by the demo flag",
    /getPublicKeyForTenant\(\{\s*isDemo\s*\}\)/.test(billingCheckout),
  );
  check(
    "demo key is a SEPARATE variable, not a fallback of the live one",
    /NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY/.test(fw) &&
      /if \(opts\?\.isDemo\)/.test(fw),
    "a fallback is the exact failure being removed"
  );
}

// ===========================================================================
// 3. FAIL CLOSED — a missing key is a loud error, never a silent mode
// ===========================================================================
{
  check(
    "getFlutterwavePublicKey throws when unset",
    /function getFlutterwavePublicKey[\s\S]{0,400}?throw new Error/.test(stripComments(fw)),
  );
  check(
    "getSecretKey throws when unset",
    /function getSecretKey[\s\S]{0,400}?throw new Error/.test(stripComments(fw)),
  );
  check(
    "demo key resolver throws rather than borrowing the live key",
    /NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY[\s\S]{0,400}?throw new Error/.test(stripComments(fw)),
  );
  // The wizard must not be able to open a modal with an unresolved key.
  check(
    "wizard resolves the key inside try/catch and aborts on failure",
    /getFlutterwavePublicKey\(\);[\s\S]{0,200}?catch/.test(registerForm),
  );
  check(
    "wizard never passes a fallback into the checkout config",
    /publicKey:\s*publicKey\s*\|\|/.test(registerForm) === false,
  );
  check(
    "billing resolves the key inside try/catch and aborts on failure",
    /getPublicKeyForTenant[\s\S]{0,300}?catch/.test(billingCheckout),
  );
}

// ===========================================================================
// 4. WEBHOOK VERIFICATION
// ===========================================================================
{
  const code = stripComments(webhook);
  check(
    "webhook verifies BEFORE parsing the body",
    /verifyWebhookSignature[\s\S]*await req\.json\(\)/.test(code),
    "an unauthenticated caller must not reach the parser"
  );
  check("webhook rejects unsigned requests with 401", /status:\s*401/.test(code));
  check(
    "webhook uses the shared signature helper",
    /verifyWebhookSignature/.test(webhook),
  );
  check(
    "signature comparison is constant-time",
    /crypto\.timingSafeEqual/.test(fw),
  );
  check(
    "timingSafeEqual is guarded by a length check",
    /a\.length\s*!==\s*b\.length[\s\S]{0,80}timingSafeEqual/.test(stripComments(fw)),
    "timingSafeEqual throws on a length mismatch and the header length is attacker-controlled"
  );
  check(
    "a MISSING webhook hash refuses rather than allowing",
    /!secretHash[\s\S]{0,300}?return false/.test(stripComments(fw)),
    "the old code returned NODE_ENV !== production, accepting every webhook in dev"
  );
  check(
    "webhook does not read a non-canonical hash env var",
    !/FLUTTERWAVE_WEBHOOK_HASH/.test(code),
  );
  check(
    "webhook only acts on charge.completed",
    /PROVISIONING_EVENT\s*=\s*"charge\.completed"/.test(webhook),
  );
  check(
    "webhook requires status === successful",
    /status\s*!==\s*"successful"/.test(code),
  );
  check(
    "webhook restricts tx_ref to our own registration pattern",
    /resultapp_\[a-z0-9-\]/.test(code),
    "a school could attach an arbitrary tx_ref to their own payment"
  );
}

// ===========================================================================
// 5. WEBHOOK PROVISIONING — the paid-but-never-shipped gap
// ===========================================================================
{
  const code = stripComments(webhook);
  check("webhook provisions from the hold", /provisionHeldRegistration/.test(webhook));
  check(
    "provisioning runs the SHARED implementation, not a parallel one",
    /provisionHeldRegistration\(txRef,\s*\{\s*source:\s*"webhook"\s*\}\)/.test(webhook),
  );
  check(
    "webhook always acknowledges with 200 once verified",
    (code.match(/status:\s*200/g) || []).length >= 3,
    "a non-2provokes retries of un-actionable events"
  );
  check(
    "an expired hold is logged as needing manual intervention",
    /expired[\s\S]{0,400}?manual provisioning required/.test(code),
    "PAID with no hold is the one case that needs a human"
  );

  // Idempotency.
  const p = stripComments(pendingLib);
  check("provisioning claims the hold atomically", /pending-registrations\/claim/.test(p));
  check(
    "a 409 from claim is treated as already-done, not failure",
    /409[\s\S]{0,200}?already_done/.test(p),
  );
  check(
    "a 409 from provision is treated as already-done",
    /provRes\.status\s*===\s*409[\s\S]{0,200}?already_done/.test(p),
    "a taken subdomain IS the other path finishing"
  );
  check(
    "a failed provision RELEASES the claim so a retry can proceed",
    /pending-registrations\/release/.test(p),
    "otherwise a transient outage strands a paid customer permanently"
  );
  check(
    "payment is re-verified against Flutterwave, not trusted from the payload",
    /verifyTransaction/.test(p),
  );
  check(
    "amount floor is enforced server-side",
    /charged\s*<\s*expected/.test(p),
  );
  check(
    "currency is checked",
    /currency/i.test(p) && /NGN/.test(p),
  );
}

// ===========================================================================
// 6. PASSWORD NEVER REACHES FLUTTERWAVE
// ===========================================================================
{
  check(
    "hold endpoint exists",
    holdRoute.length > 0 && /export async function POST/.test(holdRoute),
  );
  check(
    "hold endpoint does not echo the payload back",
    /tx_ref:\s*txRef/.test(holdRoute) && !/payload:\s*payload/.test(holdRoute),
  );
  // Compare against the CALL, not the import — `initiateFlutterwaveInlinePayment`
  // appears in the import block far earlier in the file, so a naive indexOf
  // reports the checkout opening first and the assertion fails for the wrong
  // reason.
  const holdAt = registerForm.indexOf("await holdRegistration");
  const openAt = registerForm.indexOf("const openModal = ()");
  check(
    "wizard holds BEFORE opening checkout",
    holdAt > 0 && openAt > 0 && holdAt < openAt,
    `hold@${holdAt} openModal@${openAt}`
  );
  check(
    "the admin password is still absent from the checkout meta",
    !/meta:[\s\S]{0,600}?admin_password/.test(registerForm),
    "meta is retained by Flutterwave — this is a remediated P0"
  );
  check("pending payload encrypts the password", /encryptSecret\(admin_password\)/.test(pendingLib));
  check(
    "decryption failure yields null, never an empty password",
    /decryptSecret[\s\S]{0,200}?return null/.test(cryptoLib),
    "provisioning with an empty password creates a school nobody can sign in to"
  );
  check(
    "a dedicated key is required, not SESSION_SECRET",
    /PENDING_REGISTRATION_SECRET/.test(cryptoLib) &&
      !/process\.env\.SESSION_SECRET/.test(cryptoLib),
    "reusing it merges 'forge a session' and 'read a parked password' into one surface"
  );
  check(
    "crypto fails loudly when its key is missing",
    /PENDING_REGISTRATION_SECRET is not set/.test(cryptoLib) &&
      /function getKey[\s\S]{0,400}?throw new Error/.test(stripComments(cryptoLib)),
  );
  check(
    "ciphertext is version-tagged",
    /enc:v1/.test(cryptoLib),
    "a future key change must not misread old rows"
  );
}

// ===========================================================================
// 7. MINIMUM 10 SLOTS — parity across all three layers
// ===========================================================================
{
  check("MIN_REGISTRATION_STUDENTS = 10 in lib/pricing.ts", /MIN_REGISTRATION_STUDENTS\s*=\s*10/.test(pricing));
  check("wizard enforces the floor", /count\s*<\s*MIN_REGISTRATION_STUDENTS/.test(registerForm));
  check(
    "wizard Pay button is disabled below the floor",
    /payDisabled[\s\S]{0,120}?orderCount\s*<\s*MIN_REGISTRATION_STUDENTS/.test(registerForm),
    "an enabled button for a typed-in 5 means paying, then being refused"
  );
  check(
    "wizard dev-mock button also gated",
    /disabled=\{isSubmitting\s*\|\|\s*orderCount\s*<\s*MIN_REGISTRATION_STUDENTS\}/.test(registerForm),
  );
  check(
    "proxy enforces the floor",
    /studentCount\s*<\s*MIN_REGISTRATION_STUDENTS/.test(read("app/api/register-school/route.ts")),
  );
  check(
    "hold endpoint enforces the floor",
    /student_count\s*<\s*10/.test(holdRoute),
  );
  const mainPy = read("backend/main.py");
  check(
    "FastAPI enforces ge=10",
    /student_count:\s*int\s*=\s*Field\(\.\.\.,\s*ge=MIN_REGISTRATION_STUDENTS/.test(mainPy),
  );
  check(
    "FastAPI defines MIN_REGISTRATION_STUDENTS = 10",
    /MIN_REGISTRATION_STUDENTS\s*=\s*10/.test(mainPy),
  );
  check(
    "the floor is documented as registration-only",
    /REGISTRATION ONLY/.test(pricing) && /REGISTRATION ONLY/.test(mainPy),
    "applying it to top-ups would block a school buying one extra seat"
  );
  // Top-ups must still accept 1.
  const creditsPy = read("backend/routers/credits.py");
  check(
    "slot top-ups keep a floor of 1",
    /slot_count:\s*Optional\[int\]\s*=\s*Field\(None,\s*gt=0/.test(creditsPy) &&
      !/slot_count[\s\S]{0,80}?ge=10/.test(creditsPy),
  );
}

// ===========================================================================
// 8. FREE-CREDITS TOGGLE REACHES THE UI
// ===========================================================================
{
  check(
    "free-credits GET is open (registration is pre-account)",
    /export async function GET\(\)\s*\{\s*(?!\s*const guard = await requireSuperadmin)/.test(freeCreditsRoute),
  );
  check(
    "free-credits PUT stays superadmin-guarded",
    /requireSuperadmin/.test(freeCreditsRoute) &&
      /export async function PUT[\s\S]{0,200}?requireSuperadmin/.test(freeCreditsRoute),
    "reading policy is not changing it"
  );
  check(
    "wizard fetches the toggle with no-store",
    /api\/admin\/config\/free-credits["'\s,]*\s*\{?\s*cache:\s*"no-store"/.test(registerForm) ||
      /cache:\s*"no-store"[\s\S]{0,120}?free-credits/.test(registerForm),
  );
  check(
    "toggle defaults to true so a failed fetch preserves today's behaviour",
    /useState\(true\)/.test(registerForm.slice(registerForm.indexOf("freeCreditsEnabled") - 300, registerForm.indexOf("freeCreditsEnabled") + 200)),
  );
  check(
    "only an explicit boolean false hides the offer",
    /typeof\s+\w+\.enabled\s*===\s*"boolean"/.test(registerForm),
    "a malformed response must not read as 'disabled'"
  );
  // The important one: the card must UNMOUNT, not just swap copy.
  check(
    "Step 2 card is wrapped in the toggle, not merely restyled",
    /\{freeCreditsEnabled\s*\?\s*\(\s*<div[\s\S]{0,200}?rounded-xl border/.test(registerForm.replace(/\s+/g, " ")),
  );
  check(
    "Step 3 footnote is wrapped in the toggle",
    /\{freeCreditsEnabled\s*\?\s*\(\s*<p/.test(registerForm.replace(/\s+/g, " ")),
  );
  check(
    "the qualifying flag also honours the toggle",
    /freeCreditsEnabled\s*&&\s*orderCount\s*>=\s*FREE_CREDIT_MIN_STUDENTS/.test(registerForm),
  );
}

// ===========================================================================
// 9. MONEY IS NEVER TRUSTED FROM THE CLIENT
// ===========================================================================
{
  const regRoute = read("app/api/register-school/route.ts");
  check(
    "registration recomputes the expected amount server-side",
    /calculateTieredTotal\(/.test(regRoute),
  );
  check(
    "registration enforces a paid >= expected floor",
    /paid\s*<\s*expectedAmount/.test(regRoute),
  );
  for (const p of ["app/api/billing/slots/route.ts", "app/api/billing/credits/route.ts"]) {
    const s = read(p);
    check(
      `${p} recomputes the expected amount`,
      /calculateTieredTotal\(|calculateCreditTotal\(/.test(s),
    );
    check(`${p} enforces a paid >= expected floor`, /paid\s*<\s*expected/.test(s));
  }
  check(
    "mock payment verification stays behind NODE_ENV",
    allSource
      .map((f) => stripComments(f.s))
      .filter((s) => /allowMock/.test(s))
      .every((s) => /NODE_ENV\s*!==\s*"production"/.test(s)),
    "a real payment must never be short-circuited by an unset key"
  );
}

// ===========================================================================
const pad = (s, n) => String(s).padEnd(n, " ");
console.log("=".repeat(78));
console.log("  FLUTTERWAVE PRODUCTION READINESS");
console.log("=".repeat(78));
for (const r of results) {
  if (r.ok) console.log(`  PASS  ${pad(r.name, 70)}`);
  else console.log(`  FAIL  ${pad(r.name, 70)} ${r.detail}`);
}
console.log("=".repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
console.log("=".repeat(78));
process.exit(fail ? 1 : 0);
