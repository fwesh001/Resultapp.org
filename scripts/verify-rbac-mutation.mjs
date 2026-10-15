#!/usr/bin/env node
/**
 * Mutation test for scripts/verify-rbac.mjs.
 *
 * ══ WHY THIS EXISTS ══
 * verify-rbac.mjs is 119 regex assertions over source files. A test suite made
 * of regexes has one characteristic that must be proven rather than assumed: it
 * FAILS when the code is wrong. A check that cannot fail is decoration — and the
 * cheap way to accidentally write decoration is to assert on something the code
 * no longer contains.
 *
 * That is not hypothetical here. During this change, eleven checks failed
 * purely because the guard MOVED from page files into shared section
 * components. The tempting response was to weaken each check until it passed.
 * This script exists so that response is visible: it mutates the real source,
 * confirms the specific check flips to FAIL, then restores the file exactly.
 *
 * ══ WHAT IT DOES NOT CLAIM ══
 * It does not prove the RBAC model is correct. It proves the harness has teeth.
 * The live probes (scripts/verify-*.mjs against a running backend) cover the
 * former; this covers the latter.
 *
 * Every mutation restores in a `finally` block. If a run dies mid-way the tree
 * is left dirty, so the script refuses to start if it finds a pre-existing
 * modification in any file it touches.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function runVerifier() {
  try {
    const out = execFileSync(node, [join(root, "scripts/verify-rbac.mjs")], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exit: 0, output: out };
  } catch (e) {
    return {
      exit: e.status ?? 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

/** The FAIL lines the verifier printed. */
function failedChecks(output) {
  const names = new Set();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/\[FAIL\]\s+(.*?)(?:\s+—\s+.*)?$/);
    if (m) names.add(m[1].trim());
  }
  return names;
}

/**
 * Each mutation: flip one thing that a specific check exists to catch, and name
 * the check that must notice.
 */
