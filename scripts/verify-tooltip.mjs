#!/usr/bin/env node
/**
 * InfoTooltip interaction contract.
 *
 * The tooltip is the rare component that is genuinely two different controls.
 * Both were verified live in Chrome at a 375px viewport; this pins the
 * behaviours so a refactor cannot quietly reintroduce the mobile trap.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * ------------------------------
 * `:hover` fires on tap and then latches. A tooltip styled that way opens on
 * a phone with no way to dismiss it, and the first tap can be swallowed
 * trying to open it — so the control reads as broken. Matching on
 * `(hover: hover)` instead of `(pointer: coarse)` does not save you either:
 * a hybrid laptop reports `hover: hover` AND has a touchscreen, which is
 * precisely the device that needs the tap path.
 */
const BASE = process.env.BASE || "https://resultapp.org";
const TENANT = process.env.TENANT || "vhs";
// Billing is admin-only, so the header tooltip needs an admin session. Falls
// back to the moderator so the settings half still runs without admin creds.
const ID = process.env.ADMIN_ID || process.env.MOD_ID || "staff/0098";
const PW = process.env.ADMIN_PW || process.env.MOD_PW || "modpass123";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
};

const CHROME = [
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  process.env.CHROME_PATH,
].filter(Boolean).find((p) => existsSync(p));

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 9344;

// Evaluated in the page. Each step returns observable state after a real
// interaction, because React state updates are async and reading the DOM in the
// same tick reports the PREVIOUS value — which is how "Escape does not work"
// gets misdiagnosed as "Escape is broken".
const PROBE = `(sel) => new Promise(async (resolve) => {
  const t = document.querySelector(sel);
  if (!t) return resolve({ error: "no tooltip trigger" });
  const id = t.getAttribute("aria-controls");
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const isOpen = () => !!document.getElementById(id);
  const out = { pointerCoarse: matchMedia("(pointer: coarse)").matches };
  out.tag = t.tagName;
  out.type = t.getAttribute("type");
  out.hasExpanded = t.getAttribute("aria-expanded") !== null;
  out.hasControls = !!id;
  out.accessibleName = t.getAttribute("aria-label") || (t.querySelector(".sr-only")||{}).textContent || null;

  // start from a known-closed state
  if (isOpen()) { t.click(); await wait(150); }
  out.startsClosed = !isOpen();

  // 1. hover must NOT open it on a touch pointer (would latch, no dismissal)
  t.dispatchEvent(new MouseEvent("mouseenter"));
  await wait(150);
  out.hoverOpened = isOpen();

  // 2. tap toggles it open
  t.click(); await wait(180);
  out.tapOpens = isOpen();
  const p = document.getElementById(id);
  out.role = p ? p.getAttribute("role") : null;
  out.live = p ? p.getAttribute("aria-live") : null;
  out.hasCloseButton = p ? !!p.querySelector('button[aria-label="Close"]') : false;
  out.panelText = p ? p.textContent.trim().length : 0;

  // 3. tapping the trigger again closes it
  t.click(); await wait(180);
  out.secondTapCloses = !isOpen();

  // 4. tap outside dismisses
  t.click(); await wait(180);
  const wasOpen = isOpen();
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await wait(180);
  out.outsideTapDismisses = wasOpen && !isOpen();

  // 5. the explicit close button works (touch has no Escape key)
  if (!isOpen()) { t.click(); await wait(180); }
  const cb = document.querySelector('#' + CSS.escape(id) + ' button[aria-label="Close"]');
  out.closeButtonPresent = !!cb;
  if (cb) { cb.click(); await wait(180); }
  out.closeButtonWorks = !isOpen();

  // 6. Escape closes (keyboard users have no tap)
  t.click(); await wait(180);
  const openBeforeEsc = isOpen();
  t.focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(200);
  out.escapeCloses = openBeforeEsc && !isOpen();

  resolve(out);
})`;

async function main() {
  if (!CHROME) { console.log("  SKIP  Chrome not found"); process.exit(0); }
  const profile = mkdtempSync(join(tmpdir(), "tip-"));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "--hide-scrollbars", "about:blank",
  ], { stdio: "ignore" });

  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250);
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {}
  }
  if (!targets) { chrome.kill(); throw new Error("Chrome did not start"); }

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
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  // mobile: true + touch emulation => (pointer: coarse) is true, which is the
  // branch that actually latches on a naive :hover implementation
  await send("Emulation.setDeviceMetricsOverride", {
    width: 375, height: 780, deviceScaleFactor: 3, mobile: true,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  // authenticate
  await send("Page.navigate", { url: `${BASE}/${TENANT}/admin/login` });
  await sleep(2500);
  await evaluate(`fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({tenantId:"${TENANT}",identifier:"${ID}",password:"${PW}"})}).then(r=>r.status)`);

  for (const [label, path, sel] of [
    ["settings/email", `/${TENANT}/admin/settings`, 'button[aria-controls][aria-expanded]'],
    ["billing/header", `/${TENANT}/admin/billing`, 'button[aria-controls][aria-expanded]'],
  ]) {
    await send("Page.navigate", { url: `${BASE}${path}` });
    await sleep(2500);
    const r = await evaluate(`(${PROBE})(${JSON.stringify(sel)})`);
    console.log(`\n=== ${label} @375px (pointer:${r.pointerCoarse ? "coarse" : "fine"}) ===`);
    if (r.error) { ok(`${label} has a tooltip trigger`, false, r.error); continue; }

    ok(`${label}: trigger is a <button>`, r.tag === "BUTTON" && r.type === "button", `${r.tag}/${r.type}`);
    ok(`${label}: has an accessible name`, !!r.accessibleName, String(r.accessibleName));
    ok(`${label}: declares aria-expanded + aria-controls`, r.hasExpanded && r.hasControls);
    ok(`${label}: tap opens`, r.tapOpens);
    ok(`${label}: panel is role=tooltip, aria-live=polite`, r.role === "tooltip" && r.live === "polite", `${r.role}/${r.live}`);
    ok(`${label}: panel has readable copy`, r.panelText > 40, `${r.panelText} chars`);
    ok(`${label}: hover does NOT latch it open on touch`, !r.hoverOpened);
    ok(`${label}: second tap closes`, r.secondTapCloses);
    ok(`${label}: outside tap dismisses`, r.outsideTapDismisses);
    ok(`${label}: explicit close button present on touch`, r.closeButtonPresent);
    ok(`${label}: close button works`, r.closeButtonWorks);
    ok(`${label}: Escape closes for keyboard users`, r.escapeCloses);
  }

  ws.close(); chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("=".repeat(64));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("verify-tooltip failed:", e.message); process.exit(2); });
