// MV3 Service Worker - minimal message relay
// In Phase 1, the service worker has no active role.
// All OCR and DOM work happens in the content script.
chrome.runtime.onInstalled.addListener(() => {
  console.log('[YCR] YouTube Chinese Reader installed');
});

// Handle messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_SETTINGS') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    sendResponse({ ok: true });
  }
});
