/* global Tesseract */

console.log('[YCR:Offscreen] Document loaded, checking Tesseract...');
console.log('[YCR:Offscreen] Tesseract available:', typeof Tesseract !== 'undefined');

if (typeof Tesseract === 'undefined') {
  console.error('[YCR:Offscreen] CRITICAL: Tesseract not loaded!');
}

const PARAM_NOT_FOUND_PREFIX = 'Warning: Parameter not found:';
const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  const first = args[0];
  if (typeof first === 'string' && first.startsWith(PARAM_NOT_FOUND_PREFIX)) {
    return;
  }
  originalConsoleWarn(...args);
};

let worker = null;
let workerInitPromise = null;
let selectedLang = 'chi_sim';

async function pickBestLanguage() {
  const traUrl = chrome.runtime.getURL('tessdata/chi_tra.traineddata.gz');
  const simUrl = chrome.runtime.getURL('tessdata/chi_sim.traineddata.gz');

  const [traRes, simRes] = await Promise.all([
    fetch(traUrl, { method: 'HEAD' }).catch(() => null),
    fetch(simUrl, { method: 'HEAD' }).catch(() => null),
  ]);

  const hasTra = !!(traRes && traRes.ok);
  const hasSim = !!(simRes && simRes.ok);

  if (hasTra) return 'chi_tra';
  if (hasSim) return 'chi_sim';
  throw new Error('No Chinese OCR language data found in tessdata/');
}

function cleanupSubtitleText(text, confidence) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  // Fast sanity filters for subtitle-like Chinese output without expensive extra OCR passes.
  const subtitleWhitelist = /[\u3400-\u9fff0-9A-Za-z，。！？：；、「」『』（）《》〈〉—…·,.!?:;'"()\-\s]/;
  const filtered = [...clean].filter((ch) => subtitleWhitelist.test(ch)).join('').replace(/\s+/g, ' ').trim();
  if (!filtered) return '';

  if (filtered.length > 36) return '';

  const lineCount = filtered.split(/\n+/).length;
  if (lineCount > 2) return '';

  const cjkMatches = filtered.match(/[\u3400-\u9fff]/g) || [];
  const cjkRatio = cjkMatches.length / filtered.length;

  if (cjkRatio < 0.2 && Number(confidence || 0) < 60) return '';
  return filtered;
}

async function preprocessForSubtitle(imageDataUrl) {
  const sourceImg = new Image();
  sourceImg.src = imageDataUrl;
  await sourceImg.decode();

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = sourceImg.width * scale;
  canvas.height = sourceImg.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const luminance = new Uint8Array(canvas.width * canvas.height);
  let minLum = 255;
  let maxLum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const lum = Math.round((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000);
    luminance[p] = lum;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const range = Math.max(1, maxLum - minLum);
  const threshold = Math.min(235, Math.max(130, minLum + range * 0.68));

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const bw = luminance[p] >= threshold ? 255 : 0;
    data[i] = bw;
    data[i + 1] = bw;
    data[i + 2] = bw;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

async function ensureWorker() {
  if (worker) return worker;
  if (workerInitPromise) {
    // Wait for existing initialization to complete
    return workerInitPromise;
  }

  workerInitPromise = (async () => {
    try {
      selectedLang = await pickBestLanguage();
      const corePath = chrome.runtime.getURL('libs/tesseract-core/');
      const langPath = chrome.runtime.getURL('tessdata/');
      const workerPath = chrome.runtime.getURL('libs/tesseract/worker.min.js');

      console.log('[YCR:Offscreen] Starting Tesseract worker initialization...');
      const startTime = Date.now();

      worker = await Tesseract.createWorker(selectedLang, 1, {
        workerPath,
        corePath,
        langPath,
        cachePath: 'ycr-v2',
        cacheMethod: 'refresh',
        workerBlobURL: false,
        gzip: true,
        logger: (m) => console.log('[YCR:Offscreen:Tesseract]', m.status, Math.round((m.progress || 0) * 100) + '%'),
      });

      const elapsed = Date.now() - startTime;
      console.log(`[YCR:Offscreen] Tesseract worker initialized successfully in ${elapsed}ms`);
      return worker;
    } catch (err) {
      console.error('[YCR:Offscreen] Worker initialization failed:', err);
      // Clear promise on error so it can be retried
      workerInitPromise = null;
      worker = null;
      throw err;
    }
  })();

  return workerInitPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[YCR:Offscreen] Received message:', message.action);
  
  if (message.action !== 'OFFSCREEN_OCR_RECOGNIZE') return;

  (async () => {
    try {
      if (!message.imageDataUrl) {
        sendResponse({ ok: false, error: 'Missing imageDataUrl' });
        return;
      }
      console.log('[YCR:Offscreen] About to ensure worker...');
      const w = await ensureWorker();
      console.log('[YCR:Offscreen] Worker ensured, preprocessing image...');
      const enhancedImageDataUrl = await preprocessForSubtitle(message.imageDataUrl);
      console.log('[YCR:Offscreen] Image preprocessed, running OCR...');
      const options = {
        tessedit_pageseg_mode: '7',
        preserve_interword_spaces: '1',
        tessedit_do_invert: '0',
        user_defined_dpi: '300',
      };
      const result = await w.recognize(enhancedImageDataUrl, options, { text: true });
      const cleanedText = cleanupSubtitleText(result.data.text, result.data.confidence);
      console.log('[YCR:Offscreen] OCR complete, text:', cleanedText);

      sendResponse({
        ok: true,
        text: cleanedText,
        confidence: result.data.confidence || 0,
      });
    } catch (err) {
      console.error('[YCR:Offscreen] OCR error:', err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true;
});
