#!/usr/bin/env node
/**
 * Theme guard harness.
 *
 *   npm run build && node scripts/verify-theme.mjs
 *
 * THE TOGGLE IS ACTIVE. These checks previously asserted that the app was
 * LOCKED to dark (forcedTheme + an unmounted toggle); they now assert the
 * opposite — that the provider is unlocked, the toggle is reachable, and the
 * token system still resolves in both schemes.
 *
 * What is still worth guarding, because each was a real or near-miss failure:
 *   * `forcedTheme` must not creep back. It disables setTheme globally, so
 *     every mounted <ThemeToggle /> would render and silently do nothing — a
 *     visible control that lies, which is worse than no control.
 *   * A mistyped token like `bg-surface-4` compiles, builds, deploys and passes
 *     tsc while emitting no CSS at all. The built stylesheet is asserted too.
 *
 * The exemptions below are deliberate and must not be "fixed":
 *   - the print report card (paper, not screen)
 *   - the translucent Result Checker card sitting on the Hero image
 *   - `.action-bar-sticky` in globals.css
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

const globals = read("app/globals.css");
const rootLayout = read("app/layout.tsx");
const pkg = JSON.parse(read("package.json"));

const provider = read("components/theme/ThemeProvider.tsx");
const toggle = read("components/theme/ThemeToggle.tsx");
const navbar = read("components/landing/Navbar.tsx");
const adminShell = read("components/admin/AdminShell.tsx");
const staffShell = read("components/staff/StaffShell.tsx");
const superadminShell = read("components/superadmin/SuperadminShell.tsx");
const superadminSidebar = read("components/superadmin/SuperadminSidebar.tsx");
const lifecycleModals = read("components/superadmin/TenantLifecycleModals.tsx");
const kpiCard = read("components/superadmin/KpiCard.tsx");
const adminSidebar = read("components/admin/AdminSidebar.tsx");
const staffSidebar = read("components/staff/StaffSidebar.tsx");
const modal = read("components/ui/Modal.tsx");
const toast = read("components/ui/toast.tsx");
const rowMenu = read("components/ui/RowActionsMenu.tsx");
const bell = read("components/notifications/NotificationBell.tsx");
const button = read("components/ui/Button.tsx");
const input = read("components/ui/Input.tsx");
const uploadField = read("components/ui/UploadField.tsx");
const widget = read("components/landing/ResultLookupWidget.tsx");

// Comment stripping, quote-aware.
//
// The obvious regex -- s.replace(/\/\*[\s\S]*?\*\//g, "") -- is UNSAFE here.
// UploadField contains accept=".startsWith(\"/*\")", and the regex reads that
// string literal as a comment opener: it then ran 5,652 characters forward to
// the next `*/`, deleting the entire component body. Every check that greps
// such a file was silently starved of the code it was supposed to read, and
// still reported PASS. That is the same failure as a guard that never fires,
// and it is why this helper has its own guard below.
//
// The apostrophe rule is the standard heuristic: a `'` only opens a string when
// it follows something that can precede an expression. A bare `'` in JSX text
// ("Don't") must not, or it swallows the rest of the file.
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      if (c === "\\") { out += c + (d || ""); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i += 1; continue;
    }
    if (c === '"' || c === "`") { quote = c; out += c; i += 1; continue; }
    if (c === "'") {
      const prev = out.replace(/\s+$/, "").slice(-1);
      if (prev === "" || "=([{,;:?&|+!~".includes(prev)) {
        quote = c; out += c; i += 1; continue;
      }
      out += c; i += 1; continue;
    }
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    out += c; i += 1;
  }
  return out;
}
const norm = (p) => p.replace(/\\/g, "/");

// The helper itself is load-bearing for ~40 checks below, so it gets checked.
check(
  "stripComments does not eat code containing a \"/*\" string literal",
  (() => {
    // The probe MUST contain a real block comment AFTER the literal, or the
    // naive regex finds no closing "*/", matches nothing, and passes while
    // still being broken. That is exactly how this guard would have shipped
    // green over the bug it exists to catch.
    const probe =
      'const ok = a.startsWith("/*");\nconst real = "bg-surface-3";\n/* later comment */\n';
    const s = stripComments(probe);
    // The literal must SURVIVE (it is code, not a comment opener), the code
    // after it must survive, and the real block comment must go.
    return s.includes('startsWith("/*")') && s.includes("bg-surface-3") && !s.includes("later comment");
  })(),
  "a comment stripper that deletes code makes every downstream check vacuous"
);
check(
  "stripComments still removes block comments",
  (() => {
    const s = stripComments('/* bg-purple-900 */\nconst x = "bg-surface-3";');
    return !s.includes("bg-purple-900") && s.includes("bg-surface-3");
  })()
);
check(
  "stripComments leaves an apostrophe in prose alone",
  (() => {
    const s = stripComments("<p>Don't panic, bg-surface-3</p>");
    return s.includes("bg-surface-3");
  })(),
  "an apostrophe in JSX text must not open a string that swallows the file"
);

