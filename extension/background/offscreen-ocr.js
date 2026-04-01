/* global Tesseract */

let worker = null;
let workerInitPromise = null;
let selectedLang = 'chi_sim';

function cjkRatioOf(text) {
  if (!text) return 0;
  const clean = text.replace(/\s+/g, '');
  if (!clean.length) return 0;
  const cjkMatches = clean.match(/[\u3400-\u9fff]/g) || [];
  return cjkMatches.length / clean.length;
}

async function pickBestLanguage() {
  const traUrl = chrome.runtime.getURL('tessdata/chi_tra.traineddata.gz');
  const simUrl = chrome.runtime.getURL('tessdata/chi_sim.traineddata.gz');

  const [traRes, simRes] = await Promise.all([
    fetch(traUrl, { method: 'HEAD' }).catch(() => null),
    fetch(simUrl, { method: 'HEAD' }).catch(() => null),
  ]);

  const hasTra = !!(traRes && traRes.ok);
  const hasSim = !!(simRes && simRes.ok);

  if (hasTra && hasSim) return 'chi_tra+chi_sim';
  if (hasTra) return 'chi_tra';
  if (hasSim) return 'chi_sim';
  throw new Error('No Chinese OCR language data found in tessdata/');
}

function cleanupSubtitleText(text, confidence) {
  const clean = (text || '')
    .replace(/[|¦_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';

  const cjkRatio = cjkRatioOf(clean);
  const conf = Number(confidence || 0);

  if (cjkRatio < 0.2 && conf < 60) return '';
  if (clean.length <= 2 && conf < 50) return '';
  return clean;
}

async function renderSubtitleVariant(imageDataUrl, variant) {
  const sourceImg = new Image();
  sourceImg.src = imageDataUrl;
  await sourceImg.decode();

  const scale = variant === 'contrast' ? 2 : 1.6;
  const canvas = document.createElement('canvas');
  canvas.width = sourceImg.width * scale;
  canvas.height = sourceImg.height * scale;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let minLum = 255;
  let maxLum = 0;
  const luminance = new Uint8Array(canvas.width * canvas.height);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const lum = Math.round((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000);
    luminance[p] = lum;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const range = Math.max(1, maxLum - minLum);

  if (variant === 'contrast') {
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const stretched = Math.max(0, Math.min(255, Math.round(((luminance[p] - minLum) * 255) / range)));
      data[i] = stretched;
      data[i + 1] = stretched;
      data[i + 2] = stretched;
      data[i + 3] = 255;
    }
  } else {
    const threshold = Math.min(232, Math.max(122, minLum + range * 0.66));
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const bw = luminance[p] >= threshold ? 255 : 0;
      data[i] = bw;
      data[i + 1] = bw;
      data[i + 2] = bw;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

async function runRecognition(w, imageDataUrl) {
  const options = {
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1',
    tessedit_do_invert: '0',
    user_defined_dpi: '300',
  };
  const result = await w.recognize(imageDataUrl, options, { text: true });
  const rawText = result.data.text || '';
  const confidence = Number(result.data.confidence || 0);
  const cleanedText = cleanupSubtitleText(rawText, confidence);
  const cjkRatio = cjkRatioOf(cleanedText);
  const score = confidence + cjkRatio * 35 + Math.min(cleanedText.length, 20);

  return { text: cleanedText, confidence, score };
}

async function recognizeSubtitle(w, imageDataUrl) {
  const contrastImage = await renderSubtitleVariant(imageDataUrl, 'contrast');
  let best = await runRecognition(w, contrastImage);

  if (!best.text || best.score < 68) {
    const binaryImage = await renderSubtitleVariant(imageDataUrl, 'binary');
    const fallback = await runRecognition(w, binaryImage);
    if (fallback.score > best.score) {
      best = fallback;
    }
  }

  return best;
}

async function ensureWorker() {
  if (worker) return worker;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = (async () => {
    selectedLang = await pickBestLanguage();
    const corePath = chrome.runtime.getURL('libs/tesseract-core/');
    const langPath = chrome.runtime.getURL('tessdata/');
    const workerPath = chrome.runtime.getURL('libs/tesseract/worker.min.js');

    worker = await Tesseract.createWorker(selectedLang, 1, {
      workerPath,
      corePath,
      langPath,
      cachePath: 'ycr-v3',
      cacheMethod: 'write',
      workerBlobURL: false,
      gzip: true,
      legacyCore: false,
      legacyLang: false,
      logger: (m) => console.log('[YCR:Offscreen:Tesseract]', m.status, `${Math.round((m.progress || 0) * 100)}%`),
    });
    return worker;
  })();

  try {
    return await workerInitPromise;
  } finally {
    workerInitPromise = null;
  }
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
      const best = await recognizeSubtitle(w, message.imageDataUrl);

      sendResponse({
        ok: true,
        text: best.text,
        confidence: best.confidence,
      });
    } catch (err) {
      console.error('[YCR:Offscreen] OCR error:', err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true;
});
