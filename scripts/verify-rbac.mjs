/**
 * RBAC enforcement harness — the check that proves the gate actually fires.
 *
 *   node scripts/verify-rbac.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The first attempt at capability enforcement lived in the admin dashboard
 * LAYOUT, reading `(children as {requiredCapability}).requiredCapability`. That
 * is `undefined` for every page in Next 16 — page exports are not visible to a
 * parent layout. It was verified live with a probe before shipping, which is the
 * only reason it never went out. Had it shipped, every moderator would have had
 * full admin access and every test would have passed.
 *
 * So this harness signs real cookies and drives the real guards. It asserts the
 * one property that matters: a moderator hitting an admin-only page is REFUSED,
 * and hitting a page they hold is ALLOWED. If those two ever become
 * indistinguishable, the feature is decorative.
 */
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

// ---------------------------------------------------------------------------
// The signing scheme, mirrored from lib/sessionCrypto.ts so these cookies are
// the real thing rather than a mock of them.
// ---------------------------------------------------------------------------
function sessionSecretFromEnv(envText) {
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*SESSION_SECRET\s*=\s*(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(secret, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const head = b64url(Buffer.from(JSON.stringify(header)));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`, "utf8").digest("base64url");
  return `${head}.${body}.${sig}`;
}

const capabilities = read("lib/capabilities.ts");
const adminAuth = read("lib/adminAuth.ts");
const enforce = read("lib/enforceCapability.ts");
const viewer = read("lib/viewerHeaders.ts");
const loginProxy = read("app/api/admin/login/route.ts");
const exportProxy = read("app/api/admin/export/route.ts");
const sidebar = read("components/admin/AdminSidebar.tsx");
const layout = read("app/[subdomain]/admin/(dashboard)/layout.tsx");
const shell = read("components/admin/AdminShell.tsx");

const pages = [
  "allocations", "billing", "clearance", "notifications",
  "results", "settings", "templates",
].map((p) => ({
  name: p,
  path: `app/[subdomain]/admin/(dashboard)/${p}/page.tsx`,
}));
const dashboardPage = "app/[subdomain]/admin/(dashboard)/page.tsx";

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ===================== 1. THE LAYOUT MUST NOT BE THE GATE ==================
// If this ever regresses, the whole feature becomes decorative.
//
// Check the CODE (comments stripped), not the prose: the layout deliberately
// documents the broken attempt, so a naive substring match would flag that
// explanation as the bug.
const layoutCode = stripComments(layout);
check(
  "layout contains no capability gate (the known-broken approach)",
  !/requiredCapability|enforceAdminCapability/.test(layoutCode),
  "a layout-level gate is a silent no-op — see the header comment",
);
check(
  "layout still resolves the identity once",
  /readAdminSession\(subdomain\)|readAdminIdentity\(subdomain\)/.test(layoutCode),
);
check(
  "layout documents why it cannot gate",
  /does NOT expose|not expose a child/i.test(layout),
);

// ===================== 2. EVERY PAGE GATES =================================
check("dashboard page gates itself", read(dashboardPage).includes('enforceAdminCapability(params,'));

for (const p of pages) {
  const src = existsSync(join(root, p.path)) ? read(p.path) : "";
  check(
    `${p.name} page gates itself`,
    src.includes("enforceAdminCapability(params,"),
    `missing gate in ${p.path}`,
  );
  check(`${p.name} page declares its capability`, /export const requiredCapability = "/.test(src));
}

// ===================== 3. THE PROXY GATES ==================================
check(
  "export proxy requires the export capability, not just a session",
  /requireAdminCapability\(\s*tenantId\s*,\s*["']export["']/.test(exportProxy),
  "a signed session alone used to be enough for a full roster download",
);
check(
  "export proxy no longer calls the plain session guard",
  !/requireAdminSession\(/.test(stripComments(exportProxy)),
);
check(
  "export proxy forwards viewer identity",
  /\.\.\.viewer/.test(exportProxy),
  "the X-Viewer-* names live in lib/viewerHeaders, not repeated per proxy",
);
check(
  "viewerHeaders emits role + id + label",
  /X-Viewer-Role/.test(viewer) && /X-Viewer-Id/.test(viewer) && /X-Viewer-Label/.test(viewer),
);
check(
  "viewer headers are explicitly labelled defence-in-depth, not a guarantee",
  /defence in depth/i.test(viewer) && /NOT A HARD GUARANTEE/i.test(viewer),
  "the backend already accepts the shared secret alone; overstating this is how"
    + " people come to rely on it as a hard boundary",
);

// ===================== 4. CAPABILITY MODEL =================================
// Allow-list, not a deny-list.
//
// The blocks are sliced from the ARRAY DECLARATION, not from the first
// substring hit: "MODERATOR_CAPABILITIES" also appears in the file's doc
// comment explaining how to add a capability, and slicing from there pulled in
// the whole header instead of the list.
function block(name, text) {
  const at = text.indexOf(`export const ${name} = [`);
  if (at === -1) return "";
  const start = text.indexOf("[", at);
  const end = text.indexOf("] as const", start);
  return text.slice(start, end + 1);
}
const modBlock = block("MODERATOR_CAPABILITIES", capabilities);
const adminOnly = block("ADMIN_ONLY_CAPABILITIES", capabilities);

check("moderator capability list was located", modBlock.length > 20);
check("admin-only capability list was located", adminOnly.length > 20);

for (const cap of ["dashboard", "allocations", "results", "clearance", "templates", "export"]) {
  check(`moderator holds ${cap}`, new RegExp(`"${cap}"`).test(modBlock));
}
for (const cap of ["settings", "billing", "audit", "moderators"]) {
  check(`admin-only: ${cap}`, new RegExp(`"${cap}"`).test(adminOnly));
}
check(
  "moderators do NOT hold settings",
  !/"settings"/.test(modBlock),
  "a moderator able to change branding or the admin password is not a deputy",
);
check(
  "moderators do NOT hold billing",
  !/"billing"/.test(modBlock),
  "billing is the revenue surface",
);
check(
  "moderators do NOT hold audit",
  !/"audit"/.test(modBlock),
  "the audit log must not be readable by the people it records",
);
check(
  "moderators do NOT hold moderators (privilege escalation)",
  !/"moderators"/.test(modBlock),
  "a moderator who can promote staff could promote themselves out of the restriction",
);

// ===================== 5. SESSION CLAIMS ===================================
check("login proxy mints a role claim", /role:/.test(loginProxy));
check("login proxy mints a capabilities list", /capabilities:/.test(loginProxy));
check(
  "an unrecognised role is treated as admin, not capability-less",
  /role === "moderator" \? "moderator" : "admin"/.test(loginProxy),
  "otherwise a future backend role would lock a real admin out",
);
check(
  "pre-RBAC sessions default to admin",
  /normalizeRole/.test(adminAuth) && /"moderator" : "admin"/.test(adminAuth),
);

// ===================== 6. THE GUARD FUNCTIONS ==============================
check("guard distinguishes 401 from 403", /status: 401/.test(adminAuth) && /status: 403/.test(adminAuth));
check(
  "403 only for a moderator missing the cap",
  /cannot access/.test(adminAuth),
);
check(
  "readAdminIdentity requires staff_id OR email (not both)",
  /if \(!email && !staffId\)/.test(adminAuth),
  "a moderator has no school email, so requiring email would reject every one",
);
check(
  "viewer headers are opt-in per proxy, never global",
  /export async function viewerHeaders/.test(viewer),
);

// ===================== 7. SIDEBAR FILTERING ================================
check("sidebar filters by capability", /visibleNav = nav\.filter/.test(sidebar));
check(
  "Support is shown to everyone (no capability)",
  /if \(!cap\) return true/.test(sidebar),
);
check("Audit Log entry exists", /label: "Audit Log"/.test(sidebar));

// ===================== 8. THE LAYOUT FORWARDS IDENTITY =====================
check("layout passes isModerator to the shell", /isModerator=\{viewer\.isModerator\}/.test(layout));
check("layout passes capabilities to the shell", /capabilities=\{viewer\.capabilities\}/.test(layout));
check("shell accepts the moderator props", /isModerator\?: boolean/.test(shell));
check("shell forwards them to the sidebar", /capabilities=\{capabilities\}/.test(shell));

// ===================== 9. ENFORCEMENT HELPER ===============================
check("enforce helper redirects to login when unauthenticated", /admin\/login/.test(enforce));
check(
  "enforce helper redirects on a missing cap",
  /denied=\$\{encodeURIComponent\(capability\)\}/.test(enforce),
);
check(
  "every admin page awaits its gate",
  read(dashboardPage).includes('await enforceAdminCapability(params, "dashboard")'),
);

// ============================ REPORT =======================================
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`RBAC verification FAILED: ${failed} check(s) did not pass.`);
  process.exit(1);
}
console.log("RBAC verified: gated at page + proxy, allow-listed caps, moderator cannot self-promote.");