// ===================== 1. CLASS-BASED DARK VARIANT =========================
check(
  "dark variant is re-pointed at a .dark class",
  /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/.test(globals),
  "without this, dark: follows the OS and the toggle cannot control anything"
);
check(
  "no leftover prefers-color-scheme dark block",
  !/@media \(prefers-color-scheme: dark\)/.test(globals),
  "this would fight the provider: OS dark would override the chosen theme"
);
check("next-themes is a declared dependency", !!(pkg.dependencies || {})["next-themes"]);
check("provider uses attribute=class", /attribute="class"/.test(provider));

// ===================== 2. THE PROVIDER IS UNLOCKED =========================
const providerCode = stripComments(provider);
check(
  "provider does NOT force a theme",
  !/forcedTheme/.test(providerCode),
  "forcedTheme disables setTheme: every mounted <ThemeToggle /> becomes a button that does nothing"
);
check("provider defaults to system", /defaultTheme="system"/.test(provider));
check(
  "provider follows the OS preference",
  /enableSystem\b/.test(providerCode),
  "without enableSystem, defaultTheme=system has nothing to read"
);
check(
  "the theme is persisted under a stable storage key",
  /storageKey="resultapp-theme"/.test(provider),
  "without it next-themes uses its default key and a returning user silently loses the choice"
);
check("theme transitions are disabled on swap", /disableTransitionOnChange/.test(provider));

// ===================== 3. THE TOGGLE IS MOUNTED ============================
// Walking the tree rather than grepping a known list: the failure this catches
// is a toggle that exists, imports cleanly, and is reachable from nowhere.
const rendered = [];
const walk = (p) => {
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".tsx")) {
      const src = stripComments(readFileSync(full, "utf8"));
      if (src.includes("<ThemeToggle")) rendered.push(norm(full.replace(root + "\\", "").replace(root + "/", "")));
    }
  }
};
for (const base of ["app", "components"]) {
  if (existsSync(join(root, base))) walk(join(root, base));
}
check(
  "the toggle is rendered on at least one surface",
  rendered.length > 0,
  "the provider is unlocked but nothing lets a user reach it"
);
for (const [name, src] of [
  ["landing Navbar", navbar],
  ["AdminShell", adminShell],
  ["StaffShell", staffShell],
  ["SuperadminShell", superadminShell],
]) {
  check(`${name} mounts the theme toggle`, /<ThemeToggle/.test(stripComments(src)));
  check(`${name} imports ThemeToggle`, /import ThemeToggle/.test(stripComments(src)));
}
check(
  "the Command Center reaches the toggle at BOTH breakpoints",
  // Count, not a regex over "md:flex": the sidebar's own wrapper also uses
  // md:flex, so a proximity match is satisfied by markup that leaves the
  // toggle mobile-only. Two mounts = mobile bar + desktop header.
  (stripComments(superadminShell).match(/<ThemeToggle/g) || []).length >= 2,
  "the toggle was removed from one breakpoint, where it is unreachable"
);
check(
  "ThemeToggle guards its own hydration",
  /if \(!mounted\)/.test(toggle),
  "reading resolvedTheme on first render is a hydration mismatch"
);
check(
  "ThemeToggle actually calls setTheme",
  /setTheme\(isDark \? "light" : "dark"\)/.test(toggle),
  "a toggle that renders but never sets is the forcedTheme failure in disguise"
);

// ===================== 4. TOKENS IN BOTH SCHEMES ===========================
const TOKEN_NAMES = [
  "surface-0", "surface-1", "surface-2", "surface-3",
  "text-1", "text-2", "text-3",
  "line-1", "line-2",
  "accent", "accent-hover", "accent-fg", "accent-soft",
  "danger", "danger-soft",
  "success", "success-soft",
  "warning", "warning-soft",
];
const rootBlock = globals.slice(globals.indexOf(":root {"), globals.indexOf(".dark {"));
const darkBlock = globals.slice(globals.indexOf(".dark {"), globals.indexOf("@theme inline"));

