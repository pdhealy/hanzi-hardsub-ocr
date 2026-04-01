/* global Tesseract */

let worker = null;

async function ensureWorker() {
  if (worker) return worker;

  const corePath = chrome.runtime.getURL('libs/tesseract-core/');
  const langPath = chrome.runtime.getURL('tessdata/');
  const workerPath = chrome.runtime.getURL('libs/tesseract/worker.min.js');

  worker = await Tesseract.createWorker('chi_sim', 1, {
    workerPath,
    corePath,
    langPath,
    workerBlobURL: false,
    gzip: false,
    logger: (m) => console.log('[YCR:Offscreen:Tesseract]', m.status, Math.round((m.progress || 0) * 100) + '%'),
  });

  return worker;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'OFFSCREEN_OCR_RECOGNIZE') return;

  (async () => {
    try {
      if (!message.imageDataUrl) {
        sendResponse({ ok: false, error: 'Missing imageDataUrl' });
        return;
      }
      const w = await ensureWorker();
      const result = await w.recognize(message.imageDataUrl, {}, { text: true });
      sendResponse({
        ok: true,
        text: (result.data.text || '').trim(),
        confidence: result.data.confidence || 0,
      });
    } catch (err) {
      console.error('[YCR:Offscreen] OCR error:', err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true;
});
