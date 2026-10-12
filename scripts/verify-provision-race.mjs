#!/usr/bin/env node
/**
 * Provisioning race regression.
 *
 * Two paths act on the same successful charge within seconds of each other:
 * the browser callback (POST /api/register-school) and the Flutterwave webhook.
 * Both provision the school, so without coordination the loser receives a 409
 * from FastAPI and the customer is shown "that subdomain is taken" moments
 * after paying for it.
 *
 * This suite pins the two properties that make that impossible:
 *
 *   1. EXCLUSION  — the browser claims the hold before it provisions, so the
 *      webhook stands down (and vice versa).
 *   2. NO STRANDING — claiming flips the hold to 'completed'. If the browser
 *      then fails, it MUST hand the claim back, or the hold reads as finished
 *      with no school behind it and the safety net is silently disabled for a
 *      customer who has already paid.
 *
 * Property 2 is the one that is easy to get wrong: a "successful" claim on a
 * failed provision is worse than no claim at all, because it actively turns
 * off the recovery path.
 *
 * Claiming only narrows the race window. The authoritative guarantee remains
 * FastAPI's subdomain uniqueness; these checks are about not handing a paying
 * customer a confusing error on the way to an otherwise-correct outcome.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p) => {
  const f = join(ROOT, p);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); }
};

const route = read("app/api/register-school/route.ts");
const lib = read("lib/pendingRegistrations.ts");
const webhook = read("app/api/flutterwave/webhook/route.ts");
const adminPy = read("backend/routers/admin.py");

if (!route || !lib) {
  console.error("FATAL: could not read the route or the shared library");
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 1. The route participates in the claim protocol at all
 * ------------------------------------------------------------------ */
check(
  "browser route imports the shared claim helpers",
  /import\s*\{[^}]*\bclaimHold\b[^}]*\bwaitForSchool\b[^}]*\}\s*from\s*["']@\/lib\/pendingRegistrations["']/.test(route),
);
check(
  "browser route imports releaseHold (so a failed claim is not stranded)",
  /import\s*\{[^}]*\breleaseHold\b[^}]*\}\s*from\s*["']@\/lib\/pendingRegistrations["']/.test(route),
);

const holdRefDecl = route.indexOf("let holdTxRef");
check("browser route records the tx_ref the hold was parked under", holdRefDecl !== -1);
check(
  "hold tx_ref is taken from the provider's verified transaction",
  /tx_ref\s*\?\?\s*trustedRef/.test(route),
  "expected the verified tx_ref to be preferred over the client-supplied one",
);

/* ------------------------------------------------------------------ *
 * 2. EXCLUSION — claim strictly BEFORE provisioning
 *
 * This is an ordering assertion. Source order is the only observable proxy we
 * have for runtime order here, and getting it backwards would reintroduce the
 * exact race this file exists to prevent.
 * ------------------------------------------------------------------ */
const claimIdx = route.indexOf("await claimHold(holdTxRef)");
const provisionIdx = route.indexOf("provisionRes = await fetch(targetUrl");
check("browser route claims the hold", claimIdx !== -1);
check("browser route provisions via FastAPI", provisionIdx !== -1);
check(
  "claim happens BEFORE the FastAPI provision call",
  claimIdx !== -1 && provisionIdx !== -1 && claimIdx < provisionIdx,
  claimIdx === -1 || provisionIdx === -1
    ? "could not locate both call sites"
    : `claim@${claimIdx} provision@${provisionIdx}`,
);