for (const t of TOKEN_NAMES) {
  check(
    `token --${t} defined in light (:root)`,
    rootBlock.includes(`--${t}:`),
    "missing from :root means the light theme renders it empty"
  );
  check(
    `token --${t} defined in dark (.dark)`,
    new RegExp(`--${t}:`).test(darkBlock),
    "missing from .dark means the dark theme renders it empty"
  );
}
check(
  "light and dark differ for the page background",
  /--surface-0:\s*#0b0514/.test(darkBlock) && !/--surface-0:\s*#0b0514/.test(rootBlock)
);
for (const alias of ["--color-surface-0", "--color-surface-1", "--color-text-1", "--color-line-1", "--color-accent"]) {
  check(`token alias ${alias} is exposed to Tailwind`, globals.includes(`${alias}: var(`));
}
check(
  "color-scheme is declared for light",
  /color-scheme:\s*light/.test(globals),
  "without it a light page still paints a dark scrollbar and dark form controls"
);
check("color-scheme is declared for dark", /color-scheme:\s*dark/.test(globals));

// ===================== 5. NO HYDRATION FLASH ================================
check(
  "<html> suppresses hydration warnings",
  /<html[\s\S]{0,400}suppressHydrationWarning/.test(rootLayout),
  "next-themes sets the class before React hydrates; without this React logs a mismatch every load"
);
check("root layout mounts ThemeProvider", /<ThemeProvider>/.test(rootLayout));
check(
  "Toaster is inside the provider",
  /<ThemeProvider>[\s\S]{0,400}<Toaster \/>/.test(rootLayout),
  "a toast rendered outside the provider cannot read the resolved theme"
);

