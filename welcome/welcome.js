/* Welcome page. Writes the same presets the popup uses. content.js is
   loaded on this page too, so the change shows up in the sample text
   right away. */
const FEATURES = [
  "font", "spacing", "bionic", "ruler", "tint",
  "calm", "focus", "images", "links",
];
const PRESETS = {
  dyslexia: { on: ["font", "spacing", "bionic", "tint"], textZoom: 100 },
  focus: { on: ["ruler", "calm", "images"], textZoom: 100 },
  vision: { on: ["spacing", "links", "ruler"], textZoom: 130 },
  off: { on: [], textZoom: 100 },
};
const NAMES = { dyslexia: "Dyslexia", focus: "Focus", vision: "Low vision", off: "Nothing yet" };

async function markActive() {
  const s = await chrome.storage.sync.get(null);
  const zoom = s.textZoom || 100;
  for (const btn of document.querySelectorAll("[data-preset]")) {
    const preset = PRESETS[btn.dataset.preset];
    const matches =
      FEATURES.every((f) => Boolean(s[f]) === preset.on.includes(f)) &&
      zoom === preset.textZoom;
    btn.setAttribute("aria-pressed", String(matches));
  }
}

for (const btn of document.querySelectorAll("[data-preset]")) {
  btn.addEventListener("click", () => {
    const preset = PRESETS[btn.dataset.preset];
    const update = { textZoom: preset.textZoom };
    for (const f of FEATURES) update[f] = preset.on.includes(f);
    chrome.storage.sync.set(update);
    document.getElementById("status").textContent =
      btn.dataset.preset === "off"
        ? "Everything is off. Open the popup whenever you want to try something."
        : `${NAMES[btn.dataset.preset]} preset is on. Look at the sample below, then open any page.`;
  });
}

document.getElementById("speak").addEventListener("click", () => {
  // readAloud comes from content.js, loaded on this page as a plain script.
  readAloud();
});
document.getElementById("open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById("open-shortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

markActive();
chrome.storage.onChanged.addListener(markActive);
