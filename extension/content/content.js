// Content script entry point - injected into YouTube pages
import { SelectionOverlay } from './overlay.js';

let overlay = null;
let sidePanelVisible = false;

function ensureOverlay() {
  if (!overlay) {
    overlay = new SelectionOverlay();
  }
  return overlay;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ACTIVATE_DRAW_MODE') {
    ensureOverlay().activateDrawMode();
    sendResponse({ ok: true });
  }
  if (message.action === 'RECOGNIZE') {
    console.log('[YCR] Recognize triggered (stub)');
    sendResponse({ text: 'OCR not yet implemented' });
    return true; // async
  }
  if (message.action === 'GET_STATUS') {
    sendResponse({ boxDrawn: overlay ? overlay.hasSelection() : false });
  }
  if (message.action === 'SHOW_PANEL') {
    console.log('[YCR] Show panel (stub)');
    sendResponse({ ok: true });
  }
});

document.addEventListener('yt-navigate-finish', () => {
  if (overlay) {
    overlay.destroy();
    overlay = null;
  }
});

console.log('[YCR] YouTube Chinese Reader content script loaded');
