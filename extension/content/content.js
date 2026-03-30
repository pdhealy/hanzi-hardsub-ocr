// Content script entry point — YouTube Chinese Reader
// Orchestrates popup message handling, overlay, OCR, and side panel display.

import { SelectionOverlay } from './overlay.js';
import { SidePanel } from './sidepanel.js';
import { OCREngine } from './ocr.js';

let overlay = null;
let sidePanel = null;
let ocrEngine = null;

function ensureOverlay() {
  if (!overlay) overlay = new SelectionOverlay();
  return overlay;
}

function ensureSidePanel() {
  if (!sidePanel) sidePanel = new SidePanel();
  return sidePanel;
}

function ensureOCR() {
  if (!ocrEngine) ocrEngine = new OCREngine();
  return ocrEngine;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ACTIVATE_DRAW_MODE') {
    ensureOverlay().activateDrawMode();
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'GET_STATUS') {
    sendResponse({ boxDrawn: overlay ? overlay.hasSelection() : false });
    return;
  }

  if (message.action === 'SHOW_PANEL') {
    const panel = ensureSidePanel();
    panel.show();
    if (!overlay || !overlay.hasSelection()) {
      panel.showNoSelection();
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'RECOGNIZE') {
    // Async handler — must return true to keep the message channel open for sendResponse
    (async () => {
      const panel = ensureSidePanel();
      panel.show();

      // Check if a selection box exists before attempting OCR
      if (!overlay || !overlay.hasSelection()) {
        panel.showNoSelection();
        sendResponse({ ok: false, error: 'No selection' });
        return;
      }

      // Show loading state while OCR processes (per D-08)
      panel.showLoading();

      try {
        const engine = ensureOCR();
        const videoEl = document.querySelector('#movie_player video');
        if (!videoEl) {
          panel.showError('Video element not found');
          sendResponse({ ok: false, error: 'No video element' });
          return;
        }

        const intrinsicRect = overlay.getVideoIntrinsicRect();
        const result = await engine.recognize(videoEl, intrinsicRect);

        if (result.text && result.text.length > 0) {
          panel.showText(result.text);
          sendResponse({ ok: true, text: result.text });
        } else {
          // Per D-09: show "No text recognized" — never leave the panel blank
          panel.showEmpty();
          sendResponse({ ok: true, text: '' });
        }
      } catch (err) {
        console.error('[YCR] OCR error:', err);
        panel.showError(err.message || 'Unknown error');
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // CRITICAL: keeps message channel open for async sendResponse
  }
});

// YouTube SPA navigation cleanup (per RESEARCH.md Pitfall 5)
// yt-navigate-finish fires when the user navigates between YouTube videos.
document.addEventListener('yt-navigate-finish', () => {
  if (overlay) { overlay.destroy(); overlay = null; }
  if (sidePanel) { sidePanel.destroy(); sidePanel = null; }
  if (ocrEngine) { ocrEngine.terminate(); ocrEngine = null; }
});

console.log('[YCR] YouTube Chinese Reader content script loaded');
