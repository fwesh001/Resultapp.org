#!/usr/bin/env node
/**
 * Determines whether PRODUCTION is actually serving live or test Flutterwave
 * keys, by reading the deployed client bundle.
 *
 * Why this matters enough to write a script for: `NEXT_PUBLIC_*` values are
 * inlined into the client bundle at BUILD time. Setting the variable in the
 * dashboard does nothing until a rebuild. So "the env var is set" and
 * "production is live" are different claims, and only the bundle settles it.
 *
 * SCANNING SEVERAL PAGES, NOT ONE. An earlier version of this scanned only the
 * homepage and reported "no key found in the bundle at all" on a perfectly live
 * deployment. The key is inlined into RegisterSchoolForm, which Next.js splits
 * into a chunk the homepage never requests — so the homepage genuinely does not
 * contain it. A check that reports absence of a key as a failure will happily
 * report a false one, and the fix is to look where the key actually lives.
 *
 * Only key PREFIXES are extracted. No full key is ever printed or stored.
 */
const BASE = process.env.BASE || "https://resultapp.org";

/**
 * Pages that can pull in checkout. The registration page is the one that
 * matters; the homepage is kept because it is the cheapest signal that a
 * build happened at all.
 */
const PAGES = [
  { path: "/", label: "homepage" },
  { path: "/register", label: "registration" },
];

function classify(key) {
  if (!key) return "absent";
  if (key.includes("_TEST")) return "TEST";
  if (/^FLWPUBK-[A-Za-z0-9]{10,}/.test(key)) return "LIVE";
  if (key.includes("xxxx")) return "PLACEHOLDER";
  return "unknown";
}

(async () => {
  const allScripts = new Map(); // url -> Set of pages that reference it

  for (const { path, label } of PAGES) {
    let html;
    try {
      html = await (await fetch(BASE + path, { redirect: "follow" })).text();
    } catch (e) {
      console.log(`  ! could not fetch ${label} (${path}): ${e.message}`);
      continue;
    }
    const found = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g))
      .map((m) => m[1])
      .filter((u) => u.startsWith("/") || u.includes("resultapp.org"));
    if (!found.length) {
      console.log(`  ! ${label} returned no scripts (${path})`);
      continue;
    }
    for (const s of found) {
      const url = s.startsWith("http") ? s : BASE + s;
      if (!allScripts.has(url)) allScripts.set(url, new Set());
      allScripts.get(url).add(label);
    }
    console.log(`  ${label.padEnd(14)} ${found.length} script(s)`);
  }

  console.log(`  scanning ${allScripts.size} unique bundle(s) across ${PAGES.length} page(s)`);

  let live = null, test = null, placeholder = null, liveCount = 0;
  for (const [url, pages] of allScripts) {
    let body;
    try {
      body = await (await fetch(url)).text();
    } catch {
      continue;
    }
    const file = url.split("/").pop();
    const where = [...pages].join("+");
    for (const m of body.matchAll(/FLWPUBK[_-][A-Za-z0-9_-]{8,}/g)) {
      const k = m[0];
      const mode = classify(k);
      if (mode === "LIVE") {
        liveCount++;
        live ??= { file, where, prefix: k.slice(0, 12) + "…" };
      }
      if (mode === "TEST") test ??= { file, where, prefix: k.slice(0, 12) + "…" };
      if (mode === "PLACEHOLDER") placeholder ??= { file };
    }
  }

  console.log("");
  console.log(`  LIVE public key present:       ${live ? `yes  (${live.prefix} in ${live.file}, on ${live.where})` : "NO"}`);
  console.log(`  TEST public key present:       ${test ? `yes  (${test.prefix} in ${test.file}, on ${test.where})` : "no"}`);
  console.log(`  PLACEHOLDER key present:       ${placeholder ? `yes  (in ${placeholder.file})` : "no"}`);
  console.log(`  distinct live keys in bundle:  ${liveCount}`);

  console.log("");
  if (live) {
    console.log("  ✅ PRODUCTION IS ON LIVE KEYS.");
    if (test) {
      console.log("     A test key also appears — expected: that is the demo/test key,");
      console.log("     which must stay test-mode. Exactly one is correct.");
      if (liveCount > 1) {
        console.log(`     ⚠️  ${liveCount} live keys found — more than one main key is bundled.`);
      }
    }
  } else if (test) {
    console.log("  ⚠️  PRODUCTION IS STILL ON TEST KEYS.");
    console.log("     Either the live public key was never set on Vercel, or no rebuild");
    console.log("     has happened since (NEXT_PUBLIC_* is inlined at BUILD time —");
    console.log("     saving the variable in the dashboard does not update the bundle).");
  } else {
    console.log("  ⚠️  No Flutterwave public key found in any scanned bundle.");
    console.log("     Checkout will refuse to open — which is the intended fail-closed");
    console.log("     behaviour, but it means the key is not configured for this build.");
    console.log("     Note: both the homepage AND /register were scanned, so this is a");
    console.log("     real absence rather than a chunk the scan missed.");
  }

  process.exit(live ? 0 : 1);
})();
