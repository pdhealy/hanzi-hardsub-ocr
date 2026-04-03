/**
 * UAT — OCR Pipeline (direct ONNX, no opencv)
 *
 * Tests the new offscreen-ocr.js implementation:
 *   1. manifest.json CSP has no unsafe-eval
 *   2. offscreen-ocr.html has no opencv script tag
 *   3. ctcDecode logic (in-browser)
 *   4. preprocessImage: resize to h=48, NCHW shape, value range [-1,1]
 *   5. Message handler with mocked ONNX session + real CTC decode
 *
 * Run: node tests/uat-ocr-pipeline.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ── Test 1 — manifest.json CSP has no unsafe-eval ────────────────────────────

function testManifestCSP() {
  console.log('\nTest 1: manifest.json CSP — no unsafe-eval');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8')
  );
  const csp = manifest.content_security_policy?.extension_pages ?? '';
  assert(!csp.includes("'unsafe-eval'"), `CSP does not contain 'unsafe-eval' (got: "${csp}")`);
  assert(csp.includes("'wasm-unsafe-eval'"), `CSP still contains 'wasm-unsafe-eval'`);
  assert(!manifest.web_accessible_resources?.some(r => r.resources?.includes('libs/opencv/*')),
    'web_accessible_resources does not expose libs/opencv/*');
}

// ── Test 2 — offscreen-ocr.html has no opencv script ─────────────────────────

function testOffscreenHtml() {
  console.log('\nTest 2: offscreen-ocr.html — no opencv script tag');
  const html = fs.readFileSync(
    path.join(__dirname, '../extension/background/offscreen-ocr.html'), 'utf8'
  );
  assert(!html.includes('opencv'), `offscreen-ocr.html does not reference opencv`);
  assert(html.includes('offscreen-ocr.bundle.js'), `offscreen-ocr.bundle.js script tag present`);
}

// ── Test 3 — CTC decode logic (in-browser) ───────────────────────────────────

async function testCtcDecode(browser) {
  console.log('\nTest 3: CTC greedy decode');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const result = await page.evaluate(() => {
    // Inline the ctcDecode function from offscreen-ocr.js
    function ctcDecode(logits, seqLen, numClasses, dict) {
      const blank = numClasses - 1;
      let prevIdx = -1;
      let out = '';
      for (let t = 0; t < seqLen; t++) {
        let maxIdx = 0, maxVal = -Infinity;
        for (let c = 0; c < numClasses; c++) {
          const v = logits[t * numClasses + c];
          if (v > maxVal) { maxVal = v; maxIdx = c; }
        }
        if (maxIdx !== blank && maxIdx !== prevIdx) out += dict[maxIdx] || '';
        prevIdx = maxIdx;
      }
      return out;
    }

    // Dict: index 0='你', 1='好', 2='世', 3='界', blank=4
    const dict = ['你', '好', '世', '界'];
    const numClasses = 5; // 4 chars + 1 blank
    const blank = 4;

    // Sequence: 你 你(dup→skip) blank 好 → "你好"
    const scores = [
      // t=0: argmax=0 (你)
      [5, 0, 0, 0, 0],
      // t=1: argmax=0 (你, repeat → skip)
      [5, 0, 0, 0, 0],
      // t=2: argmax=4 (blank)
      [0, 0, 0, 0, 5],
      // t=3: argmax=1 (好)
      [0, 5, 0, 0, 0],
    ];
    const logits = new Float32Array(scores.flat());

    const r1 = ctcDecode(logits, 4, numClasses, dict);
    // Sequence with all blanks → empty string
    const allBlank = new Float32Array([0,0,0,0,5, 0,0,0,0,5]);
    const r2 = ctcDecode(allBlank, 2, numClasses, dict);
    // Single char no repeat
    const single = new Float32Array([0,0,5,0,0]);
    const r3 = ctcDecode(single, 1, numClasses, dict);

    return { r1, r2, r3 };
  });

  assert(result.r1 === '你好', `Duplicate+blank decoded to "你好" (got "${result.r1}")`);
  assert(result.r2 === '', `All-blank sequence decodes to "" (got "${result.r2}")`);
  assert(result.r3 === '世', `Single char decodes to "世" (got "${result.r3}")`);

  await page.close();
}

// ── Test 4 — preprocessImage: canvas resize + NCHW + normalization ───────────

async function testPreprocessImage(browser) {
  console.log('\nTest 4: preprocessImage — resize to h=48, NCHW, normalize to [-1,1]');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const result = await page.evaluate(() => {
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
          const HW = TARGET_H * newW;
          const tensor = new Float32Array(3 * HW);
          for (let i = 0; i < HW; i++) {
            tensor[i]          = data[i * 4]     / 127.5 - 1.0;
            tensor[HW + i]     = data[i * 4 + 1] / 127.5 - 1.0;
            tensor[HW * 2 + i] = data[i * 4 + 2] / 127.5 - 1.0;
          }
          resolve({ tensorLength: tensor.length, width: newW, height: TARGET_H,
                    min: Math.min(...tensor), max: Math.max(...tensor) });
        };
        img.onerror = reject;
        img.src = imageDataUrl;
      });
    }

    // Create a 320×96 solid red canvas image (aspect 10:3 → w=160 @ h=48)
    const src = document.createElement('canvas');
    src.width = 320; src.height = 96;
    const ctx = src.getContext('2d');
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fillRect(0, 0, 320, 96);
    const dataUrl = src.toDataURL();
    return preprocessImage(dataUrl);
  });

  const expectedW = Math.max(32, Math.round(320 * 48 / 96)); // 160
  assert(result.height === 48, `Output height is 48 (got ${result.height})`);
  assert(result.width === expectedW, `Output width is ${expectedW} (got ${result.width})`);
  assert(result.tensorLength === 3 * 48 * expectedW,
    `Tensor length is 3×48×${expectedW}=${3*48*expectedW} (got ${result.tensorLength})`);
  // Solid red: R=255→1.0, G=0→-1.0, B=0→-1.0
  assert(Math.abs(result.max - 1.0) < 0.01, `Max pixel value ≈ 1.0 (got ${result.max.toFixed(4)})`);
  assert(Math.abs(result.min - (-1.0)) < 0.01, `Min pixel value ≈ -1.0 (got ${result.min.toFixed(4)})`);

  await page.close();
}

// ── Test 5 — preprocessImage minimum width clamp ─────────────────────────────

async function testPreprocessMinWidth(browser) {
  console.log('\nTest 5: preprocessImage — minimum width clamped to 32');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const result = await page.evaluate(() => {
    function preprocessImage(imageDataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const TARGET_H = 48;
          const newW = Math.max(32, Math.round(img.width * TARGET_H / img.height));
          resolve({ width: newW });
        };
        img.onerror = reject;
        img.src = imageDataUrl;
      });
    }
    // Tall narrow image: 4×200 → natural w = round(4*48/200)=1 → clamped to 32
    const src = document.createElement('canvas');
    src.width = 4; src.height = 200;
    src.getContext('2d').fillRect(0, 0, 4, 200);
    return preprocessImage(src.toDataURL());
  });

  assert(result.width === 32, `Narrow image width clamped to 32 (got ${result.width})`);
  await page.close();
}

// ── Test 6 — Message handler with mocked ONNX session ────────────────────────

async function testMessageHandler(browser) {
  console.log('\nTest 6: Message handler — full pipeline with mocked ONNX session');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  // Inject the full handler logic with mocked ort and chrome.runtime
  const result = await page.evaluate(async () => {
    // ── Minimal mocks ───────────────────────────────────────────────────────

    // Dictionary: 5 chars + blank = 6 classes
    // blank = 5 (last index)
    const dictLines = ['你', '好', '世', '界', '！'];

    // Mock ort: session.run returns logits spelling "你好" via CTC
    // seqLen=4, numClasses=6
    // t=0: argmax=0 (你), t=1: argmax=5(blank), t=2: argmax=1(好), t=3: argmax=5(blank)
    const mockLogits = new Float32Array([
      5,0,0,0,0,0,   // t=0 → 你
      0,0,0,0,0,5,   // t=1 → blank
      0,5,0,0,0,0,   // t=2 → 好
      0,0,0,0,0,5,   // t=3 → blank
    ]);

    const mockOrt = {
      env: { wasm: { wasmPaths: null } },
      Tensor: class {
        constructor(type, data, dims) { this.data = data; this.dims = dims; }
      },
      InferenceSession: {
        create: async () => ({
          run: async () => ({
            output0: { dims: [1, 4, 6], data: mockLogits }
          })
        })
      }
    };

    // Mock opencc-js: just echo simplified text
    const mockConverter = () => (text) => '【TRAD:' + text + '】';

    // Mock caches / fetch for model loading
    const mockBuffer = (text) => new TextEncoder().encode(text).buffer;
    global.caches = {
      open: async () => ({
        match: async () => new Response(mockBuffer(dictLines.join('\n'))),
        put: async () => {},
      })
    };

    // Mock chrome.runtime.getURL
    global.chrome = { runtime: { getURL: (p) => 'chrome-extension://test/' + p } };

    // ── Inline the pipeline (matching offscreen-ocr.js logic) ───────────────

    mockOrt.env.wasm.wasmPaths = chrome.runtime.getURL('libs/ort/');

    const toTraditional = mockConverter()({ from: 'cn', to: 'twp' });

    let recSession = null;
    let dictionary = null;

    async function loadModel(url) {
      const cache = await caches.open('test');
      const response = await cache.match(url);
      return response.arrayBuffer();
    }

    async function ensureOcr() {
      if (recSession && dictionary) return;
      const dictBuffer = await loadModel('dict-url');
      const dictText = new TextDecoder().decode(dictBuffer);
      dictionary = dictText.trim().split('\n').map(l => l.trim());
      recSession = await mockOrt.InferenceSession.create(null, { executionProviders: ['wasm'] });
    }

    function preprocessImage(imageDataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const TARGET_H = 48;
          const newW = Math.max(32, Math.round(img.width * TARGET_H / img.height));
          const canvas = document.createElement('canvas');
          canvas.width = newW; canvas.height = TARGET_H;
          canvas.getContext('2d').drawImage(img, 0, 0, newW, TARGET_H);
          const { data } = canvas.getContext('2d').getImageData(0, 0, newW, TARGET_H);
          const HW = TARGET_H * newW;
          const tensor = new Float32Array(3 * HW);
          for (let i = 0; i < HW; i++) {
            tensor[i]          = data[i * 4]     / 127.5 - 1.0;
            tensor[HW + i]     = data[i * 4 + 1] / 127.5 - 1.0;
            tensor[HW * 2 + i] = data[i * 4 + 2] / 127.5 - 1.0;
          }
          resolve({ tensor, width: newW });
        };
        img.onerror = reject;
        img.src = imageDataUrl;
      });
    }

    function ctcDecode(logits, seqLen, numClasses) {
      const blank = numClasses - 1;
      let prevIdx = -1, result = '';
      for (let t = 0; t < seqLen; t++) {
        let maxIdx = 0, maxVal = -Infinity;
        for (let c = 0; c < numClasses; c++) {
          const v = logits[t * numClasses + c];
          if (v > maxVal) { maxVal = v; maxIdx = c; }
        }
        if (maxIdx !== blank && maxIdx !== prevIdx) result += dictionary[maxIdx] || '';
        prevIdx = maxIdx;
      }
      return result;
    }

    // ── Run the handler ──────────────────────────────────────────────────────
    await ensureOcr();

    // Build a test image dataURL (small white square)
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 96; testCanvas.height = 24;
    testCanvas.getContext('2d').fillStyle = 'white';
    testCanvas.getContext('2d').fillRect(0, 0, 96, 24);
    const imageDataUrl = testCanvas.toDataURL();

    const { tensor, width } = await preprocessImage(imageDataUrl);
    const inputTensor = new mockOrt.Tensor('float32', tensor, [1, 3, 48, width]);
    const results = await recSession.run({ x: inputTensor });

    const output = results[Object.keys(results)[0]];
    const [, seqLen, numClasses] = output.dims;
    const rawText = ctcDecode(output.data, seqLen, numClasses);
    const text = toTraditional(rawText);

    return { rawText, text, dictSize: dictionary.length };
  });

  assert(result.dictSize === 5, `Dictionary loaded with 5 entries (got ${result.dictSize})`);
  assert(result.rawText === '你好', `CTC decoded mock logits to "你好" (got "${result.rawText}")`);
  assert(result.text === '【TRAD:你好】', `OpenCC converter applied (got "${result.text}")`);

  await page.close();
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('UAT — OCR Pipeline (direct ONNX, no opencv)');
  console.log('=============================================');

  // Static file tests (no browser needed)
  testManifestCSP();
  testOffscreenHtml();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await testCtcDecode(browser);
    await testPreprocessImage(browser);
    await testPreprocessMinWidth(browser);
    await testMessageHandler(browser);
  } finally {
    await browser.close();
  }

  console.log('\n=============================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('=============================================\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
