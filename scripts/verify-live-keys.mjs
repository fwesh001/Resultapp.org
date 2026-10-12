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
 * Only key PREFIXES are extracted. No full key is ever printed or stored.
 */
const BASE = process.env.BASE || "https://resultapp.org";

function classify(key) {
  if (!key) return "absent";
  if (key.includes("_TEST")) return "TEST";
  if (/^FLWPUBK-[A-Za-z0-9]{10,}/.test(key)) return "LIVE";
  if (key.includes("xxxx")) return "PLACEHOLDER";
  return "unknown";
}

(async () => {
  const home = await fetch(BASE, { redirect: "follow" });
  const html = await home.text();

  // Every same-origin script the page ships.
  const scripts = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g))
    .map((m) => m[1])
    .filter((u) => u.startsWith("/") || u.includes("resultapp.org"));

  console.log(`  scanning ${scripts.length} script bundle(s) on ${BASE}`);

  let live = null, test = null, placeholder = null;
  for (const src of scripts) {
    const url = src.startsWith("http") ? src : BASE + src;
    let body;
    try {
      body = await (await fetch(url)).text();
    } catch {
      continue;
    }
    for (const m of body.matchAll(/FLWPUBK[_-][A-Za-z0-9_-]{8,}/g)) {
      const k = m[0];
      const mode = classify(k);
      if (mode === "LIVE") live ??= { src: src.split("/").pop(), prefix: k.slice(0, 12) + "…" };
      if (mode === "TEST") test ??= { src: src.split("/").pop(), prefix: k.slice(0, 12) + "…" };
      if (mode === "PLACEHOLDER") placeholder ??= { src: src.split("/").pop() };
    }
  }

  console.log("");
  console.log(`  LIVE public key present:       ${live ? `yes  (${live.prefix} in ${live.src})` : "NO"}`);
  console.log(`  TEST public key present:       ${test ? `yes  (${test.prefix} in ${test.src})` : "no"}`);
  console.log(`  PLACEHOLDER key present:       ${placeholder ? `yes  (in ${placeholder.src})` : "no"}`);

  // The demo key is EXPECTED to be test. The main key must not be.
  const liveCount = await (async () => {
    // Both keys are inlined, so count distinct live occurrences.
    let n = 0;
    for (const src of scripts) {
      const url = src.startsWith("http") ? src : BASE + src;
      let body; try { body = await (await fetch(url)).text(); } catch { continue; }
      for (const m of body.matchAll(/FLWPUBK-[A-Za-z0-9]{20,}/g)) if (classify(m[0]) === "LIVE") n++;
    }
    return n;
  })();

  console.log("");
  if (live) {
    console.log("  ✅ PRODUCTION IS ON LIVE KEYS.");
    if (test) {
      console.log("     A test key also appears — expected if the demo key is configured.");
    }
  } else if (test) {
    console.log("  ⚠️  PRODUCTION IS STILL ON TEST KEYS.");
    console.log("     Either the live public key was never set on Vercel, or no rebuild");
    console.log("     has happened since (NEXT_PUBLIC_* is inlined at BUILD time —");
    console.log("     saving the variable in the dashboard does not update the bundle).");
  } else {
    console.log("  ⚠️  No Flutterwave public key found in the bundle at all.");
    console.log("     Checkout will refuse to open — which is the intended fail-closed");
    console.log("     behaviour, but it means the key is not configured for this build.");
  }

  process.exit(live ? 0 : 1);
})();
