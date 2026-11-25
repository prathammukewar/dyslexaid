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

/* Chrome only runs a content script in pages loaded after the
   extension arrives. Without this, every tab that was already open
   would ignore the popup until it was reloaded, which looks broken. */
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.allSettled(
    tabs.map(async (tab) => {
      const target = { tabId: tab.id };
      await chrome.scripting.insertCSS({ target, files: ["content/content.css"] });
      await chrome.scripting.executeScript({ target, files: ["content/content.js"] });
    })
  );
}

/* First install: open the welcome page so the person can pick a
   preset and see it work before they ever open the popup. */
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
  }
  if (reason === "install" || reason === "update") injectIntoOpenTabs();
});
