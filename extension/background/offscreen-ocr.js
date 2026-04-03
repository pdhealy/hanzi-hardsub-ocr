/**
 * Offscreen OCR worker — PaddleOCR implementation.
 *
 * Architecture:
 *   - opencv.js loaded as <script> in offscreen-ocr.html (12MB, sets globalThis.cv)
 *   - This bundle: ppu-paddle-ocr/web + opencc-js + onnxruntime-web JS
 *   - ONNX Runtime WASM files: served from extension/libs/ort/ (set via ort.env.wasm.wasmPaths)
 *   - PaddleOCR models: downloaded from unpkg.com on first install, cached in Cache Storage
 *
 * Matches poc_2/ocr_subtitles.js PaddleOCR behavior:
 *   - Runs on original image (no preprocessing)
 *   - lines.map(l => l.text).join('')
 *   - toTraditional() via opencc-js Converter({ from: 'cn', to: 'twp' })
 */

import { PaddleOcrService } from 'ppu-paddle-ocr/web';
import { Converter } from 'opencc-js';
import * as ort from 'onnxruntime-web';

// Point ONNX Runtime WASM loader to locally bundled files
// Avoids CSP issues (script-src 'self') and ensures offline access
ort.env.wasm.wasmPaths = chrome.runtime.getURL('libs/ort/');

// OpenCC: Simplified Chinese → Traditional Chinese (Taiwan Phrases)
// Matches poc_2: opencc.Converter({ from: 'cn', to: 'twp' })
const toTraditional = Converter({ from: 'cn', to: 'twp' });

// Chinese PP-OCRv4 models — same models used by @gutenye/ocr-node in poc_2
// Cached in Cache Storage after first download (one-time on extension init)
const CACHE_NAME = 'ycr-paddle-models-v1';
const MODEL_URLS = {
  detection: 'https://unpkg.com/@gutenye/ocr-models@1.4.2/assets/ch_PP-OCRv4_det_infer.onnx',
  recognition: 'https://unpkg.com/@gutenye/ocr-models@1.4.2/assets/ch_PP-OCRv4_rec_infer.onnx',
  dictionary: 'https://unpkg.com/@gutenye/ocr-models@1.4.2/assets/ppocr_keys_v1.txt',
};

let paddleOcr = null;
let initPromise = null;

/**
 * Wait for opencv.js WASM runtime to be fully initialized.
 * opencv.js is loaded as a <script> tag and initializes asynchronously.
 * ppu-ocv/web's initRuntime() checks globalThis.cv?.Mat before any dynamic imports.
 */
function waitForOpenCV() {
  return new Promise((resolve) => {
    /* global cv */
    if (typeof cv !== 'undefined' && cv.Mat) { resolve(); return; }
    const check = setInterval(() => {
      if (typeof cv !== 'undefined') {
        clearInterval(check);
        if (cv.Mat) resolve();
        else cv.onRuntimeInitialized = resolve;
      }
    }, 50);
  });
}

/**
 * Fetch model from URL, cache in Cache Storage, return ArrayBuffer.
 * Cache Storage persists across extension sessions; models are only
 * downloaded once unless the cache is cleared.
 */
async function loadModel(url) {
  const cache = await caches.open(CACHE_NAME);
  let response = await cache.match(url);
  if (!response) {
    console.log('[YCR:Offscreen] Downloading model:', url);
    response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch model: ${url} (${response.status})`);
    await cache.put(url, response.clone());
    console.log('[YCR:Offscreen] Model cached:', url);
  }
  return response.arrayBuffer();
}

/**
 * Singleton PaddleOCR service.
 * Initialized once on first OCR request (or on install via service worker pre-warm).
 * Subsequent calls reuse the same initialized service.
 */
async function ensurePaddleOcr() {
  if (paddleOcr) return paddleOcr;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('[YCR:Offscreen] Waiting for OpenCV runtime...');
      await waitForOpenCV();
      console.log('[YCR:Offscreen] OpenCV ready. Loading PaddleOCR models...');

      const [detBuffer, recBuffer, dictBuffer] = await Promise.all([
        loadModel(MODEL_URLS.detection),
        loadModel(MODEL_URLS.recognition),
        loadModel(MODEL_URLS.dictionary),
      ]);

      console.log('[YCR:Offscreen] Models loaded. Initializing PaddleOCR service...');
      const service = new PaddleOcrService({
        model: {
          detection: detBuffer,
          recognition: recBuffer,
          charactersDictionary: dictBuffer,
        },
        session: { executionProviders: ['wasm'] },
      });
      await service.initialize();
      paddleOcr = service;
      console.log('[YCR:Offscreen] PaddleOCR initialized successfully.');
      return paddleOcr;
    } catch (err) {
      console.error('[YCR:Offscreen] PaddleOCR initialization failed:', err);
      initPromise = null; // Allow retry on next message
      throw err;
    }
  })();

  return initPromise;
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

      const ocr = await ensurePaddleOcr();

      // Convert imageDataUrl to canvas
      // PaddleOCR runs on the ORIGINAL image — no preprocessing
      // Matches poc_2: paddleOcr.detect(inputPath) runs on unmodified image
      const img = new Image();
      img.src = message.imageDataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);

      // Matches poc_2: const lines = await paddleOcr.detect(inputPath)
      const result = await ocr.recognize(canvas);

      // Matches poc_2: lines.map(l => l.text).join('')
      const rawText = result.lines.flat().map(r => r.text).join('');

      // Matches poc_2: toTraditional(...)
      const text = toTraditional(rawText);

      console.log('[YCR:Offscreen] PaddleOCR result:', text);
      sendResponse({ ok: true, text, confidence: result.confidence || 0 });
    } catch (err) {
      console.error('[YCR:Offscreen] OCR error:', err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true;
});
