/**
 * Audit page / API auth boundary, against production.
 *
 * The static harness proves the gate is present in source. This proves it is
 * present in the deployed bundle — a gate that never shipped reads exactly
 * like a gate that works.
 */
const BASE = process.env.BASE || "https://resultapp.org";
const T = process.env.TENANT || "vhs";
let pass = 0,
  fail = 0;
const ok = (n, c, d = "") =>
  c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));

(async () => {
  console.log("=== 1. audit PAGE is not renderable without a session ===");
  const page = await fetch(`${BASE}/${T}/admin/audit`, { redirect: "manual" });
  const loc = page.headers.get("location") || "";
  console.log(`  GET /${T}/admin/audit -> ${page.status} ${loc}`);
  ok("page redirects to login rather than rendering", page.status === 307 && loc.includes("login"), `got ${page.status} ${loc}`);

  console.log("\n=== 2. audit API requires the capability, not just a tenant ===");
  const noTenant = await fetch(`${BASE}/api/admin/audit`, { redirect: "manual" });
  console.log(`  no tenant_id   -> ${noTenant.status}`);
  ok("missing tenant_id is rejected", noTenant.status === 400, `got ${noTenant.status}`);

  const withTenant = await fetch(`${BASE}/api/admin/audit?tenant_id=${T}`, { redirect: "manual" });
  const wt = await withTenant.text();
  console.log(`  with tenant_id -> ${withTenant.status}  ${wt.slice(0, 90)}`);
  ok(
    "authenticated-tenant request without a session is refused",
    withTenant.status === 401 || withTenant.status === 403 || withTenant.status === 307,
    `got ${withTenant.status}: ${wt.slice(0, 80)}`
  );

  console.log("\n=== 3. no audit data leaks into any public surface ===");
  for (const p of ["/", `/${T}`, `/${T}/login`, `/${T}/admin/login`]) {
    const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
    const body = await r.text();
    const leaked = /results\.publish|clearance\.held|roster\.student_purged/.test(body);
    console.log(`  ${p.padEnd(22)} -> ${r.status} ${leaked ? "LEAKED AUDIT ACTION" : "clean"}`);
    ok(`${p} contains no audit rows`, !leaked);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
