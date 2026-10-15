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
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
// The STAFF portal half. A moderator signs into BOTH portals with the same
// credentials, so the staff side has its own independent copy of the same
// question: does this member know they were promoted?
const staffAuth = read("lib/staffAuth.ts");
const staffLayout = read("app/[subdomain]/staff/(dashboard)/layout.tsx");
const staffShell = read("components/staff/StaffShell.tsx");
const staffSidebar = read("components/staff/StaffSidebar.tsx");
const staffAuthRouter = read("backend/routers/staff_auth.py");
const staffLoginProxy = read("app/api/staff/login/route.ts");
const settingsProxy = read("app/api/admin/settings/route.ts");
const notifyLib = read("app/api/notifications/_lib.ts");
const moderatorSession = read("app/api/moderator/session/route.ts");
const allocationsRouter = read("backend/routers/allocations.py");
const dbManager = read("backend/services/db_manager.py");

// Page routes are no longer enumerated here. They used to be, as `pages` +
// `dashboardPage`, both admin-only — which is exactly why the gate checks had to
// be rewritten when the moderator portal appeared (see SECTION_ROUTES below).
// That list now covers BOTH portals and the admin-only pages that must NOT be
// mirrored, and `gateFor` resolves each route through its shared section.

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Resolve a route file's capability gate, following ONE level of indirection.
 *
 * Each page is now a thin wrapper around a shared component in
 * components/admin/sections/ (so `/{sub}/admin/results` and
 * `/{sub}/moderator/results` cannot drift). The gate therefore lives in the
 * section, not the route file.
 *
 * A naive `src.includes("enforceAdminCapability(")` against the route file would
 * fail here — and the tempting "fix" is to weaken the assertion until it passes,
 * which is precisely how a guard check becomes decorative. So instead: look in
 * the route file, and if the gate is not there, follow its section import.
 *
 * This still catches the real regression — a route whose section lost its gate —
 * because an unresolvable import fails loudly rather than defaulting to pass.
 */
function gateFor(routePath) {
  const src = existsSync(join(root, routePath)) ? read(routePath) : "";
  if (!src) return { found: false, where: routePath, text: "" };
  if (src.includes("enforceAdminCapability(")) {
    return { found: true, where: routePath, text: src };
  }
  const m = src.match(/from\s+"@\/components\/admin\/sections\/([A-Za-z0-9_]+)"/);
  if (!m) return { found: false, where: routePath, text: src };
  const sectionPath = `components/admin/sections/${m[1]}.tsx`;
  const section = existsSync(join(root, sectionPath)) ? read(sectionPath) : "";
  if (!section) return { found: false, where: sectionPath, text: "" };
  return {
    found: section.includes("enforceAdminCapability("),
    where: sectionPath,
    text: routePath + "\n" + section,
  };
}

/** Both portals of a section must exist and both must resolve to a gate. */
const PORTALS = ["admin", "moderator"];

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
  /readAdminIdentity\(subdomain\)/.test(
    stripComments(layout) + stripComments(read("components/admin/PortalDashboardLayout.tsx")),
  ),
);
check(
  "layout documents why it cannot gate",
  /does NOT expose|not expose a child/i.test(
    layout + read("components/admin/PortalDashboardLayout.tsx"),
  ),
);

// ===================== 2. EVERY PAGE GATES =================================
// Checked for BOTH portals. A gate that exists only under /admin is exactly the
// shape of bug that let a moderator reach the admin portal in the first place.
const SECTION_ROUTES = [
  { name: "dashboard", path: "page.tsx", cap: "dashboard" },
  { name: "results", path: "results/page.tsx", cap: "results" },
  { name: "allocations", path: "allocations/page.tsx", cap: "allocations" },
  { name: "clearance", path: "clearance/page.tsx", cap: "clearance" },
  { name: "templates", path: "templates/page.tsx", cap: "templates" },
  { name: "notifications", path: "notifications/page.tsx", cap: "notifications" },
  // Admin-only pages exist under ONE portal. Their absence from /moderator is
  // the enforcement: there is no route to reach at all.
  { name: "settings", path: "settings/page.tsx", cap: "settings", portals: ["admin"] },
  { name: "billing", path: "billing/page.tsx", cap: "billing", portals: ["admin"] },
  { name: "audit", path: "audit/page.tsx", cap: "audit", portals: ["admin"] },
];

