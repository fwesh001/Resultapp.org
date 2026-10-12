#!/usr/bin/env node
/**
 * Layout invariants at real viewport widths, measured with a real layout engine.
 *
 * A class name can be correct in source and still produce a double-scrolling
 * column once nested inside `flex-1 overflow-y-auto`. These are geometry
 * assertions, so they need a browser, not a regex.
 *
 * Drives the system Chrome over CDP on a throwaway debug port -- no new npm
 * dependencies, no download of a second browser.
 *
 * Usage: node scripts/verify-mobile-layout.mjs [--base https://host] [--tenant vhs]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i > -1 && argv[i + 1] ? argv[i + 1] : d;
};
const BASE = arg("--base", process.env.BASE || "https://resultapp.org");
const TENANT = arg("--tenant", process.env.TENANT || "vhs");
const PORT = Number(arg("--port", "9333"));
const WIDTHS = (arg("--widths", "375,414,768") || "").split(",").map(Number);
const HEAD = arg("--head", "1") !== "0";

const CHROME = [
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  process.env.CHROME_PATH,
].filter(Boolean).find((p) => existsSync(p));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
};

const MEASURE = `(() => {
  const main = document.querySelector("main");
  if (!main) return { error: "no <main> — page is not the admin shell" };
  const inner = main.firstElementChild;
  const cs = inner ? getComputedStyle(inner) : null;
  const mainCS = getComputedStyle(main);
  const de = document.documentElement;
  const vr = window.innerWidth;
  // Any element sticking out past the viewport, for naming in the failure msg.
  const offenders = [];
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > vr + 1 || r.left < -1)) {
      const tag = el.tagName.toLowerCase();
      const cls = (el.className && typeof el.className === "string")
        ? el.className.split(" ").slice(0, 3).join(" ") : "";
      offenders.push(tag + (cls ? "." + cls.replace(/[^a-zA-Z0-9_-]/g, "") : ""));
      if (offenders.length > 3) break;
    }
  }
  return {
    overflowY: mainCS.overflowY,
    mainScrollH: main.scrollHeight,
    mainClientH: main.clientHeight,
    innerMinHeight: cs ? cs.minHeight : null,
    innerHeight: cs ? cs.height : null,
    innerPadL: cs ? cs.paddingLeft : null,
    innerPadR: cs ? cs.paddingRight : null,
    innerMaxW: cs ? cs.maxWidth : null,
    innerW: inner ? Math.round(inner.getBoundingClientRect().width) : null,
    mainW: Math.round(main.getBoundingClientRect().width),
    hOverflow: de.scrollWidth > de.clientWidth + 1,
    docScrollW: de.scrollWidth,
    docClientW: de.clientWidth,
    offenders,
  };
})()`;

async function main() {
  if (!CHROME) {
    console.log("  SKIP  Chrome not found — set CHROME_PATH");
    process.exit(0);
  }
  const profile = mkdtempSync(join(tmpdir(), "cdp-"));
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "about:blank",
  ];
  const chrome = spawn(CHROME, HEAD ? args : args.filter((a) => a !== "--headless=new"), {
    stdio: "ignore",
  });

  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
    } catch { /* not up yet */ }
  }
  if (!targets) { chrome.kill(); throw new Error("Chrome CDP did not start"); }

  const page = targets.find((t) => t.type === "page") || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 375, height: 780, deviceScaleFactor: 2, mobile: true,
  });

  const pages = [
    ["dashboard", `/${TENANT}/admin`],
    ["settings", `/${TENANT}/admin/settings`],
    ["billing", `/${TENANT}/admin/billing`],
  ];

  for (const w of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: w, height: 780, deviceScaleFactor: 2, mobile: w < 768,
    });
    console.log(`\n=== ${w}px ===`);
    for (const [label, path] of pages) {
      await send("Page.navigate", { url: `${BASE}${path}` });
      await sleep(1800);
      const r = await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
      const m = r.result.value;
      if (m.error) { console.log(`  ${label.padEnd(10)} ${m.error}`); continue; }

      console.log(
        `  ${label.padEnd(10)} min-h=${String(m.innerMinHeight).padEnd(9)} ` +
        `pad=${String(m.innerPadL).padEnd(7)} w=${String(m.innerW).padEnd(4)}/` +
        `${String(m.mainW).padEnd(4)} hOverflow=${m.hOverflow ? "YES" : "no"}`
      );
      const nested = /100(vh|dvh|svh)|min-h-screen/.test(String(m.innerMinHeight));
      ok(`${label}@${w}px has no viewport height of its own`, !nested, `min-height:${m.innerMinHeight}`);
      ok(`${label}@${w}px does not scroll horizontally`, !m.hOverflow,
        `${m.docScrollW}>${m.docClientW} via ${(m.offenders || []).join(", ")}`);
    }
  }

  ws.close();
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("=".repeat(64));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("verify-mobile-layout failed:", e.message);
  process.exit(2);
});
