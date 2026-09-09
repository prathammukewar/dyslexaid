/* ============================================================
   DyslexAid service worker.
   Turns keyboard shortcuts into settings flips, which every tab
   picks up from storage. Read aloud is the exception: it happens
   once, so it is sent to the active tab as a message.
   ============================================================ */

const COMMAND_TO_FEATURE = {
  "toggle-ruler": "ruler",
  "toggle-bionic": "bionic",
};

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "read-aloud") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "speak" }).catch(() => {});
    }
    return;
  }
  const feature = COMMAND_TO_FEATURE[command];
  if (!feature) return;
  const saved = await chrome.storage.sync.get(feature);
  await chrome.storage.sync.set({ [feature]: !saved[feature] });
});

/* First install: open the welcome page so the person can pick a
   preset and see it work before they ever open the popup. */
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
  }
});
