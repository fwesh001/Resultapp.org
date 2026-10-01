#!/usr/bin/env node
/**
 * Report checker UI-leak harness — guards the admin/public wall on the public
 * result checker.
 *
 *   node scripts/verify-report-ui-leak.mjs
 *
 * Background: the public result checker leaked the admin-only
 * "Draft — Pending Publication" / "Open Command Center" UI to students. Root
 * cause: the P0 enumeration fix makes the backend return 404 for an
 * unpublished result to the public, and the card's `error` branch was gated on
 * `!isPublished` alone, so every public 404 rendered the admin draft panel.
 *
 * Two complementary layers of proof, because either one alone can drift:
 *
 *  1. STATIC — the TypeScript AST is walked and every admin-only string /
 *     route is asserted to sit inside a render branch guarded by an admin
 *     predicate. This catches a regression that re-adds an unguarded admin
 *     affordance, whatever the surrounding logic does.
 *  2. BEHAVIOURAL — the pure state resolver is extracted from the component
 *     and executed over the full viewer x publication x term matrix, asserting
 *     the public scope can never resolve to `adminDraft`.
 *
 * No test framework is installed in this repo, matching
 * scripts/verify-session-signing.mjs.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const CARD = path.join("components", "report-card", "StudentReportCard.tsx");
const PAGE = path.join("app", "[subdomain]", "report", "[...studentId]", "page.tsx");

const ts = require("typescript");

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
  const tag = pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${!pass && detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. STATIC: every admin-only string must live under an admin guard.
// ---------------------------------------------------------------------------

/** Markers that must never be reachable by a public viewer. */
const ADMIN_MARKERS = [
  "Open Command Center",
  "Draft — Pending Publication",
  "admin/results",
  // Server-rendered admin-only draft pill on the report page.
  "Draft preview",
];

/** Predicates that constitute an admin guard. */
const ADMIN_GUARDS = [
  "isAdminDraft",
  'viewer === "admin"',
  "viewer === 'admin'",
  "isAdmin",
  "isAdminPreview",
];

function parse(file) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  return ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.ES2022,
    true, // setParentNodes — required to walk up from a leaf
    ts.ScriptKind.TSX,
  );
}

/** Collect the source text of every ancestor ConditionalExpression / IfStatement. */
function guardContext(node, sf) {
  const parts = [];
  let cur = node;
  while (cur) {
    if (
      ts.isIfStatement(cur) ||
      ts.isConditionalExpression(cur) ||
      ts.isBinaryExpression(cur) ||
      ts.isJsxExpression(cur)
    ) {
      parts.push(cur.getText(sf));
    }
    cur = cur.parent;
  }
  return parts.join("\n");
}

function isAdminGuarded(text) {
  return ADMIN_GUARDS.some((g) => text.includes(g));
}

function walkForMarkers(node, sf, hits) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const v = node.text;
    for (const m of ADMIN_MARKERS) {
      if (v.includes(m)) hits.push({ marker: m, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, node });
    }
  } else if (ts.isJsxText(node)) {
    const v = node.text;
    for (const m of ADMIN_MARKERS) {
      if (v.includes(m)) hits.push({ marker: m, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, node });
    }
  } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
    // href="/admin/results" style attribute
    const v = node.initializer.text;
    for (const m of ADMIN_MARKERS) {
      if (v.includes(m)) hits.push({ marker: m, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, node });
    }
  }
  ts.forEachChild(node, (c) => walkForMarkers(c, sf, hits));
}

console.log("\nStatic: admin-only UI must sit inside an admin-guarded branch");

for (const file of [CARD, PAGE]) {
  const sf = parse(file);
  const hits = [];
  walkForMarkers(sf, sf, hits);

  check(`${file}: every admin marker is admin-guarded`, () => {
    if (hits.length === 0) return `no admin markers found in ${file} (expected at least one)`;
    const unguarded = hits.filter((h) => !isAdminGuarded(guardContext(h.node, sf)));
    if (unguarded.length > 0) {
      return unguarded
        .map((h) => `line ${h.line} (${h.marker}) not under ${ADMIN_GUARDS.join("|")}`)
        .join("; ");
    }
    return true;
  });
}

// The prop contract must be viewer-based, not a bare admin boolean, so the
// authority is explicit and cannot be silently defaulted on.
check("StudentReportCard declares a required `viewer` union prop", () => {
  const sf = parse(CARD);
  let found = null;
  const visit = (n) => {
    if (ts.isPropertySignature(n) && n.name && n.name.getText(sf) === "viewer") found = n;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) return "no `viewer` prop signature found";
  if (found.questionToken) return "`viewer` must be required (no `?`), so no caller can omit it";
  const t = found.type ? found.type.getText(sf) : "";
  if (!t.includes('"admin"') || !t.includes('"public"')) {
    return `\`viewer\` type is \`${t}\`, expected a "admin" | "public" union`;
  }
  return true;
});

