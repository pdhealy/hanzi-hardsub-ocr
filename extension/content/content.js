// Content script entry point — YouTube Chinese Reader
// Orchestrates popup message handling, overlay, OCR, and side panel display.

import { SelectionOverlay } from './overlay.js';
import { SidePanel } from './sidepanel.js';
import { OCREngine } from './ocr.js';

let overlay = null;
let sidePanel = null;
let ocrEngine = null;

// Live OCR loop state
let loopIntervalId = null;
let isLooping = false;
let recognitionEnabled = false;
let isTicking = false;
let lastRecognizedText = '';
let scanCount = 0;
// First call: download det (~4.9MB) + rec (~12MB) + dict + create 2 ONNX sessions.
// 5 minutes: slow connections can take 2-3 min to download ~17 MB from unpkg.com.
const OCR_INIT_TIMEOUT_MS = 300000;
// Subsequent calls: offscreen doc may be unloaded between scans, forcing re-init of
// 2 ONNX sessions from Cache Storage (~20-30s). Keep well above that.
const OCR_SCAN_TIMEOUT_MS = 60000;

// Settings defaults — must match keys used by extension/options/options.js
const SETTINGS_DEFAULTS = { ycrFontSize: 14, ycrFontColor: '#111827', ycrBgOpacity: 1.0 };
const SETTING_KEYS = ['ycrFontSize', 'ycrFontColor', 'ycrBgOpacity'];

function loadAndApplySettings() {
  chrome.storage.sync.get(SETTINGS_DEFAULTS, (settings) => {
    if (sidePanel) {
      sidePanel.applySettings({
        fontSize: settings.ycrFontSize,
        fontColor: settings.ycrFontColor,
        bgOpacity: settings.ycrBgOpacity,
      });
    }
  });
}

// Real-time settings sync — re-apply whenever any setting key changes in storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (!SETTING_KEYS.some(k => k in changes)) return;
  loadAndApplySettings();
});

function ensureOverlay() {
  if (!overlay) overlay = new SelectionOverlay();
  return overlay;
}

function ensureSidePanel() {
  if (!sidePanel) {
    sidePanel = new SidePanel();
    sidePanel.setOnToggle(() => {
      if (recognitionEnabled) {
        stopLiveLoop(true);
        sidePanel.updateToggleButton(false);
      } else {
        startLiveLoop(true);
        sidePanel.updateToggleButton(true);
      }
    });
  }
  return sidePanel;
}

function ensureOCR() {
  if (!ocrEngine) ocrEngine = new OCREngine();
  return ocrEngine;
}

function isContextInvalidatedError(err) {
  const msg = err && err.message ? err.message : String(err || '');
  return msg.includes('Extension context invalidated');
}

function handleContextInvalidated() {
  stopLiveLoop();
  if (sidePanel) {
    sidePanel.showError('Extension updated. Please refresh this YouTube tab and start recognition again.');
    sidePanel.updateToggleButton(false);
  }
}

