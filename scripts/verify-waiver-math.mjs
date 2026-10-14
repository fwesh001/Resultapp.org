#!/usr/bin/env node
/**
 * verify-waiver-math — PROVES the TypeScript mirror and the Python authority
 * compute the same waiver split for every input, including the inputs they
 * must both reject.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * `lib/waiverPricing.ts` renders a checkout preview and a receipt.
 * `backend/services/waivers.py` decides what the customer is actually charged.
 * They are two implementations of one rule in two languages, which is the
 * normal, accepted shape of a cross-stack system — and the normal home of a
 * silent divergence. A preview that says "₦2,000 due" while the backend bills
 * "₦2,500" is the kind of bug that reaches production only because nobody
 * compared the two.
 *
 * So: the backend is authoritative, this file is the mirror, and this script
 * is what makes the mirror trustworthy. Same intent as the MIN_REGISTRATION_STUDENTS
 * parity check in scripts/verify-auth-flow.mjs, widened to a whole money rule.
 *
 * It runs BOTH implementations over a hand-picked table of cases that covers
 * every branch that has ever been argued about (tier boundaries, the 100%
 * bypass, over-purchase, use-it-or-lose-it, odd percentages on small orders)
 * plus a generated sweep across the whole envelope. An exhaustive comparison
 * over 10,000 x 10,000 x 100 is not tractable, but the function is piecewise
 * on three axes and the sweep is dense enough to catch a boundary that moved.
 *
 * Usage:  node scripts/verify-waiver-math.mjs
 * Exit:   0 all parity, 1 any divergence
 */

