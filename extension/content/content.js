// Content script entry point - injected into YouTube pages
// Modules will be imported here in subsequent plans

let selectionBox = null; // Will hold selection coordinates {x, y, width, height}
let sidePanelVisible = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ACTIVATE_DRAW_MODE') {
    console.log('[YCR] Draw mode activated (stub)');
    sendResponse({ ok: true });
  }
  if (message.action === 'RECOGNIZE') {
    console.log('[YCR] Recognize triggered (stub)');
    sendResponse({ text: 'OCR not yet implemented' });
    return true; // async
  }
  if (message.action === 'GET_STATUS') {
    sendResponse({ boxDrawn: !!selectionBox });
  }
  if (message.action === 'SHOW_PANEL') {
    console.log('[YCR] Show panel (stub)');
    sendResponse({ ok: true });
  }
});

console.log('[YCR] YouTube Chinese Reader content script loaded');
