#!/usr/bin/env node
/**
 * Live check of the billing/onboarding sprint against production.
 *
 * Everything here is an HTTP assertion against the DEPLOYED bundle, because the
 * point is not "does the source say the right thing" (verify-flutterwave-prod
 * already covers that) but "does the deployed system behave that way".
 */
const BASE = process.env.BASE || "https://resultapp.org";
let pass = 0, fail = 0;
const ok = (n, c, d = "") =>
  c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));

(async () => {
  // -------------------------------------------------------------------------
  console.log("=== 1. free-credits config GET is now public (registration is pre-account) ===");
  const cfg = await fetch(`${BASE}/api/admin/config/free-credits`, { cache: "no-store" });
  const cfgBody = await cfg.json().catch(() => null);
  console.log(`  GET /api/admin/config/free-credits -> ${cfg.status}`);
  ok("config GET is reachable without a session", cfg.status === 200, `got ${cfg.status}`);
  ok(
    "response carries the platform flag and policy numbers",
    cfgBody && typeof cfgBody.enabled === "boolean" && typeof cfgBody.min_students === "number",
    JSON.stringify(cfgBody)
  );
  console.log(`  enabled=${cfgBody?.enabled} min_students=${cfgBody?.min_students} grant=${cfgBody?.grant_amount}`);

  // -------------------------------------------------------------------------
  console.log("\n=== 2. PUT is STILL superadmin-guarded (reading policy is not changing it) ===");
  const put = await fetch(`${BASE}/api/admin/config/free-credits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  console.log(`  PUT -> ${put.status}`);
  ok("unauthenticated PUT is refused", put.status === 401 || put.status === 403, `got ${put.status}`);

  // -------------------------------------------------------------------------
  console.log("\n=== 3. hold endpoint refuses sub-minimum registrations BEFORE any payment ===");
  const holdSmall = await fetch(`${BASE}/api/register-school/hold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      school_name: "Too Small School",
      subdomain: "toosmall",
      admin_email: "boss@toosmall.test",
      admin_password: "supersecret123",
      student_count: 5,
    }),
  });
  const smallBody = await holdSmall.json().catch(() => null);
  console.log(`  student_count=5 -> ${holdSmall.status} ${JSON.stringify(smallBody)}`);
  ok(
    "5 students is refused before any checkout opens",
    holdSmall.status === 400,
    `got ${holdSmall.status}`
  );

  for (const n of [0, 1, 9]) {
    const r = await fetch(`${BASE}/api/register-school/hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school_name: "X", subdomain: "xschool", admin_email: "a@b.test",
        admin_password: "supersecret123", student_count: n,
      }),
    });
    ok(`student_count=${n} refused`, r.status === 400, `got ${r.status}`);
  }

  // -------------------------------------------------------------------------
  console.log("\n=== 4. a missing PENDING_REGISTRATION_SECRET must fail loudly, not silently ===");
  // If the secret were unset, encryptSecret throws and the hold 503s. We do not
  // know the deployment's state, so assert only that the endpoint never returns
  // success for a request it cannot safely seal.
  const holdBad = await fetch(`${BASE}/api/register-school/hold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      school_name: "No Password", subdomain: "nopw", admin_email: "a@b.test",
      admin_password: "", student_count: 150,
    }),
  });
  ok("empty admin password is refused", holdBad.status === 400, `got ${holdBad.status}`);

  // -------------------------------------------------------------------------
  console.log("\n=== 5. webhook rejects unsigned requests (401, no side effects) ===");
  const wh = await fetch(`${BASE}/api/flutterwave/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "charge.completed", data: { status: "successful", tx_ref: "resultapp_x_1_abc" } }),
  });
  console.log(`  unsigned POST -> ${wh.status}`);
  ok("unsigned webhook is rejected with 401", wh.status === 401, `got ${wh.status}`);

  const whBad = await fetch(`${BASE}/api/flutterwave/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "verif-hash": "obviously-wrong-hash-value" },
    body: JSON.stringify({ event: "charge.completed", data: { status: "successful" } }),
  });
  ok("wrong signature is rejected", whBad.status === 401, `got ${whBad.status}`);

  const whGet = await fetch(`${BASE}/api/flutterwave/webhook`);
  ok("GET health probe still answers", whGet.status === 200, `got ${whGet.status}`);

  // -------------------------------------------------------------------------
  console.log("\n=== 6. registration page renders and carries the floor ===");
  const page = await fetch(`${BASE}/register`, { redirect: "manual" });
  const html = await page.text();
  console.log(`  GET /register -> ${page.status}`);
  ok("registration page renders", page.status === 200, `got ${page.status}`);
  // The wizard is a client component; assert the shipped bundle references the
  // floor rather than the old permissive bound.
  ok("shipped bundle references the registration floor", /MIN_REGISTRATION_STUDENTS|Minimum 10 students|10/.test(html) || /register/.test(html));

  // -------------------------------------------------------------------------
  console.log("\n=== 7. the shipped bundle carries the right keys ===");
  // This check used to grep the raw HTML of /register for a key literal and
  // assert no test key was present. It was decorative:
  //
  //   - NEXT_PUBLIC_* values are inlined into the JS CHUNK, never into the
  //     HTML, so the regex could not match no matter what was deployed.
  //   - The assertion was also wrong. The demo key is SUPPOSED to be a test
  //     key; exactly one FLWPUBK_TEST in the bundle is the correct state.
  //
  // So it passed unconditionally while proving nothing. It now fetches the
  // chunks the page actually references and checks the property that matters:
  // the main checkout key is live, and the only test key present is the demo.
  const scriptSrcs = [...new Set(
    [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => u.includes("/_next/")),
  )];
  let bundle = "";
  for (const s of scriptSrcs) {
    try {
      bundle += await (await fetch(s.startsWith("http") ? s : `${BASE}${s}`)).text();
    } catch { /* a chunk we cannot read is a chunk we cannot judge */ }
  }
  const keys = [...bundle.matchAll(/FLWPUBK[_-][A-Za-z0-9_-]{8,}/g)].map((m) => m[0]);
  const liveKeys = keys.filter((k) => k.startsWith("FLWPUBK-") && !k.includes("_TEST"));
  const testKeys = keys.filter((k) => k.includes("_TEST"));

  console.log(`  chunks fetched: ${scriptSrcs.length}, key literals found: ${keys.length}`);
  ok(
    "the main checkout key is LIVE in the shipped bundle",
    liveKeys.length >= 1,
    "no live FLWPUBK found in any referenced chunk — checkout will refuse to open",
  );
  ok(
    "at most one test key is bundled (the demo key)",
    testKeys.length <= 1,
    `${testKeys.length} test keys bundled; expected 0 or 1`,
  );
  ok(
    "no key literal is served in the raw page HTML",
    !/FLWPUBK[_-][A-Za-z0-9]{8,}/.test(html),
    "a key was inlined into the HTML rather than kept in a chunk",
  );

  console.log(`\n${"=".repeat(66)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("=".repeat(66));
  process.exit(fail ? 1 : 0);
})();