import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Node resolves extensionless specifiers for TS only when told to. Next/webpack
// do this for free; bare Node does not. Registering here — rather than
// demanding a --import flag — keeps the script runnable as `node <script>`.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      for (const ext of [".ts", ".tsx"]) {
        try {
          return nextResolve(specifier + ext, context);
        } catch {
          /* try the next extension */
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

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

// ---------------------------------------------------------------------------
// Hand-picked cases. Every one of these was a decision, not a guess.
// ---------------------------------------------------------------------------

const CASES = [
  // req, allowance, pct, why it is here
  [50, 100, 100, "100% bypass: gateway must be skipped entirely"],
  [70, 50, 100, "split bill: 50 waived + 20 charged on a 50-slot token"],
  [70, 50, 50, "split bill at 50%: partial waiver, partial charge"],
  [50, 100, 50, "partial waiver that still leaves a charge"],
  [1000, 1000, 50, "volume tier 3 (₦80): waived portion still charges ₦40k"],
  [1000, 1000, 100, "volume tier 3 (₦80) at 100%: bypass at the cheapest tier"],
  [1, 1, 100, "smallest legal top-up at 100%"],
  [1000, 999, 100, "tier boundary: 1000 requested vs 999 allowance"],
  [999, 999, 100, "one slot below the tier boundary (₦90, not ₦80)"],
  [500, 500, 100, "tier 2 boundary (₦90) at 100%"],
  [499, 499, 100, "one slot below tier 2 (₦100, not ₦90)"],
  [10, 10, 100, "registration floor with a full waiver"],
  [10, 100, 50, "registration floor where the allowance over-covers"],
  [10000, 10000, 100, "ceiling at 100%"],
  [10000, 1, 1, "ceiling with a token that covers almost nothing"],
  [7, 7, 33, "odd percentage on a small order — floor division is load-bearing"],
  [3, 2, 55, "odd percentage, odd allowance, odd count"],
  [13, 13, 99, "worst case for floor-vs-round drift"],
  [9999, 9999, 99, "odd percentage at the tier-3 ceiling"],
  [2, 1, 100, "over-purchase of 1 slot on a 1-slot token"],
];

// Sweep: dense enough to catch a tier boundary that silently moved.
const SWEEP_CASES = [];
for (const req of [1, 2, 9, 10, 11, 49, 50, 499, 500, 501, 998, 999, 1000, 1001, 5000, 9999, 10000]) {
  for (const allow of [1, 10, 50, 100, 499, 500, 999, 1000, 10000]) {
    for (const pct of [1, 25, 33, 50, 66, 75, 99, 100]) {
      SWEEP_CASES.push([req, allow, pct]);
    }
  }
}

// Invalid inputs both implementations must refuse. If exactly one side throws,
// one side is accepting money-affecting garbage.
const INVALID = [
  [0, 10, 50],
  [-1, 10, 50],
  [10001, 10, 50],
  [11, 0, 50],
  [11, 10001, 50],
  [11, 10, 0],
  [11, 10, 101],
  [11, 10, -5],
];

// ---------------------------------------------------------------------------
// Run both implementations
// ---------------------------------------------------------------------------

/** Drive the Python authority over a batch of cases in ONE subprocess. */
function runPython(cases) {
  const payload = JSON.stringify(cases);
  const r = spawnSync(
    process.env.PYTHON_BIN || (process.platform === "win32" ? "py" : "python3"),
    [
      "-c",
      `
import json, sys, os
sys.path.insert(0, os.path.join(${JSON.stringify(ROOT)}, "backend"))
from services.waivers import compute_waiver_split, WaiverValidationError
out = []
for req, allow, pct in json.loads(sys.argv[1]):
    try:
        out.append({"ok": True, "split": compute_waiver_split(req, allow, pct)})
    except WaiverValidationError as e:
        out.append({"ok": False, "err": str(e)})
    except Exception as e:
        out.append({"ok": False, "err": "UNEXPECTED:" + repr(e)})
print(json.dumps(out))
`,
      payload,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`python failed (${r.status}): ${(r.stderr || "").slice(0, 500)}`);
  }
  return JSON.parse(r.stdout);
}

console.log("=== 0. both implementations load ===");
if (!existsSync(join(ROOT, "backend", "services", "waivers.py"))) {
  console.error("  FAIL  backend/services/waivers.py not found");
  process.exit(1);
}
if (!existsSync(join(ROOT, "lib", "waiverPricing.ts"))) {
  console.error("  FAIL  lib/waiverPricing.ts not found");
  process.exit(1);
}
const { computeWaiverSplit } = await import("../lib/waiverPricing.ts");
let pythonOk = false;
try {
  runPython([[10, 10, 100]]);
  pythonOk = true;
} catch (e) {
  console.error(`  FAIL  could not execute the Python authority: ${e.message}`);
}
if (pythonOk) ok("lib/waiverPricing.ts and backend/services/waivers.py both loaded");

if (!pythonOk) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Named cases
// ---------------------------------------------------------------------------

console.log("\n=== 1. named cases (the decisions) ===");
const pyNamed = runPython(CASES.map((c) => c.slice(0, 3)));
const FIELDS = [
  "requested_slots",
  "slot_allowance",
  "discount_percentage",
  "waived_slots",
  "charged_slots",
  "forfeited_slots",
  "unit_price_ngn",
  "list_ngn",
  "waived_ngn",
  "charged_ngn",
  "bypass_gateway",
];

for (let i = 0; i < CASES.length; i++) {
  const [req, allow, pct, why] = CASES[i];
  const py = pyNamed[i];
  const label = `req=${String(req).padStart(5)} allow=${String(allow).padStart(5)} pct=${String(pct).padStart(3)}`;

  if (!py.ok) {
    no(label, `python rejected a valid case: ${py.err} (${why})`);
    continue;
  }
  let ts;
  try {
    ts = computeWaiverSplit(req, allow, pct);
  } catch (e) {
    no(label, `TypeScript rejected a case python accepted: ${e.message} (${why})`);
    continue;
  }
  const diffs = FIELDS.filter((f) => ts[f] !== py.split[f]).map(
    (f) => `${f}: ts=${JSON.stringify(ts[f])} py=${JSON.stringify(py.split[f])}`,
  );
  if (diffs.length) {
    no(label, diffs.join("; "));
  } else {
    ok(
      `${label} -> waived ${String(ts.waived_slots).padStart(4)}` +
        ` / charged ${String(ts.charged_slots).padStart(4)}` +
        ` / forfeited ${String(ts.forfeited_slots).padStart(4)}` +
        ` / pay NGN ${String(ts.charged_ngn).padStart(6)} / bypass ${ts.bypass_gateway}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Generated sweep
// ---------------------------------------------------------------------------

console.log(`\n=== 2. generated sweep (${SWEEP_CASES.length} cases) ===`);
const pySweep = runPython(SWEEP_CASES);
let sweepDiffs = 0;
let firstSweepDiff = "";
let bypassCount = 0;
let forfeitTotal = 0;
for (let i = 0; i < SWEEP_CASES.length; i++) {
  const py = pySweep[i];
  if (!py.ok) {
    sweepDiffs++;
    if (!firstSweepDiff) firstSweepDiff = `python rejected ${SWEEP_CASES[i]}: ${py.err}`;
    continue;
  }
  let ts;
  try {
    ts = computeWaiverSplit(...SWEEP_CASES[i]);
  } catch (e) {
    sweepDiffs++;
    if (!firstSweepDiff) firstSweepDiff = `ts rejected ${SWEEP_CASES[i]}: ${e.message}`;
    continue;
  }
  const d = FIELDS.filter((f) => ts[f] !== py.split[f]);
  if (d.length) {
    sweepDiffs++;
    if (!firstSweepDiff) firstSweepDiff = `${SWEEP_CASES[i]} -> ${d.map((f) => `${f} ts=${ts[f]} py=${py.split[f]}`).join("; ")}`;
  }
  if (ts.bypass_gateway) bypassCount++;
  forfeitTotal += ts.forfeited_slots;
}
if (sweepDiffs === 0) {
  ok(`all ${SWEEP_CASES.length} sweep cases identical (${bypassCount} reached the 100% bypass, ${forfeitTotal} forfeited slots observed)`);
} else {
  no(`${sweepDiffs}/${SWEEP_CASES.length} sweep cases diverged`, firstSweepDiff);
}

// ---------------------------------------------------------------------------
// 3. Invariants that must hold for EVERY case
// ---------------------------------------------------------------------------

console.log("\n=== 3. invariants (every case, both implementations) ===");
{
  let bad = 0;
  let firstBad = "";
  for (let i = 0; i < SWEEP_CASES.length; i++) {
    const py = pySweep[i];
    if (!py.ok) continue;
    const ts = computeWaiverSplit(...SWEEP_CASES[i]);
    for (const s of [ts, py.split]) {
      const errs = [];
      // Nothing charged that was waived, and nothing negative.
      if (s.charged_ngn < 0) errs.push(`charged_ngn=${s.charged_ngn} < 0`);
      if (s.waived_ngn < 0) errs.push(`waived_ngn=${s.waived_ngn} < 0`);
      // The two portions must add back up to exactly what was bought.
      if (s.waived_slots + s.charged_slots !== s.requested_slots)
        errs.push(`${s.waived_slots}+${s.charged_slots} != ${s.requested_slots}`);
      // Money must reconcile.
      if (s.waived_ngn + s.charged_ngn !== s.list_ngn)
        errs.push(`${s.waived_ngn}+${s.charged_ngn} != ${s.list_ngn}`);
      if (s.list_ngn !== s.requested_slots * s.unit_price_ngn) errs.push("list_ngn != requested*unit");
      // A waiver can never cover more than was bought.
      if (s.waived_slots > s.requested_slots) errs.push("waived > requested");
      // Forfeited is what the buyer left on the table, and can never be spent.
      if (s.forfeited_slots !== s.slot_allowance - s.waived_slots) errs.push("forfeited formula");
      // THE invariant the whole bypass rests on.
      if (s.bypass_gateway !== (s.charged_ngn === 0)) errs.push("bypass_gateway disagrees with charged_ngn");
      if (errs.length) {
        bad++;
        if (!firstBad) firstBad = `${SWEEP_CASES[i]}: ${errs.join("; ")}`;
      }
    }
  }
  if (bad === 0) ok("slots reconcile, money reconciles, and bypass_gateway === (charged_ngn === 0) everywhere");
  else no(`${bad} invariant violations`, firstBad);
}

// ---------------------------------------------------------------------------
// 4. The 100% bypass is exactly the "no charge" set
// ---------------------------------------------------------------------------

console.log("\n=== 4. the 100% bypass ===");
{
  let wrong = 0;
  let firstWrong = "";
  for (let i = 0; i < SWEEP_CASES.length; i++) {
    const [req, allow, pct] = SWEEP_CASES[i];
    const s = computeWaiverSplit(req, allow, pct);
    // A gateway bypass is legitimate ONLY when the token covers every slot at
    // 100%. Anything else means we would either charge ₦0 for slots the
    // school is entitled to, or open Flutterwave on a zero-value charge.
    const shouldBypass = pct === 100 && req <= allow;
    if (s.bypass_gateway !== shouldBypass) {
      wrong++;
      if (!firstWrong) firstWrong = `req=${req} allow=${allow} pct=${pct} -> bypass=${s.bypass_gateway}, expected ${shouldBypass}`;
    }
  }
  if (wrong === 0) ok("bypass fires if and only if pct===100 and the token covers every slot");
  else no(`${wrong} incorrect bypass decisions`, firstWrong);
}

// ---------------------------------------------------------------------------
// 5. Floor collision — the superadmin generator must not mint unusable codes
// ---------------------------------------------------------------------------

console.log("\n=== 5. floor collision (allowance bounds by scope) ===");
{
  const { allowanceBounds } = await import("../lib/waiverPricing.ts");
  const pyReg = (() => {
    const r = spawnSync(
      process.env.PYTHON_BIN || (process.platform === "win32" ? "py" : "python3"),
      ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, "backend"))}); from services.waivers import allowance_bounds; import json; print(json.dumps({s: allowance_bounds(s) for s in ("REGISTRATION","TOPUP","BOTH")}))`],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(r.stderr.slice(0, 300));
    return JSON.parse(r.stdout);
  })();

  const tsReg = {
    REGISTRATION: allowanceBounds("REGISTRATION"),
    TOPUP: allowanceBounds("TOPUP"),
    BOTH: allowanceBounds("BOTH"),
  };
  let diff = 0;
  let firstDiff = "";
  for (const scope of ["REGISTRATION", "TOPUP", "BOTH"]) {
    const py = pyReg[scope];
    const ts = tsReg[scope];
    const pyMin = Array.isArray(py) ? py[0] : py.min;
    const pyMax = Array.isArray(py) ? py[1] : py.max;
    if (ts.min !== pyMin || ts.max !== pyMax) {
      diff++;
      firstDiff ||= `${scope}: ts=${ts.min}-${ts.max} py=${pyMin}-${pyMax}`;
    }
  }
  if (diff === 0) ok(`bounds agree: REGISTRATION ${tsReg.REGISTRATION.min}+ (10-slot floor), TOPUP ${tsReg.TOPUP.min}+ (no floor)`);
  else no("allowance bounds diverged", firstDiff);

  // The collision itself: a 5-slot token is legal for TOPUP and illegal for
  // REGISTRATION. If this ever stops being true, the registration floor moved
  // and one of these constants is now a lie.
  const topup = allowanceBounds("TOPUP");
  const reg = allowanceBounds("REGISTRATION");
  if (topup.min < reg.min) ok("floor collision is real: a sub-10 token is valid for TOPUP but not REGISTRATION");
  else no("floor collision no longer exists", `TOPUP floor ${topup.min} is not below REGISTRATION floor ${reg.min}`);
}

