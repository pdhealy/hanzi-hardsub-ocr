/**
 * Offscreen OCR worker — direct ONNX Runtime Web pipeline.
 *
 * Architecture:
 *   - No opencv dependency (avoids new Function() / unsafe-eval)
 *   - Loads ch_PP-OCRv4_rec_infer.onnx + ppocr_keys_v1.txt
 *   - Preprocesses with Canvas API (resize h=48, normalize to [-1,1])
 *   - Runs ONNX inference via onnxruntime-web (wasm provider)
 *   - CTC greedy decode → OpenCC simplified→traditional
 *
 * Models cached in Cache Storage after first download.
 */

import { Converter } from 'opencc-js';
import * as ort from 'onnxruntime-web';

// Point ONNX Runtime WASM loader to locally bundled files
ort.env.wasm.wasmPaths = chrome.runtime.getURL('libs/ort/');

// OpenCC: Simplified Chinese → Traditional Chinese (Taiwan Phrases)
const toTraditional = Converter({ from: 'cn', to: 'twp' });

const CACHE_NAME = 'ycr-paddle-models-v1';
const MODEL_URLS = {
  recognition: 'https://unpkg.com/@gutenye/ocr-models@1.4.2/assets/ch_PP-OCRv4_rec_infer.onnx',
  dictionary: 'https://unpkg.com/@gutenye/ocr-models@1.4.2/assets/ppocr_keys_v1.txt',
};

let recSession = null;
let dictionary = null;
let initPromise = null;

/**
 * Fetch model from URL, cache in Cache Storage, return ArrayBuffer.
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
 * Singleton: load recognition model + dictionary once.
 */
async function ensureOcr() {
  if (recSession && dictionary) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('[YCR:Offscreen] Loading PaddleOCR rec model and dictionary...');

      const [recBuffer, dictBuffer] = await Promise.all([
        loadModel(MODEL_URLS.recognition),
        loadModel(MODEL_URLS.dictionary),
      ]);

      // One character per line; blank token = last index (dictionary.length)
      const dictText = new TextDecoder().decode(dictBuffer);
      dictionary = dictText.trim().split('\n').map(l => l.trim());

      recSession = await ort.InferenceSession.create(recBuffer, {
        executionProviders: ['wasm'],
      });

      console.log('[YCR:Offscreen] PaddleOCR initialized. Dict size:', dictionary.length);
    } catch (err) {
      console.error('[YCR:Offscreen] Init failed:', err);
      initPromise = null; // Allow retry
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Preprocess image for PaddleOCR recognition:
 * - Resize to h=48, maintain aspect ratio (min w=32)
 * - Normalize: pixel/127.5 - 1.0  (i.e. mean=0.5, std=0.5 on [0,1] range)
 * - Returns Float32Array in NCHW layout [1, 3, 48, w]
 */
function preprocessImage(imageDataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const TARGET_H = 48;
      const newW = Math.max(32, Math.round(img.width * TARGET_H / img.height));

      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = TARGET_H;
      canvas.getContext('2d').drawImage(img, 0, 0, newW, TARGET_H);
      const { data } = canvas.getContext('2d').getImageData(0, 0, newW, TARGET_H);

      // RGBA pixels → NCHW Float32 [1, 3, 48, newW]
      const HW = TARGET_H * newW;
      const tensor = new Float32Array(3 * HW);
      for (let i = 0; i < HW; i++) {
        tensor[i]          = data[i * 4]     / 127.5 - 1.0; // R
        tensor[HW + i]     = data[i * 4 + 1] / 127.5 - 1.0; // G
        tensor[HW * 2 + i] = data[i * 4 + 2] / 127.5 - 1.0; // B
      }
      resolve({ tensor, width: newW });
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

/**
 * CTC greedy decode.
 * PaddleOCR: blank token = numClasses - 1 (last index).
 */
function ctcDecode(logits, seqLen, numClasses) {
  const blank = numClasses - 1;
  let prevIdx = -1;
  let result = '';

  for (let t = 0; t < seqLen; t++) {
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const v = logits[t * numClasses + c];
      if (v > maxVal) { maxVal = v; maxIdx = c; }
    }
    if (maxIdx !== blank && maxIdx !== prevIdx) {
      result += dictionary[maxIdx] || '';
    }
    prevIdx = maxIdx;
  }

  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'OFFSCREEN_OCR_RECOGNIZE') return;

  (async () => {
    try {
      if (!message.imageDataUrl) {
        sendResponse({ ok: false, error: 'Missing imageDataUrl' });
        return;
      }

      await ensureOcr();

      const { tensor, width } = await preprocessImage(message.imageDataUrl);
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, 48, width]);
      const results = await recSession.run({ x: inputTensor });

      // Output key varies by export; grab first output
      const output = results[Object.keys(results)[0]];
      // dims: [1, seqLen, numClasses]
      const [, seqLen, numClasses] = output.dims;
      const rawText = ctcDecode(output.data, seqLen, numClasses);
      const text = toTraditional(rawText);

      console.log('[YCR:Offscreen] OCR result:', text);
      sendResponse({ ok: true, text, confidence: 0 });
    } catch (err) {
      console.error('[YCR:Offscreen] OCR error:', err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true;
});
