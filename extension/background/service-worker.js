// MV3 Service Worker - minimal message relay
// In Phase 1, the service worker has no active role.
// All OCR and DOM work happens in the content script.
chrome.runtime.onInstalled.addListener(() => {
  console.log('[YCR] YouTube Chinese Reader installed');
});
