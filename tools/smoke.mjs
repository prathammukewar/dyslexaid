#!/usr/bin/env node
/* Smoke test: loads the unpacked extension into real Chrome and walks
   the first-run flow the way a new user would. No dependencies; it
   speaks the DevTools protocol over a pipe.

   Usage:  node tools/smoke.mjs
   Env:    CHROME       path to a Chrome or Chromium binary
           SMOKE_TMP    where to put the throwaway profile
           SMOKE_SHOTS  folder to save screenshots into (optional) */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SMOKE_SHOTS;
const profile = fs.mkdtempSync(
  path.join(process.env.SMOKE_TMP || os.tmpdir(), "dyslexaid-smoke-")
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = "") =>
  results.push({ name, ok: Boolean(ok), detail: String(detail ?? "") });

/* ---------- a static server for the demo page and the website ---------- */
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".png": "image/png", ".woff2": "font/woff2",
};
const server = http.createServer((req, res) => {
  let file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ---------- Chrome over a DevTools pipe ---------- */
const chrome = spawn(
  CHROME,
  [
    "--headless=new", "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--disk-cache-size=1", "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] }
);
const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
fromChrome.setEncoding("utf8");

let nextId = 1;
const pending = new Map();
const errors = new Map(); // sessionId -> messages
let buffer = "";
fromChrome.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.get(msg.sessionId)?.push(d.exception?.description || d.text);
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      errors.get(msg.sessionId)?.push(`${msg.params.entry.text} ${msg.params.entry.url || ""}`);
    }
  }
});
function send(method, params = {}, sessionId) {
  const id = nextId++;
  toChrome.write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

async function attach(targetId) {
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  errors.set(sessionId, []);
  await send("Runtime.enable", {}, sessionId);
  await send("Log.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  return sessionId;
}
async function evaluate(s, expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s);
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}
async function waitFor(s, expression, ms = 5000) {
  const deadline = Date.now() + ms;
  let value;
  do {
    try { value = await evaluate(s, expression); } catch { value = undefined; }
    if (value) return value;
    await sleep(100);
  } while (Date.now() < deadline);
  return value;
}
const loaded = (s) => waitFor(s, 'document.readyState === "complete"');
async function open(url) {
  const { targetId } = await send("Target.createTarget", { url });
  const s = await attach(targetId);
  await loaded(s);
  return s;
}
/* Reload after attaching, so errors thrown while the page loads are seen. */
async function reload(s) {
  errors.set(s, []);
  await send("Page.reload", {}, s);
  await sleep(300);
  await loaded(s);
  await sleep(400);
}
async function shot(s, name) {
  if (!SHOTS) return;
  const { data } = await send("Page.captureScreenshot", { format: "png" }, s);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(data, "base64"));
}

const ATTR = (name) => `document.documentElement.getAttribute("data-dyslexaid-${name}")`;
const FONT_LOADED = `document.fonts.load('40px "OpenDyslexic"').then(
  (faces) => faces.length > 0 && faces.every((f) => f.status === "loaded"), () => false)`;
const BOLD_COUNT = 'document.querySelectorAll("b.dyslexaid-bionic").length';