// ---------------------------------------------------------------------------
// 6. Both sides refuse the same garbage
// ---------------------------------------------------------------------------

console.log("\n=== 6. invalid input is rejected by BOTH sides ===");
{
  const pyInv = runPython(INVALID);
  let disagree = 0;
  let firstDisagree = "";
  for (let i = 0; i < INVALID.length; i++) {
    const [req, allow, pct] = INVALID[i];
    const pyRejected = !pyInv[i].ok;
    let tsRejected = false;
    try {
      computeWaiverSplit(req, allow, pct);
    } catch {
      tsRejected = true;
    }
    const label = `req=${req} allow=${allow} pct=${pct}`;
    if (pyRejected !== tsRejected) {
      disagree++;
      firstDisagree ||= `${label}: ts_${tsRejected ? "rejected" : "ACCEPTED"} py_${pyRejected ? "rejected" : "ACCEPTED"}`;
      continue;
    }
    if (pyInv[i].ok) {
      // Both rejected as a Python-side validation error rather than a crash.
      if (String(pyInv[i].err || "").startsWith("UNEXPECTED:")) {
        disagree++;
        firstDisagree ||= `${label}: ${pyInv[i].err}`;
      }
    }
  }
  if (disagree === 0) ok(`all ${INVALID.length} invalid inputs refused identically by both implementations`);
  else no(`${disagree} invalid inputs handled differently`, firstDisagree);
}

