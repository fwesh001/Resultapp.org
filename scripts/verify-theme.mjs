#!/usr/bin/env node
/**
 * Light/Dark theming guard harness.
 *
 *   npm run build && node scripts/verify-theme.mjs
 *
 * Theming fails SILENTLY. A typo like `bg-surface-4` compiles, builds, deploys
 * and passes `tsc` — it just emits no CSS, so the element renders with no
 * background and nobody notices until a parent complains. These checks assert
 * on the BUILT stylesheet as well as the source, because only the built
 * artifact proves the tokens actually resolved.
 *
 * The load-bearing invariants:
 *
 *  1. `dark:` MUST be class-based. Tailwind v4 defaults it to the OS media
 *     query, which makes an explicit Light choice unenforceable — a user in OS
 *     dark mode who picks Light would still get dark styles with no way out.
 *     This project has no tailwind.config.ts (CSS-first v4), so the variant
 *     must be declared with `@custom-variant` in globals.css.
 *
 *  2. TOKENS MUST EMIT IN BOTH SCHEMES. A token defined only under `.dark`
 *     renders as an empty string in light mode: transparent text, invisible
 *     border. Unmissable in review, invisible to the compiler.
 *
 *  3. NO HYDRATION FLASH. next-themes writes the class on <html> before paint;
 *     without `suppressHydrationWarning` React logs a mismatch on every load.
 *
 *  4. THE TOGGLE GUARDS ITSELF BEFORE MOUNTING. Reading `resolvedTheme` during
 *     first render produces server HTML the client cannot match.
 *
 *  5. THE TOGGLE APPEARS IN EXACTLY THE THREE APPROVED PLACES. The plan scoped
 *     it to the landing navbar and the admin/staff shells. A fourth toggle
 *     (e.g. on the student portal, which has no approved placement) would be
 *     scope creep that nobody reviewed.
 *
 *  6. PRINT OUTPUT IS UNTOUCHED. The report card prints on white paper; a
 *     themed surface would either waste ink or come out unreadable.
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

// ===================== 1. CLASS-BASED DARK VARIANT =========================
check(
  "dark variant is re-pointed at a .dark class",
  /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/.test(globals),
  "without this, dark: follows the OS and an explicit Light choice cannot be enforced",
);
check(
  "no leftover prefers-color-scheme dark block",
  !/@media \(prefers-color-scheme: dark\)/.test(globals),
  "this would fight the toggle: OS dark would re-darken a page the user set to Light",
);
check("next-themes is a declared dependency", !!(pkg.dependencies || {})["next-themes"]);
check("provider uses attribute=class", /attribute="class"/.test(provider));
check("provider honours the OS as a default", /defaultTheme="system"/.test(provider));
check("provider enables system theme", /enableSystem/.test(provider));
check("theme transitions are disabled on swap", /disableTransitionOnChange/.test(provider));

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

// ===================== 4. TOGGLE SAFETY ====================================
check("toggle guards against hydration mismatch", /if \(!mounted\) return null|if \(!mounted\)/.test(toggle) || /if \(!mounted\)/.test(toggle));
check("toggle renders a placeholder until mounted", /if \(!mounted\)/.test(toggle));
check("toggle placeholder reserves space", /aria-hidden="true"/.test(toggle) && /inline-block/.test(toggle));
check("toggle switches theme via setTheme", /setTheme\(/.test(toggle));
check("toggle is a real button", /<button/.test(toggle));
check("toggle has an accessible label", /aria-label=/.test(toggle));
check("toggle exposes pressed state", /aria-pressed=/.test(toggle));
check("toggle is keyboard focusable", /focus-visible:ring/.test(toggle));

// ===================== 5. TOGGLE PLACEMENT (exactly 3) =====================
check("landing Navbar renders the toggle", /<ThemeToggle/.test(navbar));
check("AdminShell renders the toggle", /<ThemeToggle/.test(adminShell));
check("StaffShell renders the toggle", /<ThemeToggle/.test(staffShell));
check(
  "navbar imports the toggle",
  /import ThemeToggle from "@\/components\/theme\/ThemeToggle"/.test(navbar),
);
check(
  "AdminShell imports the toggle",
  /import ThemeToggle from "@\/components\/theme\/ThemeToggle"/.test(adminShell),
);
check(
  "StaffShell imports the toggle",
  /import ThemeToggle from "@\/components\/theme\/ThemeToggle"/.test(staffShell),
);
// No fourth, unapproved placement.
// Normalise separators: readdirSync yields "components\\admin\\AdminShell.tsx"
// on Windows and "components/admin/AdminShell.tsx" on POSIX, so comparing
// against a forward-slash literal would flag every placement as unexpected.
const norm = (p) => p.replace(/\\/g, "/");
const togglePlacements = readdirSync(join(root, "components"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => `components/${d.name}`)
  .filter((d) => existsSync(join(root, d)))
  .flatMap((d) => {
    const out = [];
    const walk = (p) => {
      for (const e of readdirSync(p, { withFileTypes: true })) {
        const full = join(p, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".tsx") && readFileSync(full, "utf8").includes("<ThemeToggle"))
          out.push(norm(full.replace(root + "\\", "").replace(root + "/", "")));
      }
    };
    walk(join(root, d));
    return out;
  });
const expected = [
  "components/admin/AdminShell.tsx",
  "components/staff/StaffShell.tsx",
  "components/landing/Navbar.tsx",
];
const unexpected = togglePlacements.filter((f) => !expected.includes(f));
check(
  "toggle appears in ONLY the three approved surfaces",
  togglePlacements.length === 3 && unexpected.length === 0,
  `found ${togglePlacements.length}: ${togglePlacements.join(", ")}`
    + (unexpected.length ? ` | unexpected: ${unexpected.join(", ")}` : ""),
);

// ===================== 6. PHASE 2 SURFACES ARE TOKENIZED ==================
// These are the components the plan named. Any hard-coded hex left in them
// means the surface simply stays dark in light mode — a silent half-migration.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const themed = [
  ["landing Navbar", navbar],
  ["AdminSidebar", adminSidebar],
  ["StaffSidebar", staffSidebar],
  ["AdminShell", adminShell],
  ["StaffShell", staffShell],
  ["ResultLookupWidget", widget],
];
for (const [name, src] of themed) {
  const s = stripComments(src);
  check(
    `${name} has no hard-coded brand-dark hex`,
    !/bg-\[#0B0514\]|bg-\[#150C28\]/.test(s),
    "a fixed dark hex ignores the theme entirely",
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
  "the old dark:bg-zinc-900 pair now follows the class toggle; a token needs no variant",
);
check(
  "ResultLookupWidget submit button uses the accent token",
  /bg-accent/.test(widget) && !/bg-purple-600/.test(stripComments(widget)),
);

// A themed shell wrapping an always-dark page frame is visibly broken: a light
// sidebar framing a black panel.
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

// ===================== 7. PRINT OUTPUT UNTOUCHED ===========================
check(
  "report card still forces a white print surface",
  /print:bg-white/.test(read("app/[subdomain]/report/[...studentId]/page.tsx")),
);
check(
  "report card is not tokenized",
  !/bg-surface-1/.test(read("components/report-card/StudentReportCard.tsx")),
  "the card prints on paper; theming it changes the printed artefact",
);

// ===================== 8. BUILT CSS (the real proof) =======================
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
  "Theme verified: class-based dark, tokens in both schemes, 3 approved toggle placements, print untouched.",
);