try {
  /* 1. A tab that is already open when the extension gets installed. */
  const oldTab = await open(`${base}/demo/demo.html?old`);

  /* 2. Install. */
  const { id } = await send("Extensions.loadUnpacked", { path: ROOT });
  check("extension loads in real Chrome", id, id);

  /* 3. The welcome page should open by itself. */
  let welcomeTarget;
  for (let i = 0; i < 120 && !welcomeTarget; i++) {
    const { targetInfos } = await send("Target.getTargets");
    welcomeTarget = targetInfos.find((t) => t.url.includes(`${id}/welcome/welcome.html`));
    if (!welcomeTarget) await sleep(100);
  }
  check("welcome page opens on install", welcomeTarget);
  const welcome = await attach(welcomeTarget.targetId);
  await reload(welcome);
  check("welcome page loads without errors", errors.get(welcome).length === 0, errors.get(welcome).join(" | "));

  /* 4. Pick the Dyslexia preset, as the page asks. */
  await evaluate(welcome, 'document.querySelector("[data-preset=dyslexia]").click()');
  check("preset click saves settings",
    await waitFor(welcome, 'chrome.storage.sync.get(null).then((s) => s.font === true && s.bionic === true)', 12000));
  check("preset button lights up",
    await waitFor(welcome, 'document.querySelector("[data-preset=dyslexia]").getAttribute("aria-pressed") === "true"', 12000));
  check("welcome sample restyles itself", await waitFor(welcome, `${ATTR("font")} === "on" && ${BOLD_COUNT} > 20`, 12000));
  check("OpenDyslexic loads on the welcome page", await evaluate(welcome, FONT_LOADED));
  await shot(welcome, "welcome");

  /* 5. The tab that was open before install should already be restyled. */
  check("tab open before install is restyled", await waitFor(oldTab, `${ATTR("font")} === "on" && ${BOLD_COUNT} > 20`, 12000),
    await evaluate(oldTab, `${ATTR("font")} + " / " + ${BOLD_COUNT} + " bold wrappers"`));
  check("OpenDyslexic loads in that tab", await evaluate(oldTab, FONT_LOADED));
  await shot(oldTab, "tab-open-before-install");

  /* 6. A tab opened after install. */
  const page = await open(`${base}/demo/demo.html`);
  check("new tab is restyled", await waitFor(page, `${ATTR("font")} === "on" && ${ATTR("tint")} === "cream" && ${BOLD_COUNT} > 20`, 12000));
  check("OpenDyslexic loads from a normal web page", await evaluate(page, FONT_LOADED));
  check("page text uses the font",
    (await evaluate(page, 'getComputedStyle(document.querySelector("p")).fontFamily')).includes("OpenDyslexic"));

  /* 7. The popup, pointed at that tab. */
  const [tabId] = await evaluate(welcome,
    `chrome.tabs.query({}).then((tabs) => tabs.filter((t) => t.url === "${base}/demo/demo.html").map((t) => t.id))`);
  const popup = await open(`chrome-extension://${id}/popup/popup.html?tab=${tabId}`);
  await reload(popup);
  check("popup loads without errors", errors.get(popup).length === 0, errors.get(popup).join(" | "));
  check("popup shows what is on", await waitFor(popup, 'document.querySelector("#count").textContent === "4 on"', 12000),
    await evaluate(popup, 'document.querySelector("#count").textContent'));
  check("popup shows the site it is on", await waitFor(popup, 'document.querySelector("#site-host").textContent === "127.0.0.1"', 12000));
  check("popup has no blocked notice on a normal page", await evaluate(popup, 'document.querySelector("#blocked")?.hidden === true'));
  check("popup fits Chrome's 600px limit", (await evaluate(popup, 'document.querySelector(".layout").getBoundingClientRect().bottom')) <= 600);
  await evaluate(popup, 'document.querySelector("[data-feature=ruler]").click()');
  check("a popup switch changes the page",
    await waitFor(page, `${ATTR("ruler")} === "on" && !!document.getElementById("dyslexaid-ruler")`, 12000));
  await shot(popup, "popup");

  /* 8. Ruler by keyboard. */
  await send("Page.bringToFront", {}, page);
  const top0 = await evaluate(page, 'document.getElementById("dyslexaid-ruler").getBoundingClientRect().top');
  await send("Input.dispatchKeyEvent",
    { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, modifiers: 1 }, page);
  await sleep(200);
  const top1 = await evaluate(page, 'document.getElementById("dyslexaid-ruler").getBoundingClientRect().top');
  check("Alt+Down moves the ruler", top1 > top0, `${top0} -> ${top1}`);
  await shot(page, "page");

  /* 9. Read aloud reaches the page. */
  await evaluate(popup, `chrome.tabs.sendMessage(${tabId}, { type: "speak" }).catch(() => {}).then(() => true)`);
  check("read aloud reaches the page", await waitFor(page, '!!document.getElementById("dyslexaid-speaking")', 12000));

  /* 10. Popup opened on a page Chrome keeps off limits (here: itself). */
  const blocked = await open(`chrome-extension://${id}/popup/popup.html`);
  check("popup explains pages it cannot change",
    await waitFor(blocked, 'document.querySelector("#blocked") && !document.querySelector("#blocked").hidden', 12000));
  check("popup with the notice still fits 600px",
    (await evaluate(blocked, 'document.querySelector(".layout").getBoundingClientRect().bottom')) <= 600);
  await shot(blocked, "popup-blocked");

  /* 11. Settings page, and pausing a site. */
  const options = await open(`chrome-extension://${id}/options/options.html`);
  await reload(options);
  check("settings page loads without errors", errors.get(options).length === 0, errors.get(options).join(" | "));
  await evaluate(options, 'chrome.storage.sync.set({ pausedSites: ["127.0.0.1"] }).then(() => true)');
  check("pausing a site turns it off there", await waitFor(page, `${ATTR("font")} === null`, 12000));

  /* 12. The website's live demo, with the extension out of the way. */
  const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
  check("website demo runs the shipped code (else run tools/sync-site.mjs)",
    read("docs/try/content.js") === read("content/content.js") &&
    read("docs/try/content.css") ===
      read("content/content.css").replaceAll("chrome-extension://__MSG_@@extension_id__/fonts/", "fonts/"));
  await evaluate(options, "chrome.storage.sync.clear().then(() => true)");
  const site = await open(`${base}/docs/index.html`);
  await reload(site);
  check("website loads without errors", errors.get(site).length === 0, errors.get(site).join(" | "));
  const FRAME = 'document.querySelector("#try-frame").contentDocument';
  await waitFor(site, `${FRAME} && ${FRAME}.readyState === "complete"`, 12000);
  await evaluate(site, 'document.querySelector("[data-try=dyslexia]")?.click()');
  check("website demo restyles its sample",
    await waitFor(site, `${FRAME}.documentElement.getAttribute("data-dyslexaid-font") === "on" && ${FRAME}.querySelectorAll("b.dyslexaid-bionic").length > 20`, 12000));
  check("website demo loads OpenDyslexic",
    await evaluate(site, `document.querySelector("#try-frame").contentWindow.document.fonts.load('40px "OpenDyslexic"').then((f) => f.length > 0 && f.every((x) => x.status === "loaded"), () => false)`));
  await evaluate(site, 'document.querySelector("[data-feature=ruler]").click()');
  check("website switch turns on the ruler",
    await waitFor(site, `${FRAME}.documentElement.getAttribute("data-dyslexaid-ruler") === "on" && !!${FRAME}.getElementById("dyslexaid-ruler")`, 12000));
  const deep = await open(`${base}/docs/index.html?preset=focus`);
  check("website ?preset= link opens with that preset on",
    await waitFor(deep, `document.querySelector("#try-frame").contentDocument.documentElement.getAttribute("data-dyslexaid-calm") === "on"`, 12000));
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1500, deviceScaleFactor: 1, mobile: false }, site);
  await shot(site, "website");
} catch (err) {
  check("smoke test ran to the end", false, err.message);
} finally {
  chrome.kill();
  server.close();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.ok ? "" : r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
