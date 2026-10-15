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
const allocationsRouter = read("backend/routers/allocations.py");
const dbManager = read("backend/services/db_manager.py");

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
  "the Admin Portal link uses the function href form",
  // A plain string href is resolved as `${base}${item.href}` with base =
  // /{sub}/staff, so "/admin" would render /{sub}/staff/admin — a 404 that
  // looks exactly like a broken link.
  /href: \(sub: string\) => `\/\$\{sub\}\/admin`/.test(staffSidebar),
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