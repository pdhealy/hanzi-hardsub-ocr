const OFFSCREEN_DOCUMENT_PATH = 'background/offscreen-ocr.html';
let offscreenReadyPromise = null;

async function ensureOffscreenDocument() {
  // Return existing promise if already creating
  if (offscreenReadyPromise) {
    return offscreenReadyPromise;
  }

  offscreenReadyPromise = (async () => {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });

    if (contexts.length > 0) return;

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['WORKERS'],
      justification: 'Run OCR worker outside page CSP restrictions',
    });

    // Give the offscreen document a moment to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));
  })();

  try {
    await offscreenReadyPromise;
  } finally {
    // Clear the promise after a delay to allow reuse
    setTimeout(() => {
      offscreenReadyPromise = null;
    }, 1000);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[YCR] YouTube Chinese Reader installed');
  // Defer prewarm slightly to ensure offscreen document is ready
  setTimeout(() => {
    void ensureOffscreenDocument()
      .then(() => chrome.runtime.sendMessage({ action: 'OFFSCREEN_OCR_PREWARM' }))
      .catch((err) => console.error('[YCR:SW] Install prewarm failed:', err));
  }, 500);
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[YCR] YouTube Chinese Reader startup');
  // Defer prewarm slightly to ensure offscreen document is ready
  setTimeout(() => {
    void ensureOffscreenDocument()
      .then(() => chrome.runtime.sendMessage({ action: 'OFFSCREEN_OCR_PREWARM' }))
      .catch((err) => console.error('[YCR:SW] Startup prewarm failed:', err));
  }, 500);
});

// Handle messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_SETTINGS') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'OCR_RECOGNIZE_IMAGE') {
    (async () => {
      try {
        if (!message.imageDataUrl) {
          sendResponse({ ok: false, error: 'Missing imageDataUrl' });
          return;
        }
        await ensureOffscreenDocument();
        const response = await chrome.runtime.sendMessage({
          action: 'OFFSCREEN_OCR_RECOGNIZE',
          imageDataUrl: message.imageDataUrl,
        });
        sendResponse(response || { ok: false, error: 'No response from offscreen OCR' });
      } catch (err) {
        console.error('[YCR:SW] OCR error:', err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (message.action === 'OCR_PREWARM') {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const response = await chrome.runtime.sendMessage({ action: 'OFFSCREEN_OCR_PREWARM' });
        sendResponse(response || { ok: false, error: 'No response from offscreen prewarm' });
      } catch (err) {
        console.error('[YCR:SW] OCR prewarm error:', err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }
});