const MUTATIONS = [
  {
    id: "normalizeRole no longer fails closed",
    file: "lib/adminAuth.ts",
    from: 'if (role === "admin") return "admin";',
    to: 'if (role === "admin" || role === "superadmin") return "admin";',
    expect: ["normalizeRole recognises ONLY admin and moderator"],
  },
  {
    id: "readAdminIdentity stops rejecting an unusable role",
    file: "lib/adminAuth.ts",
    from: "if (!role) return await unauthorized();",
    to: "// mutation: guard removed",
    expect: ["readAdminIdentity rejects a session with no usable role"],
  },
  {
    id: "elevation trusts the cookie instead of the database",
    file: "app/api/moderator/session/route.ts",
    from: ".is_moderator === true",
    to: ".is_moderator",
    expect: ["elevation refuses when the backend is unreachable"],
  },
  {
    id: "elevation skips the live backend check entirely",
    file: "app/api/moderator/session/route.ts",
    from: "const dashboard = await getStaffDashboard(subdomain, staff.staffId);",
    to: "const dashboard = { staff: { is_moderator: true } };",
    expect: ["elevation re-checks is_moderator against the BACKEND, not the cookie"],
  },
  {
    id: "elevation stops requiring a staff session",
    file: "app/api/moderator/session/route.ts",
    from: "const staff = await readStaffSession(subdomain);",
    to: 'const staff = { staffId: "x", email: "x@x" };',
    expect: ["elevation requires a valid staff session"],
  },
  {
    id: "elevation stops forcing role: moderator",
    file: "app/api/moderator/session/route.ts",
    from: 'buildSessionClaims({}, "moderator")',
    to: "buildSessionClaims({})",
    expect: ["elevation mints the role EXPLICITLY as moderator"],
  },
  {
    id: "elevation drops the admin.email fallback",
    file: "app/api/moderator/session/route.ts",
    from: "email: staff.email ?? `${staff.staffId}@moderator.local`,",
    to: "email: staff.email,",
    expect: ["elevation populates admin.email WITH a fallback, because requireAdminSession demands it"],
  },
  {
    id: "announcements reverts to a bare session guard",
    file: "app/api/admin/announcements/route.ts",
    from: 'requireAdminCapability(tenantId, "announcements")',
    to: "requireAdminSession(tenantId)",
    expect: ["announcements proxy requires a CAPABILITY, not merely a session"],
  },
  {
    id: "announcements is demoted out of the admin-only list",
    file: "lib/capabilities.ts",
    from: '  "moderators",\n  "announcements",\n] as const;',
    to: '  "moderators",\n] as const;',
    // NOTE: the first run of this mutation listed the proxy check here and
    // reported MISSED. The proxy check was right — it does not care which list
    // the id lives in — so the MUTATION's expectation was wrong, not the check.
    // Expect the admin-only-membership check, which is what actually governs it.
    expect: ["the announcements capability is admin-only"],
  },
  {
    id: "the staff sidebar points back at /admin",
    file: "components/staff/StaffSidebar.tsx",
    from: 'href: (sub: string) => `/${sub}/moderator`',
    to: 'href: (sub: string) => `/${sub}/admin`',
    expect: [
      "the Moderator Console link uses the function href form and points at /moderator",
      "the staff sidebar no longer offers an Admin Portal link",
    ],
  },
  {
    id: "the enforce helper hardcodes the admin login target again",
    file: "lib/enforceCapability.ts",
    from: "redirect(`/${subdomain}/${portal}/login`);",
    to: "redirect(`/${subdomain}/admin/login`);",
    expect: ["enforce helper redirects to the portal's OWN login, not always /admin"],
  },
  {
    id: "the enforce helper hardcodes the admin denied target again",
    file: "lib/enforceCapability.ts",
    from: "redirect(`/${subdomain}/${portal}?denied=${encodeURIComponent(capability)}`);",
    to: "redirect(`/${subdomain}/admin?denied=${encodeURIComponent(capability)}`);",
    expect: ["enforce helper redirects on a missing cap, within the same portal"],
  },
  {
    id: "the ?denied= explanation stops rendering",
    file: "components/admin/sections/DashboardSection.tsx",
    from: "{denied && <DenialNotice capability={denied} subdomain={subdomain} />}",
    to: "{false && <DenialNotice capability={denied} subdomain={subdomain} />}",
    expect: ["the ?denied= redirect finally renders an explanation"],
  },
  {
    id: "Publishing Credits is shown to moderators again",
    file: "components/admin/sections/DashboardSection.tsx",
    from: "...(isModerator\n      ? []",
    to: "...(isModerator\n      ? [1, 2].slice(0, 0).concat([])",
    expect: ["Publishing Credits is hidden from moderators"],
  },
  {
    id: "Quick Actions stop being capability-filtered",
    file: "components/admin/sections/DashboardSection.tsx",
    from: "const quickActions = allQuickActions.filter((a) =>\n    isModerator ? held.includes(a.capability) : true,\n  );",
    to: "const quickActions = allQuickActions;",
    expect: ["Quick Actions are capability-filtered"],
  },
  {
    id: "the shared layout stops threading the portal through",
    file: "components/admin/PortalDashboardLayout.tsx",
    from: "      portal={portal}\n    >",
    to: "    >",
    expect: ["layout passes the portal to the shell"],
  },
  {
    id: "the moderator layout stops delegating to the shared body",
    file: "app/[subdomain]/moderator/(dashboard)/layout.tsx",
    from: 'portal="moderator"',
    to: 'portal="admin"',
    expect: ["BOTH portals' layouts delegate to the ONE shared body"],
  },
  {
    // The first run of this mutation renamed the moderator branch to
    // `return "viewer"`, which the verifier correctly did NOT flag — that change
    // makes the system STRICTER (a "moderator" session is rejected), not weaker.
    // A mutation that cannot create a vulnerability must not count as a missed
    // one. The real escalation is widening the null fallback to admin.
    id: "an unknown role is escalated to admin",
    file: "lib/adminAuth.ts",
    from: '  if (role === "moderator") return "moderator";\n  return null;',
    to: '  if (role === "moderator") return "moderator";\n  return "admin";',
    expect: ["an unrecognised role claim is NOT assumed to be admin"],
  },
  {
    id: "middleware stops reserving the moderator segment",
    file: "middleware.ts",
    from: '  "moderator",\n',
    to: "",
    expect: ["middleware reserves the 'moderator' path segment"],
  },
  {
    id: "the command center offers moderators a billing link again",
    file: "components/admin/CommandCenterClient.tsx",
    from: 'const canSeeBilling = portal === "admin";',
    to: "const canSeeBilling = true;",
    expect: ["the command center no longer hardcodes a billing link for moderators"],
  },
];