async function recognizeWithTimeout(engine, videoEl, intrinsicRect, timeoutMs) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('OCR initialization timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([engine.recognize(videoEl, intrinsicRect), timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function getVideoTimestamp(videoEl) {
  const t = Math.floor(videoEl.currentTime);
  const duration = videoEl.duration || 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return (duration >= 3600 || h > 0) ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function startLiveLoop(explicit = false) {
  if (explicit) {
    recognitionEnabled = true;
    chrome.runtime.sendMessage({ action: 'STATE_CHANGED', isLooping: true }).catch(() => {});
  }
  if (!recognitionEnabled) return;

  const videoEl = document.querySelector('#movie_player video');
  if (!videoEl || videoEl.paused) {
    // Make sure panel toggles even if video is paused
    ensureSidePanel().show();
    return;
  }

  if (isLooping) return; // D-03: only one loop at a time
  isLooping = true;

  ensureSidePanel().show();
  ensureSidePanel().showLoading();
  loadAndApplySettings();

  loopIntervalId = setInterval(async () => {
    if (isTicking) return; // overlap guard (Pitfall 1)
    const videoEl2 = document.querySelector('#movie_player video');
    if (!videoEl2 || videoEl2.paused) return; // D-02: skip if paused
    if (videoEl2.readyState < 3) return; // buffering guard (Pitfall 6)
    if (!overlay || !overlay.hasSelection()) return;

    isTicking = true;
    try {
      const engine = ensureOCR();
      if (scanCount === 0) {
        ensureSidePanel().updateLoadingStatus('Initializing OCR engine…');
      }
      const intrinsicRect = overlay.getVideoIntrinsicRect();
      const timeoutMs = scanCount === 0 ? OCR_INIT_TIMEOUT_MS : OCR_SCAN_TIMEOUT_MS;
      const result = await recognizeWithTimeout(engine, videoEl2, intrinsicRect, timeoutMs);
      const text = result.text;
      scanCount++;
      console.log('[YCR] scan', scanCount, 'intrinsicRect:', intrinsicRect, 'text:', JSON.stringify(text));
      if (text && text !== lastRecognizedText) { // D-05: dedup
        lastRecognizedText = text;
        const ts = getVideoTimestamp(videoEl2);
        ensureSidePanel().appendEntry(ts, text); // D-04
      } else {
        ensureSidePanel().updateLoadingStatus(
          `Scanning… (${scanCount} frame${scanCount === 1 ? '' : 's'} checked, no text found)`
        );
      }
    } catch (err) {
      if (isContextInvalidatedError(err)) {
        handleContextInvalidated();
        return;
      }
      console.error('[YCR] Loop OCR error:', err);
      try {
        const videoElErr = document.querySelector('#movie_player video');
        if (videoElErr) {
          ensureSidePanel().appendEntry(getVideoTimestamp(videoElErr), '[Error: ' + err.message + ']');
        }
      } catch { /* ignore display errors */ }
    } finally {
      isTicking = false;
    }
  }, 1000); // D-01: 1-second interval
}

function stopLiveLoop(explicit = false) {
  if (explicit) {
    recognitionEnabled = false;
    chrome.runtime.sendMessage({ action: 'STATE_CHANGED', isLooping: false }).catch(() => {});
  }
  if (loopIntervalId !== null) {
    clearInterval(loopIntervalId);
    loopIntervalId = null;
  }
  isLooping = false;
  isTicking = false;
  lastRecognizedText = '';
  scanCount = 0;
}

// Auto start/stop on video play/pause
document.addEventListener('play', (e) => {
  if (e.target.tagName === 'VIDEO' && recognitionEnabled) {
    startLiveLoop();
    if (sidePanel) sidePanel.updateToggleButton(true);
  }
}, true);

document.addEventListener('pause', (e) => {
  if (e.target.tagName === 'VIDEO' && recognitionEnabled) {
    stopLiveLoop(false);
    if (sidePanel) sidePanel.updateToggleButton(false);
  }
}, true);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ACTIVATE_DRAW_MODE') {
    ensureOverlay().activateDrawMode();
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'DRAW_CENTERED_BOX') {
    ensureOverlay().drawCenteredBox();
    sendResponse({ ok: true, rect: ensureOverlay().getVideoIntrinsicRect() });
    return;
  }

  if (message.action === 'REMOVE_BOX') {
    if (overlay) overlay.removeBox();
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'SET_BOX') {
    ensureOverlay().setBoxFromIntrinsic(message.rect);
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'GET_STATUS') {
    sendResponse({ 
      boxDrawn: overlay ? overlay.hasSelection() : false, 
      rect: (overlay && overlay.hasSelection()) ? overlay.getVideoIntrinsicRect() : null,
      isLooping: recognitionEnabled 
    });
    return;
  }

  if (message.action === 'START_LIVE') {
    startLiveLoop(true);
    sendResponse({ ok: true, isLooping: true });
    return;
  }

  if (message.action === 'STOP_LIVE') {
    stopLiveLoop(true);
    sendResponse({ ok: true, isLooping: false });
    return;
  }

  if (message.action === 'SHOW_PANEL') {
    const panel = ensureSidePanel();
    panel.show();
    loadAndApplySettings();
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
        const result = await recognizeWithTimeout(engine, videoEl, intrinsicRect, OCR_INIT_TIMEOUT_MS);

        if (result.text && result.text.length > 0) {
          panel.showText(result.text);
          sendResponse({ ok: true, text: result.text });
        } else {
          // Per D-09: show "No text recognized" — never leave the panel blank
          panel.showEmpty();
          sendResponse({ ok: true, text: '' });
        }
      } catch (err) {
        if (isContextInvalidatedError(err)) {
          handleContextInvalidated();
          sendResponse({ ok: false, error: 'Extension updated. Refresh this tab and try again.' });
          return;
        }
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
  stopLiveLoop(); // MUST be first — clears interval before nulling modules (Pitfall 3)
  if (overlay) { overlay.destroy(); overlay = null; }
  if (sidePanel) { sidePanel.destroy(); sidePanel = null; }
  if (ocrEngine) { ocrEngine.terminate(); ocrEngine = null; }
});

console.log('[YCR] YouTube Chinese Reader content script loaded');
