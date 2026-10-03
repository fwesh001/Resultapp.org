#!/usr/bin/env node
/**
 * Offline-first grading guard harness.
 *
 *   node scripts/verify-offline-grading.mjs
 *
 * Teachers grade on phones and switch data off to save battery. A tab close, an
 * OS RAM sweep, or a dead connection must never destroy typed scores. These
 * checks lock down the invariants that make that true — each one regressed at
 * least once during development.
 *
 *  1. TERM IN THE DRAFT KEY — the pre-v1 key omitted term, so a Term 2 draft
 *     overwrote Term 1 and restored stale marks.
 *  2. NO SILENT MERGE — drafts must be offered via a prompt, never merged over
 *     server grades behind the teacher's back.
 *  3. DRAFT CLEARED ONLY ON SUCCESS — never in the failure path, because
 *     `navigator.onLine` lies (captive portal / dead upstream) and the catch
 *     block is the only real safety net.
 *  4. OFFLINE SAVE IS A NO-OP WITH REASSURANCE — no doomed API call, and the
 *     teacher is told their work is safe on the device.
 *  5. COVERAGE — all three grading surfaces persist drafts.
 *
 * Plain Node + the TypeScript compiler already present (no test framework),
 * matching verify-report-ui-leak.mjs / verify-vitals-guard.mjs.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const ts = require("typescript");

const HOOK = path.join("lib", "useDraftSave.ts");
const ONLINE = path.join("lib", "useOnlineStatus.ts");
const PROMPT = path.join("components", "ui", "DraftRecoveryPrompt.tsx");
const INDICATOR = path.join("components", "ui", "NetworkIndicator.tsx");

const SURFACES = [
  path.join("app", "[subdomain]", "staff", "(dashboard)", "grading", "page.tsx"),
  path.join("app", "[subdomain]", "staff", "(dashboard)", "grading", "[className]", "[subjectName]", "page.tsx"),
  path.join("app", "[subdomain]", "staff", "(dashboard)", "forms", "[className]", "page.tsx"),
];

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

function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX
  );
}

/** Collect string literals + JSX text via the AST, skipping comments. */
function literals(file) {
  const sf = parse(file);
  const out = [];
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) {
      out.push({ text: n.text, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const hookSrc = fs.readFileSync(path.join(root, HOOK), "utf8");

console.log("\nDraft key: term must be part of the scope (stale-term bug)");

check("useDraftSave requires `term` in its scope", () =>
  /term:\s*string/.test(hookSrc) && /scope\.term/.test(hookSrc)
    ? true
    : "term is not part of the draft scope"
);

check("buildDraftKey includes the encoded term segment", () => {
  const fn = hookSrc.slice(hookSrc.indexOf("export function buildDraftKey"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  if (!/seg\(term\)/.test(body)) return "buildDraftKey does not emit seg(term)";
  return true;
});

check("buildDraftKey refuses an incomplete scope", () =>
  /throw new Error/.test(hookSrc.slice(hookSrc.indexOf("export function buildDraftKey"), hookSrc.indexOf("export function buildDraftKey") + 700))
    ? true
    : "incomplete scope silently produces a shared/empty key"
);

check("a draft whose term disagrees with the scope is never restored", () =>
  /parsed\.term\s*!==\s*scope\.term/.test(hookSrc)
    ? true
    : "a cross-term draft could be restored into the wrong term"
);

console.log("\nLegacy compatibility: pre-v1 drafts must not crash or vanish");

check("readDraft tolerates the legacy bare-object format", () =>
  /Legacy bare object/.test(hookSrc) ? true : "no legacy-format branch in readDraft"
);

check("legacy drafts are flagged so the UI can warn", () =>
  /legacy:\s*true/.test(hookSrc) ? true : "legacy drafts are not flagged"
);

// Only the two academic grading surfaces ever wrote pre-v1 drafts. The forms
// page had NO localStorage before this work, so it has nothing to migrate and
// correctly has no legacy key.
const LEGACY_SURFACES = SURFACES.slice(0, 2);

check("grading surfaces pass their legacy key so old work is still offered", () => {
  const missing = LEGACY_SURFACES.filter((f) => {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    return !/legacyKeys/.test(src);
  });
  return missing.length === 0 ? true : `no legacyKeys in: ${missing.join(", ")}`;
});

console.log("\nRestore is explicit — never a silent merge over server grades");

check("no surface merges a draft straight into form state on load", () => {
  const offenders = [];
  for (const f of SURFACES) {
    const sf = parse(f);
    // A merge would call JSON.parse on a draft and assign it into the drafts
    // state during the fetch/seed step. Flag any direct localStorage.parse.
    const visit = (n) => {
      if (ts.isPropertyAccessExpression(n) && n.name.text === "localStorage") {
        const src = n.getText(sf);
        if (/getItem/.test(src)) offenders.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return offenders.length === 0 ? true : `direct localStorage reads remain: ${offenders.join("; ")}`;
});

check("every surface renders the DraftRecoveryPrompt", () => {
  const missing = SURFACES.filter((f) => !/DraftRecoveryPrompt/.test(fs.readFileSync(path.join(root, f), "utf8")));
  return missing.length === 0 ? true : `missing on: ${missing.join(", ")}`;
});

check("restore filters students who left the roster", () => {
  const missing = SURFACES.filter(
    (f) => !/known\.has\(|applyKnownRoster|!known\.has/.test(fs.readFileSync(path.join(root, f), "utf8")),
  );
  return missing.length === 0 ? true : `no roster filter on: ${missing.join(", ")}`;
});

console.log("\nSave semantics: clear only on success, keep on failure");

check("the catch block never clears the draft", () => {
  const offenders = [];
  for (const f of SURFACES) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    // Isolate each catch block and ensure no draft removal inside it.
    const catches = src.match(/catch\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/g) || [];
    for (const c of catches) {
      if (/clearDraft\(|removeItem\(|clearDraftEntries/.test(c)) {
        offenders.push(`${path.basename(f)}: clear inside catch`);
      }
    }
  }
  return offenders.length === 0 ? true : offenders.join("; ");
});

check("offline save short-circuits before the API call", () => {
  const offenders = [];
  for (const f of SURFACES) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    if (!/isOnline === false/.test(src)) { offenders.push(`${path.basename(f)}: no offline guard`); continue; }
    // The guard must return before the fetch.
    const idx = src.indexOf("isOnline === false");
    const after = src.slice(idx, idx + 400);
    if (!/return;/.test(after)) offenders.push(`${path.basename(f)}: offline guard does not return`);
  }
  return offenders.length === 0 ? true : offenders.join("; ");
});

check("offline save reassures the teacher that work is safe", () => {
  const offenders = [];
  for (const f of SURFACES) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    const idx = src.indexOf("isOnline === false");
    if (idx === -1) continue;
    const after = src.slice(idx, idx + 400);
    if (!/saved on (this|your) device/i.test(after)) {
      offenders.push(`${path.basename(f)}: no reassurance copy`);
    }
  }
  return offenders.length === 0 ? true : offenders.join("; ");
});

// Two legitimate clear sites exist per surface:
//   1. the Discard action (explicit teacher choice — must always be allowed)
//   2. after a confirmed save (res.ok, or a helper that throws on failure)
// Anything else clearing a draft is a bug.
check("draft is cleared only on explicit discard or confirmed success", () => {
  const offenders = [];
  for (const f of SURFACES) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    let idx = 0;
    while ((idx = src.indexOf("clearDraft(", idx)) !== -1) {
      // Context from the enclosing handler start through the call site.
      const window = src.slice(Math.max(0, idx - 1600), idx + 240);
      // (1) Explicit discard — the teacher's own choice, always allowed.
      const isDiscard = /function\s+handleDiscardDraft/.test(window) ||
        /function\s+discardFocused/.test(window) ||
        /function\s+discardAndClose/.test(window);
      // (2) Confirmed success — a checked res.ok, or a helper that throws.
      const afterSuccess = /if\s*\(\s*!res\.ok\s*\)\s*throw/.test(window) ||
        /await\s+persistBehavioural\(/.test(window);
      if (!isDiscard && !afterSuccess) {
        const lineNo = src.slice(0, idx).split("\n").length;
        offenders.push(`${path.basename(f)}:${lineNo}`);
      }
      idx += 10;
    }
  }
  return offenders.length === 0 ? true : `cleared outside discard/success at: ${offenders.join(", ")}`;
});

check("per-student save clears only that student's draft entries", () => {
  const src = fs.readFileSync(path.join(root, SURFACES[2]), "utf8");
  return /clearDraftEntries\?\.\(studentId\)|clearDraftEntries\(studentId\)/.test(src)
    ? true
    : "forms page must prune one student at a time, not the whole draft";
});

console.log("\nCoverage + supporting pieces");

check("all three grading surfaces persist drafts", () => {
  const missing = SURFACES.filter((f) => !/useDraftSave/.test(fs.readFileSync(path.join(root, f), "utf8")));
  return missing.length === 0 ? true : `no draft persistence on: ${missing.join(", ")}`;
});

check("surfaces render the network indicator", () => {
  const missing = SURFACES.filter((f) => !/NetworkIndicator/.test(fs.readFileSync(path.join(root, f), "utf8")));
  return missing.length === 0 ? true : `no indicator on: ${missing.join(", ")}`;
});

check("drafts have a TTL so stale entries expire", () =>
  /export const DRAFT_TTL_MS\s*=/.test(hookSrc) ? true : "no TTL constant — old drafts would live forever"
);

check("expiry is enforced when reading", () =>
  /now\s*-\s*savedAt\s*>\s*DRAFT_TTL_MS/.test(hookSrc)
    ? true
    : "TTL constant exists but is not enforced in readDraft"
);

check("storage failures degrade instead of breaking entry", () =>
  /catch/.test(hookSrc) && /persistenceAvailable/.test(hookSrc)
    ? true
    : "localStorage quota/private-mode failure is not handled"
);

check("navigator.onLine caveat is documented (it is link-layer only)", () => {
  const onlineSrc = fs.readFileSync(path.join(root, ONLINE), "utf8");
  return /link-layer|captive portal/i.test(onlineSrc)
    ? true
    : "the captive-portal limitation is undocumented — callers may over-trust it";
});

check("NetworkIndicator treats null as undetermined, never as offline", () => {
  const src = fs.readFileSync(path.join(root, INDICATOR), "utf8");
  const bad = literals(INDICATOR).filter((l) => /Offline/.test(l.text));
  const offlineAt = src.indexOf("isOnline === false");
  return offlineAt !== -1 || bad.length === 0
    ? true
    : "indicator renders Offline without checking for a false/undefined state";
});

check("restore prompt offers both Restore and Discard", () => {
  const src = fs.readFileSync(path.join(root, PROMPT), "utf8");
  return /onRestore/.test(src) && /onDiscard/.test(src) ? true : "prompt is missing an explicit action";
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
console.log("Offline-first grading verified: term-scoped drafts, explicit restore, safe save semantics.\n");