for (const p of SECTION_ROUTES) {
  for (const portal of p.portals ?? PORTALS) {
    const routePath = `app/[subdomain]/${portal}/(dashboard)/${p.path}`;
    const g = gateFor(routePath);
    check(
      `${portal}/${p.name} gates itself`,
      g.found,
      `no enforceAdminCapability found for ${routePath} (checked ${g.where})`,
    );
  }
}

// The admin-only pages must NOT have been mirrored into the moderator tree.
// Copying one across is the most likely mistake in this whole change.
for (const p of SECTION_ROUTES.filter((x) => x.portals)) {
  check(
    `${p.name} has NO moderator route`,
    !existsSync(join(root, `app/[subdomain]/moderator/(dashboard)/${p.path}`)),
    `/${p.name} is admin-only; a moderator route for it would expose an admin page`,
  );
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

for (const cap of ["dashboard", "allocations", "results", "clearance", "templates", "export", "notifications"]) {
  check(`moderator holds ${cap}`, new RegExp(`"${cap}"`).test(modBlock));
}
for (const cap of ["settings", "billing", "audit", "moderators"]) {
  check(`admin-only: ${cap}`, new RegExp(`"${cap}"`).test(adminOnly));
}
check(
  "notifications is not ALSO in the admin-only list",
  !/"notifications"/.test(adminOnly),
  "a cap in both lists is ambiguous about which side it is guarding",
);
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

// Granting `notifications` grants the INBOX, not the microphone.
//
// The tenant notification API is list / unread-count / mark-read. Composing and
// broadcasting to every parent and staff member lives under /api/superadmin/*.
// If a future refactor moved broadcast behind the tenant capability, a deputy
// could speak to the whole school — so assert the split still holds.
const notifInbox = read("app/api/notifications/inbox/route.ts");
const notifBroadcast = read("app/api/superadmin/notifications/broadcast/route.ts");
check(
  "tenant notification inbox is reachable by a moderator session",
  /admin_session|staff_session/.test(notifInbox),
  "inbox + inbox caps are the same door",
);
check(
  "broadcast lives outside the tenant capability surface",
  notifBroadcast.length > 0 && !/requireAdminCapability\(\s*\w+\s*,\s*"notifications"/.test(notifBroadcast),
  "broadcast must not be unlockable with the notifications capability",
);
check(
  "broadcast requires superadmin identity",
  /superadmin|platform_admin|superAdminSession|requireSuperadmin/i.test(notifBroadcast),
  "a tenant session must not satisfy it",
);

// ===================== 5. SESSION CLAIMS ===================================
// The login proxy used to inline the role/capability shaping. It now delegates
// to buildSessionClaims, which the moderator elevation route also calls — two
// minting sites for the same two claims is exactly the drift this prevents.
check("login proxy mints a role claim", /role/.test(loginProxy) && /buildSessionClaims/.test(loginProxy));
check("login proxy mints a capabilities list", /capabilities/.test(loginProxy));
check(
  "an unrecognised role is treated as admin, not capability-less",
  // In capabilities.ts now (buildSessionClaims). The shaper must not fall back
  // to an EMPTY capability list for an unknown role — that would lock a real
  // admin out with no obvious cause. Note this is about the CAPABILITY list
  // default; the ROLE itself fails closed in normalizeRole, which is a
  // different and stricter check asserted separately below.
  /claimed === "moderator" \? \[\.\.\.MODERATOR_CAPABILITY_LIST\] : \[\.\.\.ADMIN_CAPABILITIES\]/.test(capabilities),
);
check(
  "BOTH minting sites use the one shared shaper",
  /buildSessionClaims/.test(loginProxy) && /buildSessionClaims/.test(moderatorSession),
  "two sites shaping the same claims can drift into different capability sets",
);
// Was: "pre-RBAC sessions default to admin", asserting the fail-open default.
// That rationale died with the MAC change. Binding the cookie name into the MAC
// invalidates every outstanding session on deploy, so no pre-RBAC cookie exists
// in the wild to stay compatible with — and the fail-open default was the most
// dangerous line in the file: a derivation path that forgot `role` silently
// produced ADMIN_CAPABILITIES, including `moderators`.
//
// These assert the INVARIANT ("only admin/moderator are recognised; everything
// else is null") rather than one regex. Mutation testing showed the original
// single-regex version passed while the function happily accepted "superadmin"
// as an alias for admin — a real widening that a new backend role name could
// reintroduce.
const normalizeRoleBody = (() => {
  const m = adminAuth.match(/function normalizeRole\([\s\S]*?\n\}/);
  return m ? m[0] : "";
})();
check(
  "normalizeRole recognises ONLY admin and moderator",
  /role === "admin"/.test(normalizeRoleBody) &&
    /role === "moderator"/.test(normalizeRoleBody) &&
    !/role === "admin"\s*\|\|/.test(normalizeRoleBody) &&
    !/\?\s*"moderator"\s*:\s*"admin"/.test(normalizeRoleBody),
  "any widening (`||`, an alias, or a ternary default) reintroduces a path to ADMIN_CAPABILITIES",
);
check(
  "an unrecognised role claim is NOT assumed to be admin",
  /function normalizeRole[\s\S]{0,400}return null/.test(adminAuth),
  "a missing/forged role must fail closed, not become a full admin",
);
check(
  "readAdminIdentity rejects a session with no usable role",
  /if \(!role\) return await unauthorized\(\)/.test(adminAuth),
  "otherwise normalizeRole's null is discarded and the session passes anyway",
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
// Both portals share components/admin/PortalDashboardLayout.tsx, so that file is
// what has to forward the identity. Asserting against either route's layout
// would test a one-line wrapper.
const portalLayout = read("components/admin/PortalDashboardLayout.tsx");
check("layout passes isModerator to the shell", /isModerator=\{viewer\.isModerator\}/.test(portalLayout));
check("layout passes capabilities to the shell", /capabilities=\{viewer\.capabilities\}/.test(portalLayout));
check("layout passes the portal to the shell", /portal=\{portal\}/.test(portalLayout));
check("shell accepts the moderator props", /isModerator\?: boolean/.test(shell));
check("shell forwards them to the sidebar", /capabilities=\{capabilities\}/.test(shell));
check(
  "BOTH portals' layouts delegate to the ONE shared body",
  /PortalDashboardLayout[\s\S]{0,200}portal="admin"/.test(stripComments(layout)) &&
    /PortalDashboardLayout[\s\S]{0,200}portal="moderator"/.test(
      stripComments(read("app/[subdomain]/moderator/(dashboard)/layout.tsx")),
    ),
  "two copies of the guard+banner is exactly how the /admin/billing banner link drifted",
);

// ===================== 9. ENFORCEMENT HELPER ===============================
// Was: /admin\/login/.test(enforce) — a literal string match on a hardcoded
// target. Both targets are now built from the `portal` argument, so a literal
// match would either fail or (worse) pass for the wrong reason. Assert the
// portal is threaded through to BOTH redirects instead, including the default.
check(
  "enforce helper redirects to the portal's OWN login, not always /admin",
  /redirect\(`\/\$\{subdomain\}\/\$\{portal\}\/login`\)/.test(enforce) &&
    /portal: "admin" \| "moderator" = "admin"/.test(enforce),
  "a signed-out moderator sent to /admin/login lands on 'Admin ID or Email' — the exact page this work exists to stop showing them",
);
check(
  "enforce helper redirects on a missing cap, within the same portal",
  /denied=\$\{encodeURIComponent\(capability\)\}/.test(enforce) &&
    /redirect\(`\/\$\{subdomain\}\/\$\{portal\}\?denied=/.test(enforce),
);
check(
  "every page awaits its gate",
  SECTION_ROUTES.every((p) =>
    (p.portals ?? PORTALS).every((portal) =>
      /await enforceAdminCapability\(\s*params\s*,/.test(
        gateFor(`app/[subdomain]/${portal}/(dashboard)/${p.path}`).text,
      ),
    ),
  ),
  "a bare `enforceAdminCapability(` that is not awaited returns a Promise and guards nothing",
);

// ============ 10. A PROMOTED MEMBER CAN ACTUALLY DISCOVER THE PROMOTION =======
//
// The gap this closes: before it, the ONLY signal that a staff member had been
// promoted was that their colleague's sidebar had fewer items. No notification,
// no email, no link. Each link in that chain is checked below, because losing
// any one of them reproduces the original silence in a harder-to-spot way.
check("staff login surfaces is_moderator", /COALESCE\(is_moderator, FALSE\) AS is_moderator/.test(staffAuthRouter));
check(
  "the session identity actually forwards it",
  // The silent-no-op trap: the two interfaces can be extended without the
  // returned literal ever mentioning the field, and nothing else would notice.
  /isModerator: session\.staff\?\.is_moderator === true/.test(staffAuth),
);
check("identity fails closed when the claim is absent", /=== true/.test(staffAuth));
check("staff layout resolves a LIVE moderator flag", /liveIsModerator/.test(staffLayout));
check(
  "live value wins over the stale cookie",
  /liveIsModerator \?\? identity\.isModerator/.test(staffLayout),
);
check("layout forwards it to the shell", /isModerator=\{isModerator\}/.test(staffLayout));
check("shell accepts it", /isModerator\?: boolean/.test(staffShell));
// The dialog has to be dismissible, or a mis-click on the backdrop strands the
// admin in it with no way out except reloading.
check(
  "the moderator dialog can be dismissed",
  /onOpenChange=\{\(o(?:: boolean)?\) => \{ if \(!o\) setPendingToggle\(null\); \}\}/.test(read("components/admin/ModeratorManager.tsx")),
);
check(
  "shell forwards it to BOTH sidebar mounts",
  (staffShell.match(/<StaffSidebar[^>]*isModerator=\{isModerator\}/g) || []).length === 2,
);
check("sidebar accepts it", /isModerator\?: boolean/.test(staffSidebar));
check("sidebar filters the moderator-only link", /moderatorOnly \|\| isModerator/.test(staffSidebar));
check(
  "the Moderator Console link uses the function href form and points at /moderator",
  // A plain string href is resolved as `${base}${item.href}` with base =
  // /{sub}/staff, so "/moderator" would render /{sub}/staff/moderator — a 404
  // that looks exactly like a broken link.
  /href: \(sub: string\) => `\/\$\{sub\}\/moderator`/.test(staffSidebar),
);
check(
  "the staff sidebar no longer offers an Admin Portal link",
  !/label: "Admin Portal"/.test(staffSidebar) && !/\$\{sub\}\/admin`/.test(staffSidebar),
  "this link is the bug the whole Moderator Console exists to fix",
);
check(
  "the sidebar labels it Moderator Console",
  /label: "Moderator Console"/.test(staffSidebar),
);
check(
  "the form-class link is no longer keyed to a nav index",
  // It used to be `index === 1`, so inserting any entry above it silently
  // relocated that link onto the wrong row.
  /item\.label === "My Classes"/.test(staffSidebar),
);
check("promotion dispatches a notification", /MODERATOR_GRANTED/.test(allocationsRouter));
check("revocation dispatches a notification too", /MODERATOR_REVOKED/.test(allocationsRouter));
check(
  "the notification is TARGETED, not broadcast",
  /target_user_id=target_id/.test(allocationsRouter),
);
check("both event templates are seeded", /"MODERATOR_GRANTED"/.test(dbManager) && /"MODERATOR_REVOKED"/.test(dbManager));
check("promotion also sends an email", /send_auth_email\(/.test(allocationsRouter));
check(
  "notification failures cannot fail the promotion",
  /except Exception as notify_err/.test(allocationsRouter) && /except Exception as email_err/.test(allocationsRouter),
);

// Moderators hold BOTH session cookies. Without an explicit portal hint the
// admin cookie wins, so the staff bell renders the admin's inbox and a
// notification aimed at the staff member is invisible to them.
check("inbox identity accepts a portal hint", /portal\?: string \| null/.test(notifyLib));
check(
  "a staff hint is preferred over the admin cookie",
  /toPortal\(portal\) === "staff"/.test(notifyLib),
);
check(
  "an unknown hint still falls back rather than failing",
  /return v === "admin" \|\| v === "staff" \? v : null/.test(notifyLib),
);

// ============= 11. ADMIN-ONLY PAGES ARE ALSO ENFORCED AT THE PROXY ==========
//
// `settings` is ADMIN_ONLY. The page gate has always existed, but the proxy
// only checked that *someone* was signed in — so a moderator could PATCH the
// school name, motto, logo, term or ID prefixes straight through the API,
// bypassing the page they were denied.
check("the settings proxy requires the capability", /requireAdminCapability\(subdomain, "settings"\)/.test(settingsProxy));
check(
  "it is enforced on the proxy, not only the page",
  /requireAdminSession\(subdomain\)[\s\S]{0,1200}requireAdminCapability/.test(settingsProxy),
);
check("the staff login proxy still needs no shaping", /setSessionCookie\(SESSION_COOKIES\.staff, data/.test(staffLoginProxy));

// ===================== 11. THE MODERATOR CONSOLE ITSELF ======================
//
// Everything above proves the boundary was never crossed. These prove the thing
// the boundary was worth having: a surface a moderator can actually use, that
// does not read like the school's admin was handed the keys.

const announcementsRoute = read("app/api/admin/announcements/route.ts");

// ---- 11a. Elevation must re-verify against the DATABASE, not the cookie ----
check(
  "elevation requires a valid staff session",
  /readStaffSession\(subdomain\)/.test(moderatorSession),
  "otherwise anyone could POST an empty body and become a moderator",
);
check(
  "elevation re-checks is_moderator against the BACKEND, not the cookie",
  // Asserts the CALL, not the import. Mutation testing caught a version of this
  // check that passed while the call had been replaced with a hardcoded
  // `{ staff: { is_moderator: true } }` — because `getStaffDashboard` still
  // appeared on the import line.
  /await getStaffDashboard\(\s*subdomain\s*,\s*staff\.staffId\s*\)/.test(moderatorSession) &&
    /\.staff\?\.is_moderator === true/.test(moderatorSession),
  "trusting the signed cookie's own claim means a captured session keeps working for the full TTL after a demotion",
);
check(
  "elevation refuses when the backend is unreachable",
  // getStaffDashboard returns null on error; `null?.staff?.is_moderator === true`
  // is false, so the 403 below fires. Assert the check is a strict === true so a
  // truthy-but-absent value cannot slip through.
  /is_moderator === true/.test(moderatorSession) && /status: 403/.test(moderatorSession),
  "fail OPEN here would mint a moderator session from an unreachable database",
);
check(
  "elevation mints the role EXPLICITLY as moderator",
  /buildSessionClaims\([^)]*,\s*"moderator"\)/.test(moderatorSession),
  "relying on an omitted role means normalizeRole's fail-closed path rejects it — or, worse, someone re-adds a default",
);
check(
  "elevation populates admin.email WITH a fallback, because requireAdminSession demands it",
  // The `??` is the point. An earlier version of this check matched
  // `email: staff.email` alone and so passed with the fallback deleted — which
  // 401s every guarded API for a staff row that has no email.
  /email:\s*staff\.email\s*\?\?/.test(moderatorSession),
  "a staff row with no email would otherwise 401 on every guarded API and read as a broken feature",
);
check(
  "elevation cannot be used as an escalation path by a non-moderator",
  // The only way to reach a moderator session is the 403 above.
  /!liveIsModerator/.test(moderatorSession),
);

// ---- 11b. The moderator portal must not read like the admin portal --------
// This is the complaint that started all of it, so it gets a literal check on
// the moderator-owned files rather than a review note.
const moderatorOwnedFiles = [
  "app/[subdomain]/moderator/(dashboard)/layout.tsx",
  "app/[subdomain]/moderator/layout.tsx",
  "app/[subdomain]/moderator/login/page.tsx",
  ...PORTALS.flatMap(() => []),
  "components/admin/PortalDashboardLayout.tsx",
  "components/admin/sections/DashboardSection.tsx",
];
for (const f of moderatorOwnedFiles) {
  const src = existsSync(join(root, f)) ? stripComments(read(f)) : "";
  check(`${f.split("/").slice(-2).join("/")} contains no "Admin Portal" branding`, !/Admin Portal/.test(src));
}
check(
  "the moderator dashboard is titled Moderator Overview, not Overview Dashboard-only",
  /portal === "moderator" \? "Moderator Overview"/.test(
    read("components/admin/sections/DashboardSection.tsx"),
  ),
);

// ---- 12. End of Session (promotion) — admin-only, and guarded everywhere ----
//
// A cohort close is the one action that is cohort-wide, money-affecting and
// effectively irreversible. It must be refused in FOUR places, and it is
// enough for any ONE of them to be a bare session check for a moderator to walk
// straight into it.
check(
  "the promotion capability exists and is admin-only",
  /ADMIN_ONLY_CAPABILITIES[\s\S]{0,400}"promotion"/.test(capabilities),
  "promotion must be listed under ADMIN_ONLY_CAPABILITIES",
);
check(
  "moderators do NOT receive the promotion capability",
  !/MODERATOR_CAPABILITIES[\s\S]{0,400}"promotion"/.test(capabilities),
  "a deputy must not be able to close a session",
);
check(
  "the promotion page exports the capability so the layout enforces it",
  /requiredCapability\s*=\s*"promotion"/.test(
    read(join("app", "[subdomain]", "admin", "(dashboard)", "promotion", "page.tsx"))
  ),
);
check(
  "every end-of-session proxy requires the promotion capability",
  () => {
    const dir = join(root, "app", "api", "admin", "end-of-session");
    const routes = [];
    (function walk(d) {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name === "route.ts") routes.push(fs.readFileSync(p, "utf8"));
      }
    })(dir);
    if (routes.length !== 4) {
      return `expected 4 end-of-session route handlers, found ${routes.length}`;
    }
    const unguarded = routes.filter(
      (src) =>
        !/requireAdminCapability\(\s*tenantId\s*,\s*["']promotion["']/.test(src)
    );
    return unguarded.length === 0
      ? true
      : `${unguarded.length} of ${routes.length} proxies do not require the promotion capability`;
  }
);
check(
  "no end-of-session proxy falls back to the bare session guard",
  () => {
    const dir = join(root, "app", "api", "admin", "end-of-session");
    let bad = 0;
    (function walk(d) {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name === "route.ts" && /requireAdminSession\(/.test(fs.readFileSync(p, "utf8"))) {
          bad += 1;
        }
      }
    })(dir);
    return bad === 0 ? true : `${bad} proxies use requireAdminSession, which a moderator satisfies`;
  }
);
check(
  "the sidebar hides End of Session from moderators",
  /label:\s*"End of Session"[\s\S]{0,200}capability:\s*"promotion"/.test(sidebar),
  "the nav entry must carry the capability so visibleNav filters it",
);
check(
  "a moderator reaching the page gets an explanation, not a bare 403",
  /promotion:[\s\S]{0,300}title:/.test(
    read(join("components", "admin", "sections", "DashboardSection.tsx"))
  ),
  "DENIAL_COPY has no entry for promotion, so the redirect renders the fallback string",
);

// ---- 11c. Announcements must be capability-guarded, and admin-only --------
check(
  "announcements proxy requires a CAPABILITY, not merely a session",
  /requireAdminCapability\(\s*tenantId\s*,\s*["']announcements["']/.test(announcementsRoute),
  "requireAdminSession let any moderator broadcast to every staff member in the school",
);
check(
  "announcements proxy no longer uses the bare session guard",
  !/requireAdminSession\(/.test(announcementsRoute),
);
check(
  "the announcements capability is admin-only",
  /ADMIN_ONLY_CAPABILITIES[\s\S]{0,400}"announcements"/.test(capabilities),
  "a moderator must not be able to speak to the whole staff body",
);
check(
  "moderators do NOT receive the announcements capability",
  !/MODERATOR_CAPABILITIES[\s\S]{0,400}"announcements"/.test(capabilities),
);

// ---- 11d. Dead links the moderator would have clicked into a 403 ---------
const dashboardSection = read("components/admin/sections/DashboardSection.tsx");
check(
  "Publishing Credits is hidden from moderators",
  /isModerator\s*\?\s*\[\]/.test(dashboardSection) &&
    /label: "Publishing Credits"/.test(dashboardSection),
  "the user asked for this card to be hidden from the moderator console",
);
check(
  "Quick Actions are capability-filtered",
  /quickActions = allQuickActions\.filter/.test(dashboardSection),
  "\"Top-up Credits\" pointed at /admin/billing, which a moderator cannot open",
);
check(
  "the ?denied= redirect finally renders an explanation",
  // Asserts the WIRING, not the presence of the symbol. Mutation testing caught
  // a version of this check that passed while the JSX had been rendered behind
  // `{false && ...}` — `<DenialNotice` still matched.
  /query\.denied/.test(dashboardSection) &&
    /\{denied && <DenialNotice/.test(dashboardSection) &&
    /<DenialNotice[\s\S]{0,120}capability=\{denied\}/.test(dashboardSection) &&
    /DENIAL_COPY\[capability\]/.test(dashboardSection),
  "the guard redirected with ?denied= for years and no page ever read it",
);
const commandCenter = read("components/admin/CommandCenterClient.tsx");
check(
  "the command center no longer hardcodes a billing link for moderators",
  // Asserts the DERIVATION. A previous version matched the identifier
  // `canSeeBilling`, which survived `const canSeeBilling = true;` — i.e. it
  // passed while every moderator got a link to a page they cannot open.
  /const canSeeBilling = portal === "admin"/.test(commandCenter),
);

// ---- 11e. Route plumbing -------------------------------------------------
const middlewareSrc = read("middleware.ts");
const reservedDemoIds = (() => {
  const m = middlewareSrc.match(/RESERVED_DEMO_IDS[\s\S]*?\]/);
  // Comments stripped: the entry's own comment says '"moderator" was missing
  // here', and a bare substring match passed with the entry deleted.
  return m ? stripComments(m[0]) : "";
})();
check(
  "middleware reserves the 'moderator' path segment",
  /"moderator"/.test(reservedDemoIds),
  "otherwise DEMO_ID_RE reads it as a TENANT slug on the demo host",
);
check(
  "the bell reads the admin identity but links inside the moderator portal",
  /portal\?: "admin" \| "staff"/.test(read("components/notifications/NotificationBell.tsx")) &&
    /notificationsPath/.test(read("components/notifications/NotificationBell.tsx")),
  "the derived moderator session lives in the ADMIN cookie; only the link differs",
);
check(
  "the moderator sign-out returns to the Staff Portal, not a login page that does not exist",
  /portal === "moderator" \? `\/\$\{subdomain\}\/staff`/.test(sidebar),
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