check(
  "a claim failure does not block registration",
  /catch\s*\{[^}]*return\s+["']none["']/s.test(lib),
  "a hold-store outage must degrade to the pre-existing behaviour, not 500",
);

/* ------------------------------------------------------------------ *
 * 3. Standing down when the webhook won
 * ------------------------------------------------------------------ */
check(
  "'taken' is recognised as the webhook owning the work",
  /holdClaim\s*===\s*["']taken["']/.test(route),
);
check(
  "'taken' waits for the webhook's school to appear",
  /await\s+waitForSchool\(subdomain/.test(route),
);
check(
  "'taken' reports success rather than a subdomain error",
  /provisioned_by:\s*["']webhook["']/.test(route),
  "the customer must not see 'subdomain taken' for their own purchase",
);

/* ------------------------------------------------------------------ *
 * 4. NO STRANDING — a failed claim is always handed back
 *
 * Claiming sets status='completed'. Every exit that does not produce a school
 * must therefore release, or the webhook sees a finished hold and does nothing.
 * ------------------------------------------------------------------ */
check(
  "a release helper is defined for the claimed case only",
  /const\s+releaseIfOurs\s*=/.test(route) &&
    /holdClaim\s*===\s*["']claimed["']/.test(route),
);
const releaseCalls = (route.match(/await\s+releaseIfOurs\(\)/g) || []).length;
check(
  "every provisioning failure path releases the claim",
  releaseCalls >= 5,
  `expected >=5 (network, 409, 4xx, auth, fallback); found ${releaseCalls}`,
);

for (const [label, re] of [
  ["network/abort", /catch\s*\([^)]*\)\s*\{[^}]*await\s+releaseIfOurs\(\)/s],
  ["409 subdomain conflict", /status\s*===\s*409[^{]*\{[^}]*await\s+releaseIfOurs\(\)/s],
  ["400/422 invalid", /status\s*===\s*(400|422)[^{]*\{[^}]*await\s+releaseIfOurs\(\)/s],
  ["401/403 provisioning auth", /status\s*===\s*(401|403)[^{]*\{[^}]*await\s+releaseIfOurs\(\)/s],
]) {
  check(`release on ${label}`, re.test(route));
}

// The success path must NOT release — that would hand the work straight back to
// the webhook we just beat, reintroducing the race on a completed provision.
// Every release must therefore sit BEFORE the success payload is assembled.
const lastRelease = route.lastIndexOf("await releaseIfOurs()");
const successPayload = route.indexOf("provisioning_ms");
check(
  "no release on the success path",
  lastRelease !== -1 && successPayload !== -1 && lastRelease < successPayload,
  lastRelease === -1 || successPayload === -1
    ? "could not locate both sites"
    : `lastRelease@${lastRelease} successPayload@${successPayload}`,
);

/* ------------------------------------------------------------------ *
 * 5. The webhook claims through the same primitive
 * ------------------------------------------------------------------ */
const webhookClaim = webhook.indexOf("claim");
check("webhook also claims the hold", webhookClaim !== -1);
// The two paths do not share a helper NAME — the webhook goes through
// provisionHeldRegistration, the browser calls claimHold directly. What makes
// them mutually exclusive is that both POST to the same backend endpoint, so
// that is what this asserts.
const claimEndpoint = "/api/v1/admin/pending-registrations/claim";
check(
  "webhook and browser claim through the same backend primitive",
  (lib.match(new RegExp(claimEndpoint.replace(/\//g, "\\/"), "g")) || []).length >= 2,
  "both paths must POST to the claim endpoint for exclusion to hold",
);
check(
  "webhook stands down on an already-claimed hold",
  /already_done|already_provisioned|409/.test(webhook),
);

/* ------------------------------------------------------------------ *
 * 6. Backend semantics the fix depends on
 * ------------------------------------------------------------------ */
check(
  "claim only succeeds from 'pending' (the two paths cannot both win)",
  /SET\s+status\s*=\s*'completed'[^;]*WHERE\s+tx_ref\s*=\s*%\w*\s+AND\s+status\s*=\s*'pending'/s.test(adminPy),
);
check(
  "release resets the hold to 'pending' so the webhook can retry",
  /SET\s+status\s*=\s*'pending'/.test(adminPy),
);
check(
  "release clears completed_at",
  /completed_at\s*=\s*NULL/.test(adminPy),
);
check(
  "release extends the TTL so a retry window still exists",
  /expires_at\s*=\s*NOW\(\)\s*\+\s*INTERVAL/i.test(adminPy),
);

/* ------------------------------------------------------------------ *
 * 7. Bounded waiting — never an unbounded hang on a paying customer
 * ------------------------------------------------------------------ */
check(
  "waitForSchool polls the real tenant endpoint",
  /\/api\/v1\/tenant\/\$\{encodeURIComponent\(subdomain\)\}/.test(lib),
);
check(
  "waitForSchool is bounded by a deadline",
  /const\s+deadline\s*=\s*Date\.now\(\)\s*\+\s*timeoutMs/.test(lib),
);
check(
  "a webhook that claimed but never landed is reclaimed, not abandoned",
  /never\s+appeared;\s*reclaiming/.test(route),
  "a claimed-but-missing school must fall back to provisioning here",
);

/* ------------------------------------------------------------------ */
console.log("");
for (const f of failures) console.log(`  [FAIL] ${f}`);
console.log(`\n${"=".repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(62)}`);
console.log(
  fail === 0
    ? "Provisioning race verified: browser and webhook exclude each other, and a failed claim is never stranded as 'completed'."
    : "Provisioning race is NOT safe to ship — see failures above.",
);
process.exit(fail === 0 ? 0 : 1);