// ===================== 6. EXEMPTIONS PRESERVED =============================
// Each of these is a deliberate exception. If one disappears it is a real
// regression; a NEW one must be justified here rather than added inline.
const widgetSrc = stripComments(widget);
check(
  "Result Checker card is translucent (not an opaque token)",
  /bg-black\/40/.test(widgetSrc) && !/rounded-2xl[^\n]*bg-surface-1/.test(widgetSrc),
  "an opaque surface hides the Hero image behind it"
);
check("Result Checker keeps its backdrop blur", /backdrop-blur/.test(widgetSrc));
check(
  "Result Checker inputs are dark recessed wells, not light tokens",
  /bg-\[#0B0514\]/.test(widgetSrc),
  "an input must stay opaque so typed text never overlaps the Hero"
);
check(
  "the report card still forces a white print surface",
  /print:bg-white/.test(read("app/[subdomain]/report/[...studentId]/page.tsx"))
);
check(
  "the report card is not tokenized",
  !/bg-surface-1/.test(read("components/report-card/StudentReportCard.tsx")),
  "the card prints on paper; theming it changes the printed artefact"
);
check(
  ".action-bar-sticky is still hardcoded (exempt)",
  /\.action-bar-sticky[\s\S]{0,500}rgb\(11 5 20/.test(globals),
  "this bar is deliberately exempt; do not tokenize it by accident"
);

// ===================== 7. MIGRATED SURFACES SPEAK TOKENS ====================
// Per-surface rather than global: a straggler in a not-yet-migrated module is
// expected, but a migrated one that reintroduces a raw hex has regressed.
// Match on the hex VALUE, not the utility prefix: a fixed brand dark can
// arrive as bg-[#0B0514], ring-offset-[#0B0514], border-[#0B0514] and a
// prefix-keyed list misses every variant but the one it was written for.
const RAW_BRAND = /\[#(0B0514|0F0A1E|130926|140A24|150826|150A26|150C28|080412)\b/i;
// A saturated fill carries its own contrast in both modes, so text-white is
// legitimate there. Everything else must be a token, or light mode puts near-
// black ink on a white surface and the text disappears.
const SATURATED = /bg-(red|indigo|emerald|amber|zinc|success|danger|warning|accent)-(400|500|600|700|800)\b/;
const MIGRATED = [
  ["Command Center shell", superadminShell],
  ["Command Center sidebar", superadminSidebar],
  ["lifecycle modals", lifecycleModals],
  ["KpiCard", kpiCard],
  ["landing Navbar", navbar],
  ["AdminShell", adminShell],
  ["StaffShell", staffShell],
  ["Modal", modal],
  ["toast", toast],
  ["RowActionsMenu", rowMenu],
  ["NotificationBell", bell],
  ["Button", button],
  ["Input", input],
  ["UploadField", uploadField],
];
for (const [name, src] of MIGRATED) {
  const s = stripComments(src);
  check(`${name} has no hard-coded brand-dark hex`, !RAW_BRAND.test(s),
    "a fixed dark hex bypasses the token system entirely");
  // Only flag text-white on lines that do NOT also carry a saturated fill.
  const offenders = s.split("\n").filter(
    (l) => /\btext-white\b/.test(l) && !SATURATED.test(l)
  );
  check(`${name} has no text-white outside a saturated fill`, offenders.length === 0,
    offenders.length ? `line: ${offenders[0].trim().slice(0, 90)}` : "");
}
check("sidebars use token classes",
  /bg-surface-0/.test(adminSidebar) && /bg-surface-0/.test(staffSidebar));
check("admin sidebar active state uses the accent token", /bg-accent-soft/.test(adminSidebar));
check("staff sidebar active state uses the accent token", /bg-accent-soft/.test(staffSidebar));
check("Modal uses a surface token, not a dark: variant pair",
  /bg-surface-1/.test(modal) && !/dark:bg-zinc-900/.test(stripComments(modal)));

// ===================== 7b. THE WHOLE ADMIN + MODERATOR PORTAL ===============
// Per-file lists rot: the first pass covered every manager, and the NEXT day
// five pages were still unreadable in light mode because the shared section
// headers -- a different file nobody listed -- still said text-white. Walking
// the whole portal tree is the only version of this that survives contact
// with the next slice. (This is exactly the failure class from the report:
// white headers on a light page.)
//
// What is banned, and why:
//   * fg-purple-* ramps (text-purple-100..500): designed as dark-mode ink;
//     on the light surface they are pale-on-white.
//   * text-white outside a saturated fill (see SATURATED above).
//   * any bg-/border-purple: purple is the accent; every other purple is a
//     holdover from before tokens existed.
//   * the light-mode ink ramps text-amber/red/emerald-100..300 and
//     text-zinc-100..400: pale status text on the translucent status panels
//     washes out in light mode. Status ink is warning/danger/success now.
// Toggle tracks keep their saturated fills and white knobs by approved
// exemption, and bg-white in SettingsForm is the signature paper preview, so
// only TEXT utilities are policed here -- except purple, where even a fill
// outside `bg-accent` is a regression.
const PORTAL_DIRS = [
  "app/[subdomain]/admin",
  "app/[subdomain]/moderator",
  "components/admin",
  "components/layout",
  "components/superadmin",
  "app/superadmin",
];
// Saturated fill preservation for text-white, shared with section 7.
const PORTAL_PALE_INK = /\btext-purple-(?:100|200|300|400|500)\b|\btext-(?:amber|red|emerald)-(?:100|200|300)\b|\btext-zinc-(?:100|200|300|400)\b/;
const PORTAL_PURPLE = /\b(?:bg|border)-purple(?:-\d+)?(?:\/\d+)?\b/;
// bg-purple-500 progress fills were the one purple the first pass kept; they
// read as a deliberate exception rather than a holdover, so name it precisely
// rather than letting the blanket purple ban consume a false positive.
const PORTAL_PURPLE_OK = /(?:bg|border)-purple-400\/30\b/;
const portalFiles = new Map();
const walkPortal = (dir) => {
  const base = join(root, dir);
  if (!existsSync(base)) return;
  for (const e of readdirSync(base, { withFileTypes: true })) {
    const full = join(base, e.name);
    if (e.isDirectory()) walkPortal(`${dir}/${e.name}`);
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) {
      portalFiles.set(`${dir}/${e.name}`, stripComments(readFileSync(full, "utf8")));
    }
  }
};
for (const d of PORTAL_DIRS) walkPortal(d);
// The point of a "we scanned everything" assertion is not a magic file count;
// each tree naming in PORTAL_DIRS must actually have contributed files, or the
// directory was renamed and the sweep is scanning a ghost.
for (const d of PORTAL_DIRS) {
  check(`the portal sweep reached ${d}`,
    [...portalFiles.keys()].some((f) => f.startsWith(d) && !f.includes("/", d.length + 1)),
    "directory missing — the sweep is scanning a path that no longer exists");
}
{
  const white = [];
  const pale = [];
  const purple = [];
  for (const [file, s] of portalFiles) {
    for (const l of s.split("\n")) {
      if (/\btext-white\b/.test(l) && !SATURATED.test(l) && !PORTAL_PURPLE_OK.test(l)) white.push(`${file}: ${l.trim().slice(0, 80)}`);
      if (PORTAL_PALE_INK.test(l)) pale.push(`${file}: ${l.trim().slice(0, 80)}`);
      if (PORTAL_PURPLE.test(l) && !PORTAL_PURPLE_OK.test(l)) purple.push(`${file}: ${l.trim().slice(0, 80)}`);
    }
  }
  check("no text-white on unsaturated lines anywhere in the portal", white.length === 0,
    white.length ? `${white.length} line(s), first: ${white[0]}` : "");
  check("no pale dark-mode ink ramps in the portal", pale.length === 0,
    pale.length ? `${pale.length} line(s), first: ${pale[0]}` : "");
  check("no purple fills or borders left in the portal", purple.length === 0,
    purple.length ? `${purple.length} line(s), first: ${purple[0]}` : "");
}

// UploadField specifically: it used to carry its own tone switch.
check(
  "UploadField no longer has a manual tone prop",
  !/\btone\??\s*:/.test(stripComments(uploadField)),
  "a second, hand-rolled theme switch inside a control fights the provider"
);
check(
  "UploadField colours come from tokens",
  /bg-surface-3/.test(stripComments(uploadField)) && /text-text-3/.test(stripComments(uploadField))
);

// ===================== 8. STUDENT PORTAL DISCOVERABILITY ====================
const footer = read("components/landing/Footer.tsx");
check("Navbar lists the Student Portal", /label:\s*"Student Portal"/.test(navbar),
  "an unlisted portal is unreachable except by typing the URL");
check("Navbar Student Portal points at /student (not /student/login)",
  /`\/\$\{subdomain\}\/student`/.test(navbar),
  "/student lets an existing session land on the dashboard instead of re-prompting");
check("Footer lists the Student Portal", /Student Portal/.test(footer));
check("Footer Student Portal points at /student", /href=\{`\/\$\{subdomain\}\/student`\}/.test(footer));
check("the mobile drawer reuses the same links array", /links\.map/.test(navbar));

// ===================== 9. THE UTILITIES ACTUALLY EMIT CSS ==================
// A mistyped token like `bg-surface-4` compiles, builds, deploys and passes
// tsc while emitting NOTHING. Source greps cannot see that.
//
// This compiles the real globals.css through the real Tailwind pipeline with
// the utilities force-listed, rather than reading .next. That matters twice:
// a stale .next reports FAIL for classes that are fine (this sandbox cannot
// reach Google Fonts, so `npm run build` fails and the old artefact lingers),
// and a stale .next reports PASS for classes that were removed. Either way the
// check is asserting about the wrong thing.
const UTILITIES = [
  "bg-surface-0", "bg-surface-1", "bg-surface-2", "bg-surface-3",
  "text-text-1", "text-text-2", "text-text-3",
  "border-line-1", "border-line-2",
  "bg-accent", "bg-accent-soft", "text-accent", "text-accent-fg",
  "bg-success-soft", "text-success",
  "bg-danger-soft", "text-danger",
  "bg-warning-soft", "text-warning",
];

let compiled = null;
try {
  const postcss = (await import("postcss")).default;
  const tw = (await import("@tailwindcss/postcss")).default;
  const probe = `${globals}\n@source inline(${JSON.stringify(UTILITIES.join(" "))});\n`;
  const out = await postcss([tw()]).process(probe, { from: join(root, "app", "globals.css") });
  compiled = out.css;
} catch (e) {
  check("Tailwind pipeline is runnable for the emit check", false, String(e).slice(0, 120));
}

if (compiled !== null) {
  check("the token pipeline compiles", compiled.length > 200, `${compiled.length} bytes`);
  for (const t of ["--surface-0", "--surface-1", "--text-1", "--line-1", "--accent"]) {
    check(`compiled CSS emits ${t}`, compiled.includes(t));
  }
  for (const util of UTILITIES) {
    // `.bg-surface-3` may also appear as `.hover\:bg-surface-3`, so anchor on
    // the escaped class rather than a bare substring.
    check(`utility .${util} emits CSS`, compiled.includes(`.${util.replace(/([/:])/g, "\\$1")}`),
      "a missing utility means the class renders with no styling at all");
  }
  check("dark utilities compile to a .dark ancestor selector", /:where\(\.dark/.test(compiled),
    "if this is a media query, the toggle is not actually controlling anything");
  check("compiled CSS is NOT keyed off prefers-color-scheme",
    !/@media \(prefers-color-scheme: dark\)/.test(compiled));
  check("color-scheme reached the compiled CSS", /color-scheme:\s*(light|dark)/.test(compiled));
  // A guard that always passes proves nothing; prove this one bites.
  check("the emit check rejects a utility that does not exist",
    !compiled.includes(".bg-surface-4"),
    "a nonexistent utility emitted CSS — the detection is broken");
}

// ============================ REPORT =======================================
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`Theme verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log(
  "Theme verified: provider unlocked (system + override), toggle mounted in all four shells, tokens 1:1 in both schemes, exemptions intact."
);