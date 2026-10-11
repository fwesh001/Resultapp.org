#!/usr/bin/env node
/**
 * Theme guard harness.
 *
 *   npm run build && node scripts/verify-theme.mjs
 *
 * THE APP IS CURRENTLY LOCKED TO DARK. The Light Theme rollout is paused
 * pending a dedicated design sprint, so these checks now assert the LOCK
 * rather than the toggle. They still read like a theme suite because the
 * machinery (tokens, custom variant, built CSS) stays in place and is
 * exactly what the design sprint will resume from.
 *
 * The failure these guard against is subtle and was the actual bug once
 * already: removing the toggle alone does NOT lock the theme. With
 * `defaultTheme="dark"` alone, a returning user whose localStorage still
 * holds "light" keeps light, and `enableSystem` re-reads the OS on every
 * load and flips a light-mode laptop back to light. Only `forcedTheme`
 * overrides both.
 *
 * On a dark-locked app a theming regression is still possible and still
 * silent: a mistyped token like `bg-surface-4` compiles, builds, deploys and
 * passes `tsc` while emitting no CSS at all. So the built stylesheet is
 * asserted too.
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
const adminSidebar = read("components/admin/AdminSidebar.tsx");
const staffSidebar = read("components/staff/StaffSidebar.tsx");
const modal = read("components/ui/Modal.tsx");
const widget = read("components/landing/ResultLookupWidget.tsx");

// Declared up front: several checks below strip comments so that prose
// explaining a setting is not mistaken for the setting itself.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const norm = (p) => p.replace(/\\/g, "/");

// ===================== 1. CLASS-BASED DARK VARIANT + THE LOCK =============
check(
  "dark variant is re-pointed at a .dark class",
  /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/.test(globals),
  "without this, dark: follows the OS and the lock cannot be enforced",
);
check(
  "no leftover prefers-color-scheme dark block",
  !/@media \(prefers-color-scheme: dark\)/.test(globals),
  "this would fight the lock: OS dark would re-darken regardless of the forced value",
);
check("next-themes is a declared dependency", !!(pkg.dependencies || {})["next-themes"]);
check("provider uses attribute=class", /attribute="class"/.test(provider));

// THE LOCK. defaultTheme alone is not enough: it is only the fallback when
// nothing is stored, so a returning user with "light" in localStorage keeps
// light, and enableSystem re-reads the OS every load. Only forcedTheme
// overrides both AND makes setTheme a no-op.
check(
  "provider FORCES dark (overrides a stored preference)",
  /forcedTheme="dark"/.test(provider),
  "defaultTheme alone is defeated by a stored 'light' value from before the pause",
);
check("provider defaults to dark", /defaultTheme="dark"/.test(provider));
check(
  "provider does NOT enable system theme",
  // Strip comments first: the provider's doc block explains WHY enableSystem is
  // omitted, and a naive substring match flags that explanation as the setting.
  !/enableSystem/.test(stripComments(provider)),
  "enableSystem re-reads the OS on every load and would flip a light-mode laptop back to light",
);
check("theme transitions are disabled on swap", /disableTransitionOnChange/.test(provider));

// ===================== 1b. THE TOGGLE IS NOT RENDERED ======================
// The toggle component itself is KEPT (the design sprint re-mounts it), so
// assert it is not rendered anywhere and not imported by a live surface.
const toggleRendered = [];
const walk = (p) => {
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".tsx")) {
      const src = readFileSync(full, "utf8");
      if (stripComments(src).includes("<ThemeToggle"))
        toggleRendered.push(norm(full.replace(root + "\\", "").replace(root + "/", "")));
    }
  }
};
for (const base of ["app", "components"]) {
  if (existsSync(join(root, base))) walk(join(root, base));
}
check(
  "no surface renders <ThemeToggle>",
  toggleRendered.length === 0,
  toggleRendered.length ? `still rendered in: ${toggleRendered.join(", ")}` : "",
);
check(
  "the toggle component is retained for the design sprint",
  existsSync(join(root, "components/theme/ThemeToggle.tsx")),
);
for (const [name, src] of [
  ["landing Navbar", navbar],
  ["AdminShell", adminShell],
  ["StaffShell", staffShell],
]) {
  check(`${name} does not import ThemeToggle`, !/import ThemeToggle/.test(stripComments(src)));
}

// ===================== 2. TOKELS IN BOTH SCHEMES ===========================
const TOKEN_NAMES = [
  "surface-0",
  "surface-1",
  "surface-2",
  "surface-3",
  "text-1",
  "text-2",
  "text-3",
  "line-1",
  "line-2",
  "accent",
  "accent-fg",
  "accent-soft",
  "danger",
  "success",
  "warning",
];
const rootBlock = globals.slice(globals.indexOf(":root {"), globals.indexOf(".dark {"));
const darkBlock = globals.slice(globals.indexOf(".dark {"), globals.indexOf("@theme inline"));

for (const t of TOKEN_NAMES) {
  check(
    `token --${t} defined in light (:root)`,
    rootBlock.includes(`--${t}:`),
    "missing from :root means the light theme renders it empty",
  );
  check(
    `token --${t} defined in dark (.dark)`,
    new RegExp(`--${t}:`).test(darkBlock),
    "missing from .dark means the dark theme renders it empty",
  );
}
check(
  "light and dark differ for the page background",
  /--surface-0:\s*#0b0514/.test(darkBlock) && !/--surface-0:\s*#0b0514/.test(rootBlock),
);

// Aliases let components use `bg-surface-1` rather than arbitrary values.
for (const alias of [
  "--color-surface-0",
  "--color-surface-1",
  "--color-text-1",
  "--color-line-1",
  "--color-accent",
]) {
  check(`token alias ${alias} is exposed to Tailwind`, globals.includes(`${alias}: var(`));
}
check(
  "color-scheme is declared for light",
  /color-scheme:\s*light/.test(globals),
  "without it a light page still paints a dark scrollbar and dark form controls",
);
check("color-scheme is declared for dark", /color-scheme:\s*dark/.test(globals));

// ===================== 3. NO HYDRATION FLASH ================================
check(
  "<html> suppresses hydration warnings",
  /<html[\s\S]{0,400}suppressHydrationWarning/.test(rootLayout),
  "next-themes sets the class before React hydrates; without this React logs a mismatch every load",
);
check("root layout mounts ThemeProvider", /<ThemeProvider>/.test(rootLayout));
check(
  "Toaster is inside the provider",
  /<ThemeProvider>[\s\S]{0,400}<Toaster \/>/.test(rootLayout),
  "a toast rendered outside the provider cannot read the resolved theme",
);

// ===================== 4. TOGGLE RETAINED FOR THE SPRINT ===================
// Unmounted, so its internals are not asserted. Asserted only so that a
// future cleanup pass cannot delete it out from under the design sprint, which
// will need it and would otherwise have to rewrite the mounted-state guard.
check("ThemeToggle component still exists", existsSync(join(root, "components/theme/ThemeToggle.tsx")));
check(
  "ThemeToggle still guards its own hydration",
  /if \(!mounted\)/.test(toggle),
  "the design sprint re-mounts this; a version without the guard flashes the wrong icon",
);

// ===================== 5. GLASSMORPHIC RESULT CHECKER ======================
// The card sits ON TOP of a Hero background image. When the token migration
// replaced `bg-purple-900/[0.04]` with the opaque `bg-surface-1`, the Hero
// disappeared behind a solid slab — the exact regression this reverts.
// Translucency here is the design, so this surface is exempt from the token
// pass along with the print surface.
const widgetSrc = stripComments(widget);
check(
  "Result Checker card is translucent (not an opaque token)",
  /bg-black\/40/.test(widgetSrc) && !/rounded-2xl[^\n]*bg-surface-1/.test(widgetSrc),
  "an opaque surface hides the Hero image behind it",
);
check("Result Checker keeps its backdrop blur", /backdrop-blur/.test(widgetSrc));
check("Result Checker uses a translucent border", /border-white\/10|border-white\/20/.test(widgetSrc));
check(
  "Result Checker inputs are dark recessed wells, not light tokens",
  /bg-\[#0B0514\]/.test(widgetSrc),
  "an input must stay opaque so typed text never overlaps the Hero",
);

// ===================== 6. STUDENT PORTAL DISCOVERABILITY ====================
const footer = read("components/landing/Footer.tsx");
check(
  "Navbar lists the Student Portal",
  /label:\s*"Student Portal"/.test(navbar),
  "an unlisted portal is unreachable except by typing the URL",
);
check(
  "Navbar Student Portal points at /student (not /student/login)",
  /`\/\$\{subdomain\}\/student`/.test(navbar),
  "/student lets an existing session land on the dashboard instead of re-prompting",
);
check("Footer lists the Student Portal", /Student Portal/.test(footer));
check(
  "Footer Student Portal points at /student",
  /href=\{`\/\$\{subdomain\}\/student`\}/.test(footer),
);
// The mobile drawer is driven by the same `links` array, so one entry covers
// both; assert it rather than assuming.
check(
  "the mobile drawer reuses the same links array",
  /links\.map/.test(navbar),
);

// ===================== 7. DARK-LOCKED SURFACES ==============================
// With the app locked to dark, a themed surface must resolve to its dark
// value. The tokens are retained for the design sprint, so assert they are
// still wired rather than removed.
const themed = [
  ["landing Navbar", navbar],
  ["AdminSidebar", adminSidebar],
  ["StaffSidebar", staffSidebar],
  ["AdminShell", adminShell],
  ["StaffShell", staffShell],
];
for (const [name, src] of themed) {
  const s = stripComments(src);
  check(
    `${name} has no hard-coded brand-dark hex`,
    !/bg-\[#0B0514\]|bg-\[#150C28\]/.test(s),
    "a fixed dark hex bypasses the token system entirely",
  );
}
check(
  "sidebars use token classes",
  /bg-surface-0/.test(adminSidebar) && /bg-surface-0/.test(staffSidebar),
);
check("admin sidebar active state uses the accent token", /bg-accent-soft/.test(adminSidebar));
check("staff sidebar active state uses the accent token", /bg-accent-soft/.test(staffSidebar));
check(
  "Navbar and shells consume the surface tokens",
  /bg-surface-0/.test(navbar) && /bg-surface-0/.test(adminShell) && /bg-surface-0/.test(staffShell),
);
check(
  "Modal uses the surface token instead of the dark: variant",
  /bg-surface-1/.test(modal) && !/dark:bg-zinc-900/.test(stripComments(modal)),
  "the old dark:bg-zinc-900 pair only worked via the OS; a token needs no variant",
);
check(
  "ResultLookupWidget submit button uses the accent token",
  /bg-accent/.test(widgetSrc) && !/bg-purple-600/.test(widgetSrc),
);

// The page frames inside the themed shells follow the same token, so the shell
// and its content cannot drift apart in a future light-mode pass.
const shellPages = [
  "app/[subdomain]/admin/(dashboard)/billing/page.tsx",
  "app/[subdomain]/admin/(dashboard)/clearance/page.tsx",
  "app/[subdomain]/staff/(dashboard)/classes/page.tsx",
  "app/[subdomain]/staff/(dashboard)/grading/page.tsx",
];
for (const p of shellPages) {
  if (!existsSync(join(root, p))) continue;
  const src = read(p);
  check(
    `${p.split("/").slice(-3, -2)[0]} page frame follows the theme`,
    !/min-h-screen bg-\[#0B0514\]/.test(src),
    "this page renders INSIDE the themed shell; a fixed dark frame breaks the theme",
  );
}

// ===================== 8. PRINT OUTPUT UNTOUCHED ===========================
check(
  "report card still forces a white print surface",
  /print:bg-white/.test(read("app/[subdomain]/report/[...studentId]/page.tsx")),
);
check(
  "report card is not tokenized",
  !/bg-surface-1/.test(read("components/report-card/StudentReportCard.tsx")),
  "the card prints on paper; theming it changes the printed artefact",
);

// ===================== 9. BUILT CSS (the real proof) =======================
// Source checks cannot catch a typo that compiles to nothing. Assert on the
// emitted stylesheet.
const cssDir = [".next/static/chunks", ".next/static/css"].find((d) => existsSync(join(root, d)));
check("a built stylesheet exists (run npm run build first)", !!cssDir, "no built CSS to verify");
if (cssDir) {
  const css = readdirSync(join(root, cssDir))
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(join(root, cssDir, f), "utf8"))
    .join("\n");

  check("built CSS is non-trivial", css.length > 5000, `${css.length} bytes`);
  check(
    "dark utilities compiled to a .dark ancestor selector",
    /:where\(\.dark/.test(css),
    "if this is a media query, the toggle is not actually controlling anything",
  );
  check(
    "built CSS is NOT keyed off prefers-color-scheme",
    !/@media \(prefers-color-scheme: dark\)/.test(css),
  );
  for (const t of ["--surface-0", "--surface-1", "--text-1", "--line-1", "--accent"]) {
    check(`built CSS emits ${t}`, css.includes(t));
  }
  // The utilities the migrated components actually use.
  for (const util of ["bg-surface-0", "bg-surface-1", "text-text-2", "border-line-1", "bg-accent-soft"]) {
    check(
      `utility .${util} emitted`,
      css.includes(`.${util}`),
      "a missing utility means the class renders with no styling at all",
    );
  }
  check("color-scheme reached the built CSS", /color-scheme:\s*(light|dark)/.test(css));
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
  "Theme verified: locked to dark via forcedTheme, toggle unmounted, glass Result Checker intact, print untouched.",
);