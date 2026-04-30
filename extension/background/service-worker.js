const OFFSCREEN_DOCUMENT_PATH = 'background/offscreen-ocr.html';

async function ensureOffscreenDocument() {
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

  // Give the offscreen document time to load and execute its scripts
  await new Promise(resolve => setTimeout(resolve, 500));
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[YCR] YouTube Chinese Reader installed. Pre-loading PaddleOCR models...');
  try {
    await ensureOffscreenDocument();
    console.log('[YCR] Offscreen document created — model download initiated.');
  } catch (err) {
    console.warn('[YCR] Model pre-load setup failed (will retry on first OCR):', err.message);
  }
});

// Handle messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_SETTINGS') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'TRANSLATE_TEXT') {
    (async () => {
      try {
        if (!message.text) {
          sendResponse({ ok: false, error: 'Missing text' });
          return;
        }

        console.log('[YCR:SW] Ensuring offscreen document for translation...');
        await ensureOffscreenDocument();
        const response = await chrome.runtime.sendMessage({
          action: 'OFFSCREEN_TRANSLATE_TEXT',
          text: message.text,
        });
        sendResponse(response || { ok: false, error: 'No response from offscreen translation' });
      } catch (err) {
        console.error('[YCR:SW] Translation error:', err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (message.action === 'OCR_RECOGNIZE_IMAGE') {
    (async () => {
      try {
        if (!message.imageDataUrl) {
          sendResponse({ ok: false, error: 'Missing imageDataUrl' });
          return;
        }
        console.log('[YCR:SW] Ensuring offscreen document...');
        await ensureOffscreenDocument();
        console.log('[YCR:SW] Sending OCR recognize message to offscreen...');
        const response = await chrome.runtime.sendMessage({
          action: 'OFFSCREEN_OCR_RECOGNIZE',
          imageDataUrl: message.imageDataUrl,
        });
        console.log('[YCR:SW] Received response from offscreen:', response);
        sendResponse(response || { ok: false, error: 'No response from offscreen OCR' });
      } catch (err) {
        console.error('[YCR:SW] OCR error:', err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }
});
