/* ============================================================
   DyslexAid content script.
   Runs inside every page.

   State vs actions: chrome.storage.sync holds all settings. The
   popup, the options page, and the service worker only write
   settings; this script listens for changes and applies them, so
   every open tab stays in sync. Read aloud is the exception: it
   happens once and is over, so there is nothing to store, and it
   arrives as a runtime message instead.
   ============================================================ */

const FEATURES = [
  "font", "spacing", "bionic", "ruler", "tint",
  "calm", "focus", "images", "links",
];
const root = document.documentElement;
const HOST = location.hostname;

const DEFAULTS = {
  textZoom: 100,
  tintColor: "cream",
  bionicStrength: 0.4,
  rulerHeight: 42,
  ttsRate: 1,
};

let settings = { ...DEFAULTS };

/* ---------- applying settings ----------
   Most features are one attribute flip; content.css does the
   rest. Bold word starts, the ruler, and line focus have JS components. */
function applySetting(feature, on) {
  if (on) {
    root.setAttribute(`data-dyslexaid-${feature}`, "on");
  } else {
    root.removeAttribute(`data-dyslexaid-${feature}`);
  }
  if (feature === "bionic") on ? startBionic() : stopBionic();
  if (feature === "ruler") on ? startRuler() : stopRuler();
  if (feature === "focus") on ? startFocus() : stopFocus();
}

/* Tint looks broken on dark-themed sites (a pale wash over
   near-black), so detect a dark page background and skip it. */
function pageIsDark() {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) continue;
    if (m[4] !== undefined && parseFloat(m[4]) === 0) continue; // transparent
    const luminance = 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3];
    return luminance < 110;
  }
  return false; // no opaque background found, assume light
}

function applyAll(s) {
  settings = { ...DEFAULTS, ...s };
  const paused = (s.pausedSites || []).includes(HOST);

  for (const f of FEATURES) {
    let on = !paused && Boolean(s[f]);
    if (f === "tint" && on && pageIsDark()) on = false;
    applySetting(f, on);
  }

  // The tint attribute carries its color so CSS picks the palette.
  if (root.hasAttribute("data-dyslexaid-tint")) {
    root.setAttribute("data-dyslexaid-tint", settings.tintColor);
  }

  if (rulerEl) rulerEl.style.height = settings.rulerHeight + "px";

  // A changed boldness level means existing wrappers are stale.
  if (
    root.hasAttribute("data-dyslexaid-bionic") &&
    appliedStrength !== null &&
    appliedStrength !== settings.bionicStrength
  ) {
    rewrapBionic();
  }

  const zoom = paused ? 100 : settings.textZoom;
  if (document.body) {
    document.body.style.zoom = zoom === 100 ? "" : String(zoom / 100);
  }
}

function refresh() {
  chrome.storage.sync.get(null, applyAll);
}

refresh(); // apply saved settings on page load
chrome.storage.onChanged.addListener(refresh); // react to popup/options/shortcuts

/* ============================================================
   Bold word starts.
   Wrap the first part of each word (settings.bionicStrength of
   its length) in <b class="dyslexaid-bionic">. A TreeWalker
   visits only text nodes, skipping anything unsafe to rewrite.
   A MutationObserver catches content added after page load
   (infinite scroll, comments, SPAs). Wrappers stay in the DOM
   when toggled off; CSS un-bolds them, so re-enabling is instant.
   ============================================================ */
const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
  "CODE", "PRE", "KBD", "SAMP", "B", "SVG", "CANVAS", "BUTTON",
]);

let observer = null;
let pendingNodes = new Set();
let processTimer = null;
let selfMutating = false; // our own DOM edits must not re-trigger us
let appliedStrength = null; // boldness the current wrappers were made with

function bionicize(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName) || el.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect first: mutating while walking confuses the TreeWalker.
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  selfMutating = true;
  for (const node of textNodes) {
    const frag = document.createDocumentFragment();
    for (const part of node.nodeValue.split(/(\s+)/)) {
      if (!part.trim() || part.length < 2) {
        frag.appendChild(document.createTextNode(part));
        continue;
      }
      const cut = Math.max(1, Math.ceil(part.length * settings.bionicStrength));
      const b = document.createElement("b");
      b.className = "dyslexaid-bionic";
      b.textContent = part.slice(0, cut);
      frag.appendChild(b);
      frag.appendChild(document.createTextNode(part.slice(cut)));
    }
    node.parentNode.replaceChild(frag, node);
  }
  selfMutating = false;
  appliedStrength = settings.bionicStrength;
}

function rewrapBionic() {
  selfMutating = true;
  const parents = new Set();
  for (const b of document.querySelectorAll("b.dyslexaid-bionic")) {
    parents.add(b.parentNode);
    b.replaceWith(document.createTextNode(b.textContent));
  }
  for (const parent of parents) parent.normalize();
  selfMutating = false;
  bionicize(document.body);
}

