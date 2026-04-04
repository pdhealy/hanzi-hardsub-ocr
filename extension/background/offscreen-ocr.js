/**
 * Offscreen OCR worker — full PaddleOCR pipeline (detection + recognition).
 *
 * Architecture:
 *   - No opencv dependency (CSP: script-src 'self' 'wasm-unsafe-eval')
 *   - Detection:    ch_PP-OCRv4_det_infer.onnx → pure-JS BFS connected components → bounding rects
 *   - Recognition:  ch_PP-OCRv4_rec_infer.onnx per detected crop → CTC decode
 *   - OpenCC:       Simplified → Traditional Chinese
 *
 * Matches poc_2/ocr_subtitles.js pipeline exactly:
 *   original image → detection model → tight text region crops
 *                 → recognition model per crop → CTC decode → OpenCC toTraditional()
 *
 * Crop step:         Canvas drawImage (axis-aligned bbox) — identical to ppu-paddle-ocr CanvasToolkit.crop()
 * Resize step:       Canvas drawImage to h=48 — identical to ppu-paddle-ocr processor.resize()
 * Contours step:     Pure-JS BFS flood fill — replaces cv.findContours (no perspective transform needed
 *                    for horizontal subtitle text; warp is registered in ppu-ocv but never called
 *                    in base-recognition.service.js for axis-aligned DBNet results)
 */

import { Converter } from 'opencc-js';
import * as ort from 'onnxruntime-web';

// Point ONNX Runtime WASM loader to the non-JSEP WASM and its JS module factory.
//
// ORT 1.24.x reads wasmPaths with SHORT keys: { wasm, mjs } — NOT full filenames.
// Providing both keys:
//   - Marks isWasmOverridden=true so ORT skips the embedded-module path that
//     throws "cannot determine the script source URL" when import.meta.url is
//     unavailable (esbuild IIFE replaces import.meta with `{}`).
//   - Directs ORT to dynamically import ort-wasm-simd-threaded.mjs (non-JSEP
//     factory) rather than the JSEP factory embedded in the bundle, preventing
//     the 24 MB jsep.wasm from being loaded.
ort.env.wasm.wasmPaths = {
  wasm: chrome.runtime.getURL('libs/ort/ort-wasm-simd-threaded.wasm'),
  mjs:  chrome.runtime.getURL('libs/ort/ort-wasm-simd-threaded.mjs'),
};

// Force single-threaded WASM execution.
//
// The threaded WASM binary spawns Web Workers that communicate via
// SharedArrayBuffer.  In headless Chromium (used by the chrome-devtools MCP
// and Playwright CI) the offscreen document's crossOriginIsolated flag is
// false, which causes the ORT thread-worker handshake to deadlock: workers
// are created but Atomics.wait() blocks indefinitely waiting for the main
// thread to signal, and InferenceSession.create() never resolves.
//
// Setting numThreads = 1 tells ORT to skip worker spawning entirely and run
// inference on the single main thread.  Subtitle-frame images are small
// (typically < 640×100 px) so single-threaded inference is fast enough
// (~100-300 ms per frame on modern hardware).
ort.env.wasm.numThreads = 1;

// Diagnostic: log availability of SharedArrayBuffer and cross-origin isolation.
// These affect which threading path ORT chooses; useful for debugging timeouts.
console.log('[YCR:Offscreen] SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');
console.log('[YCR:Offscreen] crossOriginIsolated:', self.crossOriginIsolated);

// OpenCC: Simplified Chinese → Traditional Chinese (Taiwan Phrases)
// Matches poc_2: opencc.Converter({ from: 'cn', to: 'twp' })
const toTraditional = Converter({ from: 'cn', to: 'twp' });

// Models are pre-bundled in the extension package — no network download required.
const MODEL_URLS = {
  detection:   chrome.runtime.getURL('libs/models/ch_PP-OCRv4_det_infer.onnx'),
  recognition: chrome.runtime.getURL('libs/models/ch_PP-OCRv4_rec_infer.onnx'),
  dictionary:  chrome.runtime.getURL('libs/models/ppocr_keys_v1.txt'),
};

// ── Detection constants (matching ppu-paddle-ocr DEFAULT_DETECTION_OPTIONS) ───
const DET_MEAN       = [0.485, 0.456, 0.406];
const DET_STD        = [0.229, 0.224, 0.225];
const DET_MAX_SIDE   = 640;   // resize longest side to at most this
const DET_THRESHOLD  = 0.3;   // DBNet probability threshold for binary map
const DET_MIN_AREA   = 25;    // minimum blob area in detection-scaled coordinates
const DET_PAD_V      = 0.4;   // vertical padding factor around each detected rect
const DET_PAD_H      = 0.6;   // horizontal padding factor (based on box height, per ppu-paddle-ocr)