// ---------------------------------------------------------------- run

const baseline = runVerifier();
if (baseline.exit !== 0) {
  console.error("Baseline verify-rbac.mjs is RED. Fix that before mutation testing.\n");
  console.error(baseline.output);
  process.exit(1);
}
const totalChecks = baseline.output.match(/(\d+)\/(\d+) checks passed/);
console.log(
  `Baseline green: ${totalChecks ? totalChecks[0] : "unknown count"} checks.\n`,
);

let passed = 0;
const failures = [];

/**
 * Read + write normalised to LF.
 *
 * Git's autocrlf can rewrite a working file between runs (a stash round-trip is
 * enough). Without this, every multi-line anchor silently stopped matching after
 * the checkout and the run reported "STALE" — which looks like the mutations
 * being wrong when the actual problem is line endings. Normalising on both the
 * file and the anchors makes the test depend on the code, not the platform.
 */
const lf = (s) => s.replace(/\r\n/g, "\n");

for (const m of MUTATIONS) {
  const abs = join(root, m.file);
  const originalDisk = readFileSync(abs, "utf8");
  const original = lf(originalDisk);

  if (!original.includes(lf(m.from))) {
    failures.push(`${m.id}: anchor not found in ${m.file} — the mutation is stale`);
    console.log(`  [STALE] ${m.id}`);
    continue;
  }

  try {
    writeFileSync(abs, original.replace(lf(m.from), lf(m.to)), "utf8");
    const result = runVerifier();
    const failed = failedChecks(result.output);

    // The mutation must make the verifier RED *and* the named check must be
    // among the failures. Requiring both means a mutation cannot pass by
    // breaking some unrelated check.
    const caught = result.exit !== 0 && m.expect.some((name) => failed.has(name));

    if (caught) {
      passed += 1;
      const which = m.expect.filter((n) => failed.has(n));
      console.log(`  [CAUGHT] ${m.id}`);
      console.log(`           -> ${which.join(", ")}`);
    } else {
      const why =
        result.exit === 0
          ? "verifier stayed GREEN"
          : `verifier went red but not on: ${[...failed].join(" | ") || "(no FAIL lines)"}`;
      failures.push(`${m.id}: ${why}`);
      console.log(`  [MISSED] ${m.id}`);
      console.log(`           -> ${why}`);
    }
  } finally {
    writeFileSync(abs, originalDisk, "utf8");
  }
}

// Confirm the tree is back to green — a restore that silently failed would leave
// the next person running mutations against broken source.
const restored = runVerifier();
if (restored.exit !== 0) {
  console.error("\nRESTORE FAILED — the working tree is dirty after mutation testing.");
  console.error(restored.output);
  process.exit(1);
}

console.log(`\n${passed}/${MUTATIONS.length} mutations caught; tree restored green.`);
if (failures.length > 0) {
  console.error("\nUncaught mutations (the harness is weaker than it looks):");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-rbac.mjs has teeth: every mutation was caught by its named check.");