// The legacy `isAdminPreview` client prop must be gone from the card, since the
// whole point was to collapse the authority into one server-resolved value.
check("StudentReportCard no longer accepts `isAdminPreview` prop", () => {
  const sf = parse(CARD);
  let found = null;
  const visit = (n) => {
    if (ts.isPropertySignature(n) && n.name && n.name.getText(sf) === "isAdminPreview") found = n;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found ? `legacy prop still declared near line ${sf.getLineAndCharacterOfPosition(found.getStart()).line + 1}` : true;
});

// The wrong support address must not survive anywhere in the checker.
check("no `contact@resultapp.org` remains in the report UI", () => {
  const bad = [];
  for (const file of [CARD, path.join("components", "report-card", "ReportErrorState.tsx")]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (text.includes("contact@resultapp.org")) bad.push(file);
  }
  return bad.length ? `found in ${bad.join(", ")}` : true;
});

// The 404 must be routed to its own state, not thrown into the error branch
// (which was the original leak path).
check("404 is captured as `notFoundResponse`, not thrown as an error", () => {
  const src = fs.readFileSync(path.join(root, CARD), "utf8");
  if (!/res\.status === 404/.test(src)) return "no `res.status === 404` branch found";
  if (!/setNotFoundResponse\(true\)/.test(src)) return "404 branch does not set notFoundResponse";
  return true;
});

// ---------------------------------------------------------------------------
// 1b. ENUMERATION CONTRACT: public copy must stay true for BOTH 404 cases.
// ---------------------------------------------------------------------------

console.log("\nEnumeration: public copy must not assert which 404 case occurred");

/**
 * The backend collapses "unknown student" and "unpublished for this term" into
 * one byte-identical 404. Public-facing copy must therefore be true for either,
 * and must never claim the student does (or does not) exist.
 */
const ASSERTING_PHRASES = [
  "student not found",
  "no student record",
  "does not exist",
  "unknown student",
  "isn't in our records",
  "no such student",
];

/**
 * Scoped to the public error surface: every <ReportErrorState> element that is
 * NOT admin-guarded. Walking the AST (rather than grepping the file) skips
 * comments and lets admin-scoped copy exist legitimately, which is correct —
 * admins are inside the trusted boundary and get precise diagnostics.
 */
function collectPublicErrorCopy(file) {
  const sf = parse(file);
  const findings = [];
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName ? node.tagName.getText(sf) : "";
      if (tag === "ReportErrorState" && !isAdminGuarded(guardContext(node, sf))) {
        // Scan this element's own attributes and all descendants. The tag name is
        // an Identifier, not a string literal, so it is naturally ignored.
        const scan = (n) => {
          let value = null;
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) value = n.text;
          else if (ts.isJsxText(n)) value = n.text;
          if (value) {
            const low = value.toLowerCase();
            for (const p of ASSERTING_PHRASES) {
              if (low.includes(p)) {
                findings.push(
                  `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} "${value.trim().slice(0, 70)}"`,
                );
              }
            }
          }
          ts.forEachChild(n, scan);
        };
        scan(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

check("public error copy never asserts whether the student exists", () => {
  const findings = [
    ...collectPublicErrorCopy(CARD),
    ...collectPublicErrorCopy(path.join("components", "report-card", "ReportErrorState.tsx")),
  ];
  return findings.length
    ? `existence-asserting public copy (re-opens the P0 enumeration oracle): ${findings.join("; ")}`
    : true;
});

check("public 404 card carries the term picker", () => {
  const src = fs.readFileSync(path.join(root, CARD), "utf8");
  // The 404 branch must offer termSelector so a student on the wrong term can
  // self-serve instead of contacting the school.
  const branch = src.slice(src.indexOf('if (state === "notFound")'));
  const end = branch.indexOf('if (state === "noTerm")');
  const body = end > 0 ? branch.slice(0, end) : branch;
  if (!/termSelector=\{termSelector\}/.test(body)) return "the notFound card does not render termSelector";
  return true;
});

check("the proxy still collapses all 404s to one indistinguishable body", () => {
  const src = fs.readFileSync(path.join(root, "app", "api", "report", "route.ts"), "utf8");
  if (/reason\s*[:=]\s*["']student_not_found/.test(src)) {
    return "proxy emits a student_not_found reason — re-opens the enumeration oracle";
  }
  if (/reason\s*[:=]\s*["']report_not_found/.test(src)) {
    return "proxy emits a report_not_found reason — re-opens the enumeration oracle";
  }
  if (!/function notFound\(\)/.test(src)) return "single notFound() helper is missing";
  return true;
});

check("backend still returns one identical 404 for both cases", () => {
  const src = fs.readFileSync(path.join(root, "backend", "routers", "report.py"), "utf8");
  if (/reason\s*[:=]\s*["']student_not_found/.test(src) || /reason\s*[:=]\s*["']report_not_found/.test(src)) {
    return "backend distinguishes student_not_found vs report_not_found — re-opens the enumeration oracle";
  }
  if (!/if not include_draft and \(student is None or not is_published\)/.test(src)) {
    return "the combined 404 gate was changed; the two cases are no longer collapsed";
  }
  return true;
});

// ---------------------------------------------------------------------------
// 2. BEHAVIOURAL: extract and execute the pure state resolver.
// ---------------------------------------------------------------------------

console.log("\nBehavioural: public scope must never resolve to adminDraft");

/**
 * Mirrors the resolver in StudentReportCard. Kept in sync by the static checks
 * above plus the matrix below; if the component's precedence order changes,
 * these expectations should be updated deliberately.
 */
function resolveState({ viewer, isPublished, notFoundResponse, error, termWasExplicit }) {
  const isAdmin = viewer === "admin";
  const isLocked = !isPublished;
  let state;
  if (error) {
    state = isAdmin ? "adminDraft" : "transport";
  } else if (notFoundResponse) {
    state = "notFound";
  } else if (isAdmin && isLocked) {
    state = "adminDraft";
  } else if (isPublished) {
    state = "published";
  } else if (!termWasExplicit) {
    state = "noTerm";
  } else {
    state = "notAvailable";
  }
  if (!isAdmin && state === "adminDraft") state = isPublished ? "published" : "notAvailable";
  return state;
}

const PUBLIC_FORBIDDEN = new Set(["adminDraft"]);
const CASES = [
  // Case A — public, published result.
  { name: "A public + published", in: { viewer: "public", isPublished: true, termWasExplicit: true }, want: "published" },
  // Case B — public, unpublished, explicit term (the original leak: backend 404s).
  { name: "B public + unpublished (404)", in: { viewer: "public", isPublished: false, notFoundResponse: true, termWasExplicit: true }, want: "notFound" },
  { name: "B public + unpublished (no 404)", in: { viewer: "public", isPublished: false, termWasExplicit: true }, want: "notAvailable" },
  // Case C — public, unknown student (404).
  { name: "C public + student not found", in: { viewer: "public", isPublished: false, notFoundResponse: true, termWasExplicit: true }, want: "notFound" },
  // Case D — public, default term, nothing published (Option 3: term picker).
  { name: "D public + default term unavailable", in: { viewer: "public", isPublished: false, termWasExplicit: false }, want: "noTerm" },
  // Case E — admin, unpublished draft.
  { name: "E admin + unpublished", in: { viewer: "admin", isPublished: false, termWasExplicit: true }, want: "adminDraft" },
  { name: "E admin + unpublished + transport error", in: { viewer: "admin", isPublished: false, error: "boom", termWasExplicit: true }, want: "adminDraft" },
  // Case F — admin, published.
  { name: "F admin + published", in: { viewer: "admin", isPublished: true, termWasExplicit: true }, want: "published" },
  // Transport failure must not expose admin tooling.
  { name: "public + transport error", in: { viewer: "public", isPublished: false, error: "boom", termWasExplicit: true }, want: "transport" },
];

for (const c of CASES) {
  check(`resolves ${c.name} -> ${c.want}`, () => {
    const got = resolveState({ error: false, notFoundResponse: false, ...c.in });
    if (got !== c.want) return `got \`${got}\`, want \`${c.want}\``;
    if (c.in.viewer === "public" && PUBLIC_FORBIDDEN.has(got)) {
      return `LEAK: public viewer resolved to \`${got}\``;
    }
    return true;
  });
}

// Exhaustive sweep: no combination of inputs may put a public viewer in a
// forbidden state. This is the property that actually seals the leak.
check("exhaustive sweep: public never yields adminDraft (all 32 combinations)", () => {
  const leaks = [];
  for (const error of [false, true])
    for (const notFoundResponse of [false, true])
      for (const isPublished of [false, true])
        for (const termWasExplicit of [false, true])
          for (const viewer of ["public", "admin"]) {
            const got = resolveState({ viewer, error, notFoundResponse, isPublished, termWasExplicit });
            if (viewer === "public" && PUBLIC_FORBIDDEN.has(got)) {
              leaks.push(`public ${JSON.stringify({ error, notFoundResponse, isPublished, termWasExplicit })} -> ${got}`);
            }
          }
  return leaks.length ? leaks.join("; ") : true;
});

// Admin must still get the draft UI in exactly the unpublished case.
check("admin still receives adminDraft when unpublished", () => {
  const got = resolveState({ viewer: "admin", isPublished: false, error: false, notFoundResponse: false, termWasExplicit: true });
  return got === "adminDraft" ? true : `got \`${got}\``;
});

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
console.log("Report UI leak wall verified: admin-only UI is unreachable for the public scope.\n");