// ── Recognition constants ──────────────────────────────────────────────────────
const REC_TARGET_H   = 48;    // recognition model expects h=48 input strips
const REC_MIN_W      = 8;     // minimum crop width after resize (matching ppu-paddle-ocr MIN_CROP_WIDTH)

let detSession  = null;
let recSession  = null;
let dictionary  = null;
let initPromise = null;

// ── Model loading ──────────────────────────────────────────────────────────────

async function loadModel(url) {
  console.log('[YCR:Offscreen] Loading bundled model:', url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load bundled model: ${url} (${response.status})`);
  return response.arrayBuffer();
}

async function ensureOcr() {
  if (detSession && recSession && dictionary) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('[YCR:Offscreen] Loading PaddleOCR models (detection + recognition)...');
      const [detBuffer, recBuffer, dictBuffer] = await Promise.all([
        loadModel(MODEL_URLS.detection),
        loadModel(MODEL_URLS.recognition),
        loadModel(MODEL_URLS.dictionary),
      ]);
      console.log('[YCR:Offscreen] Model buffers fetched:', detBuffer.byteLength, recBuffer.byteLength, dictBuffer.byteLength);

      // One character per line; CTC blank = last index (numClasses - 1 = dictLen)
      const dictText = new TextDecoder().decode(dictBuffer);
      dictionary = dictText.trim().split('\n').map(l => l.trim());
      console.log('[YCR:Offscreen] Dictionary decoded. Dict size:', dictionary.length);

      const t0 = performance.now();
      console.log('[YCR:Offscreen] Creating detection InferenceSession...');
      detSession = await ort.InferenceSession.create(detBuffer, { executionProviders: ['wasm'] });
      const t1 = performance.now();
      console.log('[YCR:Offscreen] Detection session created in', (t1 - t0).toFixed(0), 'ms. Creating recognition session...');
      recSession = await ort.InferenceSession.create(recBuffer, { executionProviders: ['wasm'] });
      const t2 = performance.now();
      console.log(`[YCR] det session: ${(t1 - t0).toFixed(0)}ms  rec session: ${(t2 - t1).toFixed(0)}ms  total: ${(t2 - t0).toFixed(0)}ms`);

      console.log('[YCR:Offscreen] PaddleOCR ready. Dict size:', dictionary.length);
    } catch (err) {
      console.error('[YCR:Offscreen] Init failed:', err);
      initPromise = null; // Allow retry
      throw err;
    }
  })();

  return initPromise;
}

// ── Detection ──────────────────────────────────────────────────────────────────

/**
 * Preprocess a canvas for the detection model.
 *
 * Matches ppu-paddle-ocr BaseDetectionService.preprocessDetection():
 *   1. Resize so longest side ≤ DET_MAX_SIDE (maintain aspect ratio)
 *   2. Pad width + height to nearest 32-multiple (ONNX model constraint)
 *   3. Normalize per channel: (pixel/255 − mean[c]) / std[c]
 *   4. Return NCHW Float32Array [1, 3, modelH, modelW]
 *
 * Canvas drawImage replaces ppu-ocv processor.resize() (cv.resize, bilinear — identical result).
 */
function preprocessForDetection(srcCanvas) {
  const origW = srcCanvas.width;
  const origH = srcCanvas.height;

  // Step 1: compute resize ratio
  let ratio = 1;
  if (Math.max(origW, origH) > DET_MAX_SIDE) {
    ratio = DET_MAX_SIDE / Math.max(origW, origH);
  }
  const resizeW = Math.round(origW * ratio);
  const resizeH = Math.round(origH * ratio);

  // Step 2: pad to 32-multiples
  const modelW = Math.ceil(resizeW / 32) * 32;
  const modelH = Math.ceil(resizeH / 32) * 32;

  // Draw resized image into padded canvas (undrawn area stays black = 0)
  const canvas = document.createElement('canvas');
  canvas.width  = modelW;
  canvas.height = modelH;
  canvas.getContext('2d').drawImage(srcCanvas, 0, 0, resizeW, resizeH);
  const { data } = canvas.getContext('2d').getImageData(0, 0, modelW, modelH);

  // Step 3: RGBA pixels → NCHW Float32 [1, 3, modelH, modelW]
  const HW = modelH * modelW;
  const tensor = new Float32Array(3 * HW);
  for (let i = 0; i < HW; i++) {
    for (let c = 0; c < 3; c++) {
      tensor[c * HW + i] = (data[i * 4 + c] / 255 - DET_MEAN[c]) / DET_STD[c];
    }
  }

  return { tensor, modelW, modelH, resizeRatio: ratio, origW, origH };
}

/**
 * Post-process the detection model probability map into axis-aligned bounding rects
 * in original image coordinates.
 *
 * Replaces ppu-paddle-ocr BaseDetectionService.postprocessDetection():
 *   cv.findContours → pure-JS BFS connected components (4-connected, head-pointer queue)
 *   contours.getRect → min/max x,y tracked during BFS
 *   applyPaddingToRect + convertToOriginalCoordinates → reproduced exactly
 *
 * No perspective transform: DBNet returns axis-aligned rects; warp is only needed
 * for rotated text (not applicable to horizontal YouTube subtitles).
 */
function postprocessDetection(probData, modelW, modelH, resizeRatio, origW, origH) {
  // Step 1: threshold probability map → binary mask
  const binary  = new Uint8Array(modelH * modelW);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = probData[i] >= DET_THRESHOLD ? 1 : 0;
  }

  // Step 2: BFS connected components → bounding rectangles
  // Uses a head-pointer array (avoids O(n²) Array.shift)
  const visited = new Uint8Array(modelH * modelW);
  const boxes   = [];

  for (let y = 0; y < modelH; y++) {
    for (let x = 0; x < modelW; x++) {
      const idx = y * modelW + x;
      if (!binary[idx] || visited[idx]) continue;

      const queue = [idx];
      visited[idx] = 1;
      let head = 0;
      let minX = x, maxX = x, minY = y, maxY = y;

      while (head < queue.length) {
        const cur = queue[head++];
        const cx  = cur % modelW;
        const cy  = (cur - cx) / modelW;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 4-connected neighbours
        if (cx > 0) {
          const n = cur - 1;
          if (binary[n] && !visited[n]) { visited[n] = 1; queue.push(n); }
        }
        if (cx < modelW - 1) {
          const n = cur + 1;
          if (binary[n] && !visited[n]) { visited[n] = 1; queue.push(n); }
        }
        if (cy > 0) {
          const n = cur - modelW;
          if (binary[n] && !visited[n]) { visited[n] = 1; queue.push(n); }
        }
        if (cy < modelH - 1) {
          const n = cur + modelW;
          if (binary[n] && !visited[n]) { visited[n] = 1; queue.push(n); }
        }
      }

      // Filter by minimum area (matches ppu-paddle-ocr minimumAreaThreshold)
      const area = (maxX - minX + 1) * (maxY - minY + 1);
      if (area < DET_MIN_AREA) continue;

      // Step 3: apply padding — matches ppu-paddle-ocr applyPaddingToRect()
      // horizontal padding is also scaled from box height (not width), per ppu-paddle-ocr
      const bh   = maxY - minY + 1;
      const vpad = Math.round(bh * DET_PAD_V);
      const hpad = Math.round(bh * DET_PAD_H);

      const px  = Math.max(0,      minX - hpad);
      const py  = Math.max(0,      minY - vpad);
      const px2 = Math.min(modelW, maxX + 1 + hpad);
      const py2 = Math.min(modelH, maxY + 1 + vpad);

      // Step 4: scale back to original image coords — matches convertToOriginalCoordinates()
      const scale = 1 / resizeRatio;
      const ox  = Math.max(0,     Math.round(px  * scale));
      const oy  = Math.max(0,     Math.round(py  * scale));
      const ox2 = Math.min(origW, Math.round(px2 * scale));
      const oy2 = Math.min(origH, Math.round(py2 * scale));

      const fw = ox2 - ox;
      const fh = oy2 - oy;
      if (fw > 5 && fh > 5) {
        boxes.push({ x: ox, y: oy, width: fw, height: fh });
      }
    }
  }

  // Sort by reading order — matches ppu-paddle-ocr sortResultsByReadingOrder()
  boxes.sort((a, b) => {
    if (Math.abs(a.y - b.y) < (a.height + b.height) / 4) return a.x - b.x;
    return a.y - b.y;
  });

  return boxes;
}

/**
 * Run the detection model on a canvas and return text region bounding rects.
 */
async function detectTextRegions(srcCanvas) {
  const { tensor, modelW, modelH, resizeRatio, origW, origH } =
    preprocessForDetection(srcCanvas);

  const inputTensor = new ort.Tensor('float32', tensor, [1, 3, modelH, modelW]);
  let output;
  try {
    const results = await detSession.run({ x: inputTensor });
    // output.dims = [1, 1, modelH, modelW]; .data is Float32Array of modelH*modelW values
    output = results[Object.keys(results)[0]];
  } finally {
    inputTensor.dispose();
  }

  return postprocessDetection(output.data, modelW, modelH, resizeRatio, origW, origH);
}

// ── Recognition ────────────────────────────────────────────────────────────────

/**
 * Preprocess a crop canvas for the recognition model.
 *
 * Matches ppu-paddle-ocr BaseRecognitionService.preprocessImage() +
 *         createImageTensor() + processor.resize():
 *   1. Resize to h=48, maintain aspect ratio (min w=REC_MIN_W)
 *   2. Normalize each channel independently: (pixel/255 − 0.5) / 0.5 = pixel/127.5 − 1.0
 *   3. Return NCHW Float32Array [1, 3, 48, newW]
 *
 * Canvas drawImage replaces ppu-ocv processor.resize() (cv.resize bilinear — identical).
 * Per-channel RGB normalization matches the PP-OCRv4 training preprocessing convention.
 */
function preprocessForRecognition(cropCanvas) {
  const newW = Math.max(
    REC_MIN_W,
    Math.round(cropCanvas.width * REC_TARGET_H / cropCanvas.height)
  );

  const canvas = document.createElement('canvas');
  canvas.width  = newW;
  canvas.height = REC_TARGET_H;
  canvas.getContext('2d').drawImage(cropCanvas, 0, 0, newW, REC_TARGET_H);
  const { data } = canvas.getContext('2d').getImageData(0, 0, newW, REC_TARGET_H);

  const HW     = REC_TARGET_H * newW;
  const tensor = new Float32Array(3 * HW);
  for (let i = 0; i < HW; i++) {
    tensor[i]          = data[i * 4]     / 127.5 - 1.0; // R
    tensor[HW + i]     = data[i * 4 + 1] / 127.5 - 1.0; // G
    tensor[HW * 2 + i] = data[i * 4 + 2] / 127.5 - 1.0; // B
  }

  return { tensor, width: newW };
}

/**
 * CTC greedy decode.
 * For ch_PP-OCRv4_rec + ppocr_keys_v1.txt: blank token = last index (numClasses − 1 = dictLen).
 */
function ctcDecode(logits, seqLen, numClasses) {
  const blank = numClasses - 1;
  let prevIdx = -1;
  let result  = '';

  for (let t = 0; t < seqLen; t++) {
    let maxIdx = 0, maxVal = -Infinity;
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

/**
 * Crop a bounding rect from a source canvas, then run recognition.
 *
 * Crop matches ppu-paddle-ocr BaseRecognitionService.cropRegion() →
 *   CanvasToolkit.crop() which is ctx.drawImage(src, x0,y0,w,h, 0,0,w,h).
 */
async function recognizeCrop(srcCanvas, box) {
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width  = box.width;
  cropCanvas.height = box.height;
  cropCanvas.getContext('2d').drawImage(
    srcCanvas, box.x, box.y, box.width, box.height,
    0, 0, box.width, box.height
  );

  const { tensor, width } = preprocessForRecognition(cropCanvas);
  const inputTensor = new ort.Tensor('float32', tensor, [1, 3, REC_TARGET_H, width]);
  try {
    const results = await recSession.run({ x: inputTensor });
    const output  = results[Object.keys(results)[0]];
    const [, seqLen, numClasses] = output.dims;
    return ctcDecode(output.data, seqLen, numClasses);
  } finally {
    inputTensor.dispose();
  }
}

// ── Message handler ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'OFFSCREEN_OCR_RECOGNIZE') return;

  (async () => {
    try {
      if (!message.imageDataUrl) {
        sendResponse({ ok: false, error: 'Missing imageDataUrl' });
        return;
      }

      await ensureOcr();

      // Load image data URL into a canvas (the original unmodified image)
      const img = new Image();
      img.src = message.imageDataUrl;
      await img.decode();
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width  = img.width;
      srcCanvas.height = img.height;
      srcCanvas.getContext('2d').drawImage(img, 0, 0);

      // Step 1: detect text regions in the subtitle area
      const boxes = await detectTextRegions(srcCanvas);
      console.log('[YCR:Offscreen] Detected', boxes.length, 'text region(s)');

      if (boxes.length === 0) {
        sendResponse({ ok: true, text: '', confidence: 0 });
        return;
      }

      // Step 2: recognise each crop and collect raw text
      // Matches poc_2: lines.map(l => l.text).join('')
      const parts = [];
      for (const box of boxes) {
        const rawText = await recognizeCrop(srcCanvas, box);
        if (rawText) parts.push(rawText);
      }

      // Step 3: join and convert Simplified → Traditional
      // Matches poc_2: toTraditional(lines.map(l => l.text).join(''))
      const text = toTraditional(parts.join(''));

      console.log('[YCR:Offscreen] OCR result:', text);
      sendResponse({ ok: true, text, confidence: 0 });
    } catch (err) {
      console.error('[YCR:Offscreen] OCR error:', err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true;
});
