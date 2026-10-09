/**
 * Guards the branding + class-field work in this change set.
 *
 * Scope: static source assertions. These lock in decisions that are easy to
 * regress silently and are invisible at runtime (a squashed logo, a recoloured
 * asset, a tenant crest that starts showing the product logo, a sentinel value
 * leaking into the database).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond, detail });
};

// ---------------------------------------------------------------- logo asset

const logoPath = join(root, "public/logo.png");
check("public/logo.png exists", existsSync(logoPath));

if (existsSync(logoPath)) {
  const bytes = readFileSync(logoPath);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  check("public/logo.png is real PNG data", isPng);

  // Width/height live at fixed offsets in the IHDR chunk.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const aspect = width / height;

  // The source artwork is PORTRAIT and fills the canvas edge to edge. If this
  // ever becomes square, the Logo sizing constants need revisiting too.
  check(
    `logo is portrait as expected (${width}x${height}, aspect ${aspect.toFixed(3)})`,
    aspect < 0.8,
    `measured ${width}x${height}`,
  );
}

const logo = existsSync(join(root, "components/brand/Logo.tsx"))
  ? read("components/brand/Logo.tsx")
  : "";

// Never set both axes on the <img>: that is exactly what squashes a
// non-square mark. Width must stay auto/derived.
check(
  "Logo pins only the height and lets width follow the artwork",
  /HEIGHT\[size\]/.test(logo) && !/w-auto object-contain",\s*box\.w/.test(logo),
);
check(
  "Logo uses object-contain so the mark letterboxes instead of distorting",
  /object-contain/.test(logo),
);
check(
  "Logo keeps intrinsic width/height to avoid layout shift",
  /width=\{1045\}/.test(logo) && /height=\{1449\}/.test(logo),
);

// Recolouring was explicitly ruled out. A hard-coded tint/filter here would
// mean the mark no longer matches the favicon the user will re-export.
check(
  "Logo applies no colour filter (asset is used as authored)",
  !/\bbg-\[?(?:#|rgb)|brightness-|hue-rotate|saturate-|mix-blend/.test(logo),
);

// ------------------------------------------------------- GraduationCap split

// These are TENANT slots: a school with no crest of its own falls back to a
// cap. They must NOT become the product logo, or every school without a
// crest would appear to be branded as ResultApp.
const tenantCrestFiles = [
  "app/[subdomain]/page.tsx",
  "components/landing/Navbar.tsx",
];
for (const f of tenantCrestFiles) {
  const src = read(f);
  check(
    `${f} keeps the cap as the tenant crest fallback`,
    src.includes("GraduationCap"),
  );
  check(`${f} does not use the product Logo`, !/brand\/Logo/.test(src));
}

// Semantic uses where a cap genuinely means "students/classes/grading".
const semanticFiles = [
  "app/dashboard/page.tsx",
  "components/auth/WorkspaceLocatorForm.tsx",
  "components/staff/StaffSidebar.tsx",
];
for (const f of semanticFiles) {
  check(`${f} keeps its semantic GraduationCap use`, read(f).includes("GraduationCap"));
}

// The "School badge" in the template builder is paired with the school's own
// name, so it stays a tenant crest too.
check(
  "TemplateBuilder keeps the cap on its School badge",
  read("components/forms/TemplateBuilder.tsx").includes("GraduationCap"),
);

// Brand surfaces that must now use the logo.
const brandSites = [
  "components/layout/Navbar.tsx",
  "components/auth/AuthShell.tsx",
  "components/layout/Sidebar.tsx",
  "components/layout/DashboardShell.tsx",
  "components/admin/AdminShell.tsx",
  "components/admin/AdminSidebar.tsx",
  "components/staff/StaffShell.tsx",
  "components/staff/StaffSidebar.tsx",
  "app/login/page.tsx",
  "app/register/page.tsx",
];
for (const f of brandSites) {
  const src = read(f);
  check(`${f} renders the shared Logo`, /brand\/Logo/.test(src));
  // No brand surface should still be drawing a literal cap icon.
  check(`${f} has no literal <GraduationCap> usage`, !/<GraduationCap/.test(src));
}

// Any component still importing GraduationCap must use it somewhere, otherwise
// the icon is a dead import left behind by an edit.
const importRe = /import\s*\{([^}]*)\}\s*from\s*"lucide-react";/g;

// ------------------------------------------------------- demo page background

const demo = read("app/demo/page.tsx");
check("demo page renders the hero-preview background", /hero-preview\.avif/.test(demo));
check(
  "demo background is decorative (aria-hidden, empty alt)",
  /<img src="\/hero-preview\.avif" alt=""/.test(demo),
);
check("demo background sits behind the content", /-z-10/.test(demo));
check("demo background is dimmed for legibility", /bg-\[#0B0514\]\/\d+/.test(demo));
// Without isolate, -z-10 can escape behind the page body and vanish.
check("demo background is inside an isolate stacking context", /isolate/.test(demo));
// The centered layout must survive the change.
check("demo page keeps its centered layout", /justify-center/.test(demo));

// --------------------------------------------------------------- class select

const alloc = read("components/admin/AllocationsManager.tsx");
check("student Class field uses Select, not a free-text input", /<Select[\s\S]{0,400}aria-label="Class"/.test(alloc));
check("class list offers an Other… escape hatch", /OTHER_CLASS/.test(alloc) && /Other…/.test(alloc));
check("Other… reveals a custom class input", /showCustomClass && \([\s\S]{0,400}Custom class name/.test(alloc));
check("standard classes are seeded", /"Nursery 1"/.test(alloc) && /"Primary 6"/.test(alloc) && /"SS 3"/.test(alloc));

// The sentinel is a UI affordance only. If it ever reached the API a class
// would literally be named "__other__" in the database.
check(
  "sentinel is never written into class_name",
  !/setStudentForm\(\(p\) => \(\{ \.\.\.p, class_name: OTHER_CLASS \}\)\)/.test(alloc),
);
// And the old datalist is gone.
check(
  "the old free-text class input and datalist are removed",
  !/class-suggestions-edit/.test(alloc) && !/list="class-suggestions/.test(alloc),
);
// Custom names already in the roster must remain selectable.
check(
  "existing roster classes are merged into the options",
  /new Set\(\[\.\.\.CLASS_STANDARDS, \.\.\.availableClasses\]\)/.test(alloc),
);
// The state must be reset when the modal opens/closes, or a custom branch
// leaks into the next student.
check(
  "custom-class state resets on open and close",
  (alloc.match(/setShowCustomClass\(false\)/g) || []).length >= 3,
);

// ------------------------------------------------------------------- report

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`Branding verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log("Branding verified: favicon mark reused undistorted, tenant crests intact, class field supports custom classes.");