function startBionic() {
  bionicize(document.body);
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    if (selfMutating) return;
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (
          n.nodeType === Node.ELEMENT_NODE &&
          !n.id?.startsWith("dyslexaid-")
        ) {
          pendingNodes.add(n);
        }
      }
    }
    // Debounce: process new content in batches, not per-mutation.
    clearTimeout(processTimer);
    processTimer = setTimeout(() => {
      const batch = [...pendingNodes];
      pendingNodes.clear();
      for (const node of batch) {
        if (node.isConnected) bionicize(node);
      }
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopBionic() {
  // CSS already un-bolds existing wrappers; just stop watching.
  observer?.disconnect();
  observer = null;
  pendingNodes.clear();
}

/* ============================================================
   Reading ruler: a soft band that follows the cursor.
   Line focus: the inverse, everything BUT the band is dimmed.
   Both are fixed elements that share one vertical position, moved by
   the mouse or nudged with Alt+Up and Alt+Down for people who read
   without a mouse.
   ============================================================ */
let rulerEl = null;
let focusEl = null;
let bandY = null; // viewport y of the band's center; null until placed
let bandListenersOn = false;

function makeOverlay(id) {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function placeBands() {
  if (bandY === null) bandY = window.innerHeight / 2;
  for (const el of [rulerEl, focusEl]) {
    if (el) el.style.top = bandY - el.offsetHeight / 2 + "px";
  }
}

function moveBands(e) {
  bandY = e.clientY;
  placeBands();
}

function nudgeBands(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  const t = e.target;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (bandY === null) bandY = window.innerHeight / 2;
  const step = Math.max(24, settings.rulerHeight);
  bandY += e.key === "ArrowDown" ? step : -step;
  bandY = Math.max(0, Math.min(window.innerHeight, bandY));
  placeBands();
  e.preventDefault();
}

function updateBandListeners() {
  const wanted =
    root.hasAttribute("data-dyslexaid-ruler") ||
    root.hasAttribute("data-dyslexaid-focus");
  if (wanted && !bandListenersOn) {
    document.addEventListener("mousemove", moveBands, { passive: true });
    document.addEventListener("keydown", nudgeBands);
    bandListenersOn = true;
  } else if (!wanted && bandListenersOn) {
    document.removeEventListener("mousemove", moveBands);
    document.removeEventListener("keydown", nudgeBands);
    bandListenersOn = false;
  }
}

function startRuler() {
  if (!rulerEl) rulerEl = makeOverlay("dyslexaid-ruler");
  rulerEl.style.height = settings.rulerHeight + "px";
  placeBands();
  updateBandListeners();
}
function stopRuler() {
  updateBandListeners();
}

function startFocus() {
  if (!focusEl) focusEl = makeOverlay("dyslexaid-focus");
  placeBands();
  updateBandListeners();
}
function stopFocus() {
  updateBandListeners();
}

/* ============================================================
   Read aloud, via the browser's built-in speech synthesis.
   Entirely local: no audio or text leaves the machine. Reads the
   selection if there is one, otherwise the article. Queued as
   sentence-sized utterances because very long single utterances
   are unreliable in Chrome. Triggered again, it stops.
   ============================================================ */
let speakingEl = null;
let queued = 0;

/* A visible, clickable "reading aloud" control, so the reader can
   see that speech is running and stop it without remembering a
   shortcut. It is a real button, so it is keyboard reachable too. */
function showSpeaking(on) {
  if (!speakingEl) {
    speakingEl = document.createElement("button");
    speakingEl.id = "dyslexaid-speaking";
    speakingEl.type = "button";
    speakingEl.textContent = "Reading aloud. Click to stop.";
    speakingEl.addEventListener("click", stopReading);
    document.body.appendChild(speakingEl);
  }
  speakingEl.hidden = !on;
}

function stopReading() {
  speechSynthesis.cancel();
  queued = 0;
  showSpeaking(false);
}

function readAloud() {
  if (speechSynthesis.speaking) {
    stopReading();
    return;
  }
  const selection = getSelection().toString().trim();
  const source =
    selection ||
    (document.querySelector("article, main") || document.body).innerText;
  const text = source.slice(0, 30000);
  const sentences = (text.match(/[^.!?\n]+[.!?]*\s*/g) || [text]).filter(
    (s) => s.trim()
  );
  if (!sentences.length) return;

  queued = sentences.length;
  showSpeaking(true);
  for (const sentence of sentences) {
    const u = new SpeechSynthesisUtterance(sentence);
    u.rate = settings.ttsRate;
    u.onend = u.onerror = () => {
      queued -= 1;
      if (queued <= 0) showSpeaking(false);
    };
    speechSynthesis.speak(u);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "speak") readAloud();
});