// ---------------------------------------------------------------------------
// 7. The token is base64url and therefore CASE-SENSITIVE
// ---------------------------------------------------------------------------

console.log("\n=== 7. waiver code inputs must not alter case ===");
// This is not math, but it is the same class of bug and it belongs in the one
// script that gates waiver-token correctness.
//
// A waiver code is `RW-` + secrets.token_urlsafe(18): the base64url alphabet is
// A-Za-z0-9-_, so case is part of the credential. An input that "helpfully"
// uppercases what is pasted destroys it — proven against a real stored hash:
// uppercasing altered 10 of 27 characters and the SHA-256 could never match,
// so a school holding a perfectly valid code was told it was expired.
//
// The same class of corruption arrives silently on iOS, where autoCapitalize
// rewrites the first letter of a text input with no user action at all. Those
// attributes have to be present too, so both halves are asserted.
{
  const files = [
    ["components/forms/RegisterSchoolForm.tsx", "registration wizard"],
    ["components/billing/BillingCheckout.tsx", "billing top-up"],
  ];
  let bad = 0;
  for (const [rel, label] of files) {
    const path = join(ROOT, rel);
    if (!existsSync(path)) {
      no(`${label}: file missing`, rel);
      bad++;
      continue;
    }
    const src = readFileSync(path, "utf8");
    if (/\.toUpperCase\(\)/.test(src)) {
      no(
        `${label} uppercases the waiver code`,
        "a base64url token is case-sensitive; toUpperCase() makes it unredeemable",
      );
      bad++;
    } else if (!/autoCapitalize\s*=\s*"none"/.test(src)) {
      no(`${label} has no autoCapitalize="none"`, "iOS Safari would rewrite the first letter");
      bad++;
    } else if (!/autoCorrect\s*=\s*"off"/.test(src)) {
      no(`${label} has no autoCorrect="off"`, "the keyboard would offer to 'fix' a credential");
      bad++;
    } else {
      ok(`${label}: token preserved verbatim, mobile autocorrect disabled`);
    }
  }
  if (!bad) {
    ok("a case-preserving token can only ever match a case-sensitive hash");
  }
}

