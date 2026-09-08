/* ============================================================
   DyslexAid popup logic.
   The popup reads settings to draw itself, and every control just
   writes to storage. Content scripts in all open tabs pick the change
   up via chrome.storage.onChanged, so storage stays the only source
   of truth. The one exception is read aloud, which is sent as a
   message because it is a one-time action.
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const FEATURES = [
  "font", "spacing", "bionic", "ruler", "tint",
  "calm", "focus", "images", "links",
];
const ZOOM_MIN = 100;
const ZOOM_MAX = 160;
const ZOOM_STEP = 10;

/* One-click bundles. Each lists the features it turns on; everything
   else is turned off, and text size is set explicitly. */
const PRESETS = {
  dyslexia: { on: ["font", "spacing", "bionic", "tint"], textZoom: 100 },
  focus: { on: ["ruler", "calm", "images"], textZoom: 100 },
  vision: { on: ["spacing", "links", "ruler"], textZoom: 130 },
  off: { on: [], textZoom: 100 },
};

/* The preview sentence, in pieces so one piece can be a link. */
const PREVIEW_PARTS = [
  { text: "Reading should feel easy, " },
  { text: "even with a link", link: true },
  { text: " in it." },
];

let host = null; // hostname of the current tab, if it's a normal web page

/* ---------- preview ----------
   Builds the sentence with each word split into a bold start and a
   plain rest, the same way the content script does. CSS decides
   whether the bold part actually renders bold. */
function buildPreview(strength) {
  const p = $("#preview-text");
  p.textContent = "";
  for (const part of PREVIEW_PARTS) {
    const holder = part.link ? document.createElement("a") : document.createDocumentFragment();
    if (part.link) holder.href = "#";
    for (const word of part.text.split(/(\s+)/)) {
      if (!word.trim() || word.length < 2) {
        holder.appendChild(document.createTextNode(word));
        continue;
      }
      const cut = Math.max(1, Math.ceil(word.length * strength));
      const b = document.createElement("b");
      b.textContent = word.slice(0, cut);
      holder.append(b, document.createTextNode(word.slice(cut)));
    }
    p.appendChild(holder);
  }
}

/* ---------- render UI from saved settings ---------- */
async function render() {
  const s = await chrome.storage.sync.get(null);

  for (const cb of $$("input[data-feature]")) {
    cb.checked = Boolean(s[cb.dataset.feature]);
  }

  const zoom = s.textZoom || 100;
  $("#zoom-value").textContent = zoom + "%";

  // Preview card mirrors the text-related toggles.
  buildPreview(s.bionicStrength || 0.4);
  const preview = $("#preview");
  for (const f of ["font", "spacing", "bionic", "links"]) {
    preview.toggleAttribute(`data-${f}`, Boolean(s[f]));
  }
  if (s.tint) preview.setAttribute("data-tint", s.tintColor || "cream");
  else preview.removeAttribute("data-tint");

  // Count badge.
  const onCount = FEATURES.filter((f) => s[f]).length + (zoom !== 100 ? 1 : 0);
  $("#count").textContent = onCount === 0 ? "Nothing on" : `${onCount} on`;

  // Light up the preset that matches the current state exactly.
  for (const btn of $$("[data-preset]")) {
    const preset = PRESETS[btn.dataset.preset];
    const matches =
      FEATURES.every((f) => Boolean(s[f]) === preset.on.includes(f)) &&
      zoom === preset.textZoom;
    btn.setAttribute("aria-pressed", String(matches));
  }

  if (host) {
    $("#site-row").hidden = false;
    $("#site-host").textContent = host;
    $("#site-toggle").checked = !(s.pausedSites || []).includes(host);
  }
}

/* ---------- help panel ----------
   Whatever the user hovers over or tabs to explains itself in one
   fixed place. The text stays until something else is pointed at,
   so a drifting mouse doesn't wipe it. */
function showHelp(e) {
  const el = e.target.closest?.("[data-help]");
  if (el) $("#help").textContent = el.dataset.help;
}
document.addEventListener("mouseover", showHelp);
document.addEventListener("focusin", showHelp);

/* ---------- wire up controls ---------- */
for (const cb of $$("input[data-feature]")) {
  cb.addEventListener("change", () => {
    chrome.storage.sync.set({ [cb.dataset.feature]: cb.checked });
  });
}

for (const btn of $$("[data-preset]")) {
  btn.addEventListener("click", () => {
    const preset = PRESETS[btn.dataset.preset];
    const update = { textZoom: preset.textZoom };
    for (const f of FEATURES) update[f] = preset.on.includes(f);
    chrome.storage.sync.set(update);
  });
}

async function nudgeZoom(delta) {
  const { textZoom = 100 } = await chrome.storage.sync.get("textZoom");
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, textZoom + delta));
  chrome.storage.sync.set({ textZoom: next });
}
$("#zoom-down").addEventListener("click", () => nudgeZoom(-ZOOM_STEP));
$("#zoom-up").addEventListener("click", () => nudgeZoom(ZOOM_STEP));

$("#site-toggle").addEventListener("change", async (e) => {
  const { pausedSites = [] } = await chrome.storage.sync.get("pausedSites");
  const next = e.target.checked
    ? pausedSites.filter((h) => h !== host) // enabled: unpause
    : [...new Set([...pausedSites, host])]; // disabled: pause
  chrome.storage.sync.set({ pausedSites: next });
});

/* Reset wipes every setting, including the options page and the
   paused-site list, so it asks for a second click. The armed state
   times out after a few seconds. */
let resetTimer = null;
$("#reset").addEventListener("click", () => {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
    $("#reset").textContent = "Reset all";
    chrome.storage.sync.clear();
    return;
  }
  $("#reset").textContent = "Click again to confirm";
  resetTimer = setTimeout(() => {
    resetTimer = null;
    $("#reset").textContent = "Reset all";
  }, 4000);
});

$("#options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

$("#shortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

/* Read aloud happens once and is over, so there is nothing to store;
   it goes to the page as a message. Closing the popup lets the user
   watch the page. */
$("#speak").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "speak" }).catch(() => {});
  }
  window.close();
});

/* The preview link is only there to show underlining. */
$("#preview").addEventListener("click", (e) => {
  if (e.target.closest("a")) e.preventDefault();
});

/* ---------- init ---------- */
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab.url);
    if (url.protocol === "http:" || url.protocol === "https:") {
      host = url.hostname;
    }
  } catch {
    /* chrome:// pages and the like get no site row */
  }
  render();
  // Keep the popup live if settings change while it's open
  // (a keyboard shortcut, a preset, or reset).
  chrome.storage.onChanged.addListener(render);
})();