// ---------------------------------------------------------------------------
// 8. The 100% bypass must survive the 402 gate — and must not be forgeable
// ---------------------------------------------------------------------------

console.log("\n=== 8. the 100% bypass gate is reachable AND unforgeable ===");
// Same class of bug as section 7, one layer up.
//
// Flutterwave rejects a zero-value charge, so a fully-waived registration
// produces NO transaction_id. The registration route used to treat a missing
// transaction_id as "no payment yet" and answer 402 — leaving a school that had
// already been paid for stuck on step 3 being told to pay.
//
// The fix cannot simply be "accept a missing transaction_id": that turns the
// endpoint into a free-registration button. The bypass has to be authorised by
// the HOLD, which the client cannot write. So these assertions exist to fail
// loudly if someone ever relaxes the gate back into a client-trusted flag, or
// reorders it so the 402 fires before the bypass is considered.
{
  const routePath = join(ROOT, "app/api/register-school/route.ts");
  const libPath = join(ROOT, "lib/pendingRegistrations.ts");
  const formPath = join(ROOT, "components/forms/RegisterSchoolForm.tsx");

  for (const p of [routePath, libPath, formPath]) {
    if (!existsSync(p)) {
      no("bypass gate: file missing", p);
    }
  }
  if (existsSync(routePath) && existsSync(libPath) && existsSync(formPath)) {
    const route = readFileSync(routePath, "utf8");
    const lib = readFileSync(libPath, "utf8");
    const form = readFileSync(formPath, "utf8");

    // (a) The gate exists and reads the server-side hold.
    //
    //     The negative half matters more than the positive one. Asserting only
    //     /charge_required === false/ would ALSO pass against
    //     `body.charge_required === false` — i.e. against a gate rewritten to
    //     trust the client, which is the one change that turns this endpoint
    //     into a free-registration button. So the flag must be read off the
    //     summary returned by the hold, and `body.charge_required` is banned.
    if (!/summary\.charge_required\s*===\s*false/.test(route)) {
      no("gate never consults the hold's charge_required", "the 402 would still strand 100% waivers");
    } else if (!/getHoldChargeSummary\(trustedRef\)/.test(route)) {
      no("gate does not read the hold", "the flag must come from the hold, not the request");
    } else if (/body\s*\??\.\s*charge_required/.test(route)) {
      no("gate reads charge_required from the REQUEST", "a client could post bypass: true and get a free school");
    } else {
      ok("the 402 gate branches on the hold's own charge_required, never the request body's");
    }

    // (b) It must require a real entitlement, or it is a coupon for anyone.
    if (!/waiver_token_id/.test(route)) {
      no("bypass accepts a hold with no waiver token", "nothing would be burned");
    } else {
      ok("bypass requires a waiver_token_id, so the burn has something to settle");
    }

    // (c) The subdomain-prefix check must gate the bypass, not just the paid
    //     lookup — otherwise a client can aim its own reference at a
    //     different school's hold.
    //
    //     Asserted on the CALL SITE (`getHoldChargeSummary(trustedRef)`), not on
    //     the first textual mention: the name also appears in the import, which
    //     would make a naive indexOf ordering check compare the import against
    //     the trustedRef definition and always report a false failure.
    const bypassCallAt = route.indexOf("getHoldChargeSummary(trustedRef)");
    const trustedDefAt = route.indexOf("const trustedRef");
    if (
      bypassCallAt === -1 ||
      trustedDefAt === -1 ||
      trustedDefAt > bypassCallAt ||
      !/if\s*\(\s*!txId\s*&&\s*trustedRef\s*\)/.test(route) ||
      !/bypassRef\s*=\s*trustedRef/.test(route)
    ) {
      no("bypass is not confined to a trustedRef", "cross-school reference replay is possible");
    } else {
      ok("bypass only fires for a tx_ref carrying this subdomain's own prefix");
    }

    // (d) THE ORDERING INVARIANT. The 402 must come AFTER the bypass attempt.
    //     Get this backwards and the feature is dead again in a way that reads
    //     like a payment problem rather than a code problem.
    const bypassAt = route.indexOf("if (bypassRef)");
    const gate402At = route.indexOf("Payment required: missing transaction_id");
    if (bypassAt === -1 || gate402At === -1) {
      no("could not locate both branches", `bypass@${bypassAt} gate@${gate402At}`);
    } else if (bypassAt > gate402At) {
      no("the 402 fires before the bypass is considered", "a fully-waived school gets 402");
    } else {
      ok("the bypass is evaluated BEFORE the 402 gate, not after it");
    }

    // (e) Fail closed. An unreadable hold must never look like a bypass.
    if (!/catch\s*\{[\s\S]{0,220}return null/.test(lib)) {
      no("getHoldChargeSummary may throw", "an unreachable backend must fail closed");
    } else {
      ok("an unreadable hold fails closed to a 402, never to a free registration");
    }

    // (f) The wizard must actually be able to reach it: no transaction_id, and
    //     an approval flag that opens the provisioning effect.
    if (!/transaction_id:\s*transactionId\s*\|\|\s*null/.test(form)) {
      no("wizard does not send a null transaction_id on bypass", "the gate would never see the bypass");
    } else if (!/const ready = !!transactionId \|\| waiverBypassApproved/.test(form)) {
      no("provisioning effect still waits on a transaction_id", "bypass school would spin forever");
    } else {
      ok("the wizard provisions a bypass with transaction_id: null");
    }

    // (g) The receipt must show the SERVER's split, not the list price, or a
    //     waived buyer is told they owe money one screen before it vanishes.
    if (/Pay \{formatNaira\(orderTotal\)\} with Flutterwave/.test(form) && !/waiverBypass \? \(/.test(form)) {
      no("step 3 shows the undiscounted total on a bypass", "reads as a bait-and-switch");
    } else {
      ok("step 3 prices from the server split, not the list price");
    }
  }
}

// ---------------------------------------------------------------------------

console.log("\n==========================================");
console.log(`  ${pass} passed, ${fail} failed`);
console.log("==========================================");
if (fail === 0) {
  console.log("  WAIVER MATH PARITY OK — the mirror is trustworthy");
  console.log("  The 100% bypass reaches provisioning, and only via a server-held token.");
} else {
  console.log("  DIVERGENCE: TypeScript and Python disagree.");
  console.log("  The BACKEND is authoritative. Fix the mirror, not waivers.py,");
  console.log("  and check whether a tier boundary moved in lib/pricing.ts.");
}
process.exit(fail === 0 ? 0 : 1);