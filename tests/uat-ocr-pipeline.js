/**
 * UAT — OCR Pipeline (full PaddleOCR: detection + recognition, no opencv)
 *
 * Tests the offscreen-ocr.js implementation:
 *   1. manifest.json CSP has no unsafe-eval
 *   2. offscreen-ocr.html has no opencv script tag
 *   3. ctcDecode logic (in-browser)
 *   4. preprocessForDetection: NCHW shape, ImageNet normalisation, 32-multiple padding
 *   5. preprocessForRecognition: resize to h=48, NCHW shape, per-channel normalisation [-1,1]
 *   6. postprocessDetection: BFS connected components → bounding rects (pure-JS)
 *   7. Message handler — full pipeline with mocked det + rec ONNX sessions
 *
 * Run: node tests/uat-ocr-pipeline.js
 */

const { chromium } = require('playwright');
const fs   = require('fs');
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

// ── Test 3 — CTC decode logic ─────────────────────────────────────────────────

async function testCtcDecode(browser) {
  console.log('\nTest 3: CTC greedy decode');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const result = await page.evaluate(() => {
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

    // Sequence: 你 你(dup→skip) blank 好 → "你好"
    const scores = [
      [5, 0, 0, 0, 0], // t=0: argmax=0 (你)
      [5, 0, 0, 0, 0], // t=1: argmax=0 (你, repeat → skip)
      [0, 0, 0, 0, 5], // t=2: argmax=4 (blank)
      [0, 5, 0, 0, 0], // t=3: argmax=1 (好)
    ];
    const logits = new Float32Array(scores.flat());

    const r1 = ctcDecode(logits, 4, numClasses, dict);
    const r2 = ctcDecode(new Float32Array([0,0,0,0,5, 0,0,0,0,5]), 2, numClasses, dict);
    const r3 = ctcDecode(new Float32Array([0,0,5,0,0]), 1, numClasses, dict);

    return { r1, r2, r3 };
  });

  assert(result.r1 === '你好', `Duplicate+blank decoded to "你好" (got "${result.r1}")`);
  assert(result.r2 === '',     `All-blank sequence decodes to "" (got "${result.r2}")`);
  assert(result.r3 === '世',   `Single char decodes to "世" (got "${result.r3}")`);

  await page.close();
}

// ── Test 4 — preprocessForDetection: shape, normalisation, 32-multiple padding ─

async function testPreprocessForDetection(browser) {
  console.log('\nTest 4: preprocessForDetection — NCHW, ImageNet normalisation, 32-pad');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const result = await page.evaluate(() => {
    const DET_MEAN     = [0.485, 0.456, 0.406];
    const DET_STD      = [0.229, 0.224, 0.225];
    const DET_MAX_SIDE = 640;

    function preprocessForDetection(srcCanvas) {
      const origW = srcCanvas.width;
      const origH = srcCanvas.height;
      let ratio = 1;
      if (Math.max(origW, origH) > DET_MAX_SIDE) {
        ratio = DET_MAX_SIDE / Math.max(origW, origH);
      }
      const resizeW = Math.round(origW * ratio);
      const resizeH = Math.round(origH * ratio);
      const modelW  = Math.ceil(resizeW / 32) * 32;
      const modelH  = Math.ceil(resizeH / 32) * 32;

      const canvas = document.createElement('canvas');
      canvas.width = modelW; canvas.height = modelH;
      canvas.getContext('2d').drawImage(srcCanvas, 0, 0, resizeW, resizeH);
      const { data } = canvas.getContext('2d').getImageData(0, 0, modelW, modelH);

      const HW = modelH * modelW;
      const tensor = new Float32Array(3 * HW);
      for (let i = 0; i < HW; i++) {
        for (let c = 0; c < 3; c++) {
          tensor[c * HW + i] = (data[i * 4 + c] / 255 - DET_MEAN[c]) / DET_STD[c];
        }
      }
      return { tensor, modelW, modelH, resizeRatio: ratio };
    }

    // 100×60 solid white image (no resize needed, ≤ 640)
    const src = document.createElement('canvas');
    src.width = 100; src.height = 60;
    const ctx = src.getContext('2d');
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.fillRect(0, 0, 100, 60);

    const out = preprocessForDetection(src);

    // Expected: resizeW=100→pad to 128, resizeH=60→pad to 64
    const expW = Math.ceil(100 / 32) * 32; // 128
    const expH = Math.ceil(60  / 32) * 32; // 64
    const HW = expW * expH;

    // White pixel (255,255,255): (1 - mean[c]) / std[c] per channel
    const expR = (1.0 - 0.485) / 0.229;
    const expG = (1.0 - 0.456) / 0.224;
    const expB = (1.0 - 0.406) / 0.225;

    // Sample channel-0 pixel 0 (first pixel in the 100×60 filled region)
    const ch0val = out.tensor[0];
    const ch1val = out.tensor[HW];
    const ch2val = out.tensor[HW * 2];

    return {
      modelW: out.modelW, modelH: out.modelH, tensorLen: out.tensor.length,
      ratio: out.resizeRatio,
      ch0val, ch1val, ch2val,
      expW, expH, expR, expG, expB,
    };
  });

  assert(result.modelW === result.expW,
    `Detection model width padded to ${result.expW} (got ${result.modelW})`);
  assert(result.modelH === result.expH,
    `Detection model height padded to ${result.expH} (got ${result.modelH})`);
  assert(result.tensorLen === 3 * result.expW * result.expH,
    `Tensor length = 3×${result.expW}×${result.expH} (got ${result.tensorLen})`);
  assert(result.ratio === 1, `No resize for 100×60 image (ratio ${result.ratio})`);
  assert(Math.abs(result.ch0val - result.expR) < 0.001,
    `Channel-R normalized correctly: ${result.expR.toFixed(4)} (got ${result.ch0val.toFixed(4)})`);
  assert(Math.abs(result.ch1val - result.expG) < 0.001,
    `Channel-G normalized correctly: ${result.expG.toFixed(4)} (got ${result.ch1val.toFixed(4)})`);
  assert(Math.abs(result.ch2val - result.expB) < 0.001,
    `Channel-B normalized correctly: ${result.expB.toFixed(4)} (got ${result.ch2val.toFixed(4)})`);

  await page.close();
}

// ── Test 5 — preprocessForRecognition: h=48, per-channel [-1,1] ──────────────

async function testPreprocessForRecognition(browser) {
  console.log('\nTest 5: preprocessForRecognition — resize to h=48, NCHW, per-channel [-1,1]');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const result = await page.evaluate(() => {
    const REC_TARGET_H = 48;
    const REC_MIN_W    = 8;

    function preprocessForRecognition(cropCanvas) {
      const newW = Math.max(REC_MIN_W,
        Math.round(cropCanvas.width * REC_TARGET_H / cropCanvas.height));
      const canvas = document.createElement('canvas');
      canvas.width = newW; canvas.height = REC_TARGET_H;
      canvas.getContext('2d').drawImage(cropCanvas, 0, 0, newW, REC_TARGET_H);
      const { data } = canvas.getContext('2d').getImageData(0, 0, newW, REC_TARGET_H);
      const HW = REC_TARGET_H * newW;
      const tensor = new Float32Array(3 * HW);
      for (let i = 0; i < HW; i++) {
        tensor[i]          = data[i * 4]     / 127.5 - 1.0;
        tensor[HW + i]     = data[i * 4 + 1] / 127.5 - 1.0;
        tensor[HW * 2 + i] = data[i * 4 + 2] / 127.5 - 1.0;
      }
      return { tensor, width: newW };
    }

    // 320×96 solid red → aspect 10:3 → newW = round(320*48/96) = 160
    const src = document.createElement('canvas');
    src.width = 320; src.height = 96;
    const ctx = src.getContext('2d');
    ctx.fillStyle = 'rgb(255,0,0)';
    ctx.fillRect(0, 0, 320, 96);

    const out = preprocessForRecognition(src);
    const expectedW = Math.max(8, Math.round(320 * 48 / 96)); // 160

    // Narrow image: 4×200 → natural w=round(4*48/200)=1 → clamped to REC_MIN_W=8
    const narrow = document.createElement('canvas');
    narrow.width = 4; narrow.height = 200;
    narrow.getContext('2d').fillRect(0, 0, 4, 200);
    const narrowOut = preprocessForRecognition(narrow);

    return {
      height: REC_TARGET_H,
      width: out.width,
      tensorLen: out.tensor.length,
      maxVal: Math.max(...out.tensor),
      minVal: Math.min(...out.tensor),
      expectedW,
      narrowWidth: narrowOut.width,
    };
  });

  assert(result.width === result.expectedW,
    `Output width is ${result.expectedW} (got ${result.width})`);
  assert(result.tensorLen === 3 * 48 * result.expectedW,
    `Tensor length is 3×48×${result.expectedW}=${3*48*result.expectedW} (got ${result.tensorLen})`);
  // Solid red: R=255→1.0, G=0→-1.0, B=0→-1.0
  assert(Math.abs(result.maxVal - 1.0) < 0.01,
    `Max value ≈ 1.0 (R channel, got ${result.maxVal.toFixed(4)})`);
  assert(Math.abs(result.minVal - (-1.0)) < 0.01,
    `Min value ≈ -1.0 (G/B channels, got ${result.minVal.toFixed(4)})`);
  assert(result.narrowWidth === 8,
    `Narrow image width clamped to REC_MIN_W=8 (got ${result.narrowWidth})`);

  await page.close();
}

// ── Test 6 — postprocessDetection: BFS connected components → bounding rects ──

async function testPostprocessDetection(browser) {
  console.log('\nTest 6: postprocessDetection — BFS connected components, padding, coord scaling');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const result = await page.evaluate(() => {
    const DET_THRESHOLD = 0.3;
    const DET_MIN_AREA  = 25;
    const DET_PAD_V     = 0.4;
    const DET_PAD_H     = 0.6;

    function postprocessDetection(probData, modelW, modelH, resizeRatio, origW, origH) {
      const binary  = new Uint8Array(modelH * modelW);
      for (let i = 0; i < binary.length; i++) {
        binary[i] = probData[i] >= DET_THRESHOLD ? 1 : 0;
      }

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
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;

            if (cx > 0)          { const n=cur-1;       if (binary[n]&&!visited[n]) { visited[n]=1; queue.push(n); } }
            if (cx < modelW - 1) { const n=cur+1;       if (binary[n]&&!visited[n]) { visited[n]=1; queue.push(n); } }
            if (cy > 0)          { const n=cur-modelW;  if (binary[n]&&!visited[n]) { visited[n]=1; queue.push(n); } }
            if (cy < modelH - 1) { const n=cur+modelW;  if (binary[n]&&!visited[n]) { visited[n]=1; queue.push(n); } }
          }

          const area = (maxX - minX + 1) * (maxY - minY + 1);
          if (area < DET_MIN_AREA) continue;

          const bh   = maxY - minY + 1;
          const vpad = Math.round(bh * DET_PAD_V);
          const hpad = Math.round(bh * DET_PAD_H);
          const px  = Math.max(0,      minX - hpad);
          const py  = Math.max(0,      minY - vpad);
          const px2 = Math.min(modelW, maxX + 1 + hpad);
          const py2 = Math.min(modelH, maxY + 1 + vpad);

          const scale = 1 / resizeRatio;
          const ox  = Math.max(0,     Math.round(px  * scale));
          const oy  = Math.max(0,     Math.round(py  * scale));
          const ox2 = Math.min(origW, Math.round(px2 * scale));
          const oy2 = Math.min(origH, Math.round(py2 * scale));
          const fw  = ox2 - ox;
          const fh  = oy2 - oy;
          if (fw > 5 && fh > 5) boxes.push({ x: ox, y: oy, width: fw, height: fh });
        }
      }

      boxes.sort((a, b) => {
        if (Math.abs(a.y - b.y) < (a.height + b.height) / 4) return a.x - b.x;
        return a.y - b.y;
      });
      return boxes;
    }

    // ── Scenario A: single 10×10 blob at (5,5) in a 32×32 map, ratio=1 ─────
    const mapA = new Float32Array(32 * 32).fill(0);
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        mapA[y * 32 + x] = 0.8;
      }
    }
    const boxesA = postprocessDetection(mapA, 32, 32, 1, 32, 32);

    // ── Scenario B: empty map → no boxes ──────────────────────────────────
    const mapB   = new Float32Array(32 * 32).fill(0.1);
    const boxesB = postprocessDetection(mapB, 32, 32, 1, 32, 32);

    // ── Scenario C: two separate blobs → two boxes ────────────────────────
    const mapC = new Float32Array(32 * 32).fill(0);
    // Blob 1: rows 2-7, cols 2-10 (9×6 = 54 px > 25)
    for (let y = 2; y <= 7; y++)
      for (let x = 2; x <= 10; x++) mapC[y * 32 + x] = 0.9;
    // Blob 2: rows 20-26, cols 15-25 (11×7 = 77 px > 25)
    for (let y = 20; y <= 26; y++)
      for (let x = 15; x <= 25; x++) mapC[y * 32 + x] = 0.9;
    const boxesC = postprocessDetection(mapC, 32, 32, 1, 32, 32);

    return {
      boxesA, boxCountA: boxesA.length,
      boxCountB: boxesB.length,
      boxCountC: boxesC.length,
    };
  });

  assert(result.boxCountA === 1, `Single blob → 1 box (got ${result.boxCountA})`);
  assert(result.boxesA[0] !== undefined, `Box from single blob is defined`);
  // 10×10 blob at (5,5): bh=10, vpad=4, hpad=6; padded rect x=[-1→0,21], y=[1,19]; w=21,h=18
  assert(result.boxesA[0].width > 0 && result.boxesA[0].height > 0,
    `Single blob box has positive dimensions (w=${result.boxesA[0].width}, h=${result.boxesA[0].height})`);
  assert(result.boxCountB === 0, `All-below-threshold map → 0 boxes (got ${result.boxCountB})`);
  assert(result.boxCountC === 2, `Two separate blobs → 2 boxes (got ${result.boxCountC})`);

  await page.close();
}

// ── Test 7 — Message handler: full pipeline with mocked det + rec sessions ────

async function testMessageHandler(browser) {
  console.log('\nTest 7: Message handler — full pipeline with mocked detection + recognition');
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const result = await page.evaluate(async () => {
    // ── Mocks ────────────────────────────────────────────────────────────────

    const dictLines = ['你', '好', '世', '界', '！'];

    // Detection session: returns a single full-image blob (one box)
    // Output shape [1,1,32,64]: all pixels = 0.9 (above threshold)
    const detH = 32, detW = 64;
    const detData = new Float32Array(detH * detW).fill(0.9);
    const mockDetSession = {
      run: async () => ({
        det_out: { dims: [1, 1, detH, detW], data: detData }
      })
    };

    // Recognition session: returns logits spelling "你好"
    // seqLen=4, numClasses=6 (5 chars + blank=5)
    const mockLogits = new Float32Array([
      5,0,0,0,0,0,  // t=0 → 你
      0,0,0,0,0,5,  // t=1 → blank
      0,5,0,0,0,0,  // t=2 → 好
      0,0,0,0,0,5,  // t=3 → blank
    ]);
    const mockRecSession = {
      run: async () => ({
        rec_out: { dims: [1, 4, 6], data: mockLogits }
      })
    };

    // Mock ort.Tensor and ort.InferenceSession.create
    let detSessionCreated = false;
    const mockOrt = {
      env: { wasm: { wasmPaths: null } },
      Tensor: class {
        constructor(_type, data, dims) { this.data = data; this.dims = dims; }
        dispose() {}
      },
      InferenceSession: {
        create: async (_buffer) => {
          // First call = detection, second = recognition (matches Promise.all order)
          if (!detSessionCreated) { detSessionCreated = true; return mockDetSession; }
          return mockRecSession;
        }
      }
    };

    // Mock opencc-js Converter
    const mockConverter = (_opts) => (text) => '【TRAD:' + text + '】';

    // Mock caches: returns dict for any match
    const mockBuffer = (text) => new TextEncoder().encode(text).buffer;
    window.caches = {
      open: async () => ({
        match: async () => new Response(mockBuffer(dictLines.join('\n'))),
        put: async () => {},
      })
    };

    window.chrome = { runtime: { getURL: (p) => 'chrome-extension://test/' + p } };

    // ── Inline the pipeline (must mirror offscreen-ocr.js structure) ─────────

    mockOrt.env.wasm.wasmPaths = window.chrome.runtime.getURL('libs/ort/');
    const toTraditional = mockConverter({ from: 'cn', to: 'twp' });

    const DET_MEAN=[0.485,0.456,0.406], DET_STD=[0.229,0.224,0.225];
    const DET_MAX_SIDE=640, DET_THRESHOLD=0.3, DET_MIN_AREA=25, DET_PAD_V=0.4, DET_PAD_H=0.6;
    const REC_TARGET_H=48, REC_MIN_W=8;

    let detSession=null, recSession=null, dictionary=null;

    async function loadModel(url) {
      const cache = await caches.open('test');
      const r = await cache.match(url);
      return r.arrayBuffer();
    }

    async function ensureOcr() {
      if (detSession && recSession && dictionary) return;
      const [detBuffer, recBuffer, dictBuffer] = await Promise.all([
        loadModel('det'), loadModel('rec'), loadModel('dict'),
      ]);
      const dictText = new TextDecoder().decode(dictBuffer);
      dictionary = dictText.trim().split('\n').map(l => l.trim());
      [detSession, recSession] = await Promise.all([
        mockOrt.InferenceSession.create(detBuffer),
        mockOrt.InferenceSession.create(recBuffer),
      ]);
    }

    function preprocessForDetection(srcCanvas) {
      const origW=srcCanvas.width, origH=srcCanvas.height;
      let ratio=1;
      if (Math.max(origW,origH) > DET_MAX_SIDE) ratio=DET_MAX_SIDE/Math.max(origW,origH);
      const resizeW=Math.round(origW*ratio), resizeH=Math.round(origH*ratio);
      const modelW=Math.ceil(resizeW/32)*32, modelH=Math.ceil(resizeH/32)*32;
      const canvas=document.createElement('canvas');
      canvas.width=modelW; canvas.height=modelH;
      canvas.getContext('2d').drawImage(srcCanvas,0,0,resizeW,resizeH);
      const {data}=canvas.getContext('2d').getImageData(0,0,modelW,modelH);
      const HW=modelH*modelW;
      const tensor=new Float32Array(3*HW);
      for (let i=0;i<HW;i++) for (let c=0;c<3;c++)
        tensor[c*HW+i]=(data[i*4+c]/255-DET_MEAN[c])/DET_STD[c];
      return {tensor,modelW,modelH,resizeRatio:ratio,origW,origH};
    }

    function postprocessDetection(probData,modelW,modelH,resizeRatio,origW,origH) {
      const binary=new Uint8Array(modelH*modelW);
      for (let i=0;i<binary.length;i++) binary[i]=probData[i]>=DET_THRESHOLD?1:0;
      const visited=new Uint8Array(modelH*modelW);
      const boxes=[];
      for (let y=0;y<modelH;y++) {
        for (let x=0;x<modelW;x++) {
          const idx=y*modelW+x;
          if (!binary[idx]||visited[idx]) continue;
          const queue=[idx]; visited[idx]=1; let head=0;
          let minX=x,maxX=x,minY=y,maxY=y;
          while (head<queue.length) {
            const cur=queue[head++]; const cx=cur%modelW; const cy=(cur-cx)/modelW;
            if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
            if(cx>0){const n=cur-1;if(binary[n]&&!visited[n]){visited[n]=1;queue.push(n);}}
            if(cx<modelW-1){const n=cur+1;if(binary[n]&&!visited[n]){visited[n]=1;queue.push(n);}}
            if(cy>0){const n=cur-modelW;if(binary[n]&&!visited[n]){visited[n]=1;queue.push(n);}}
            if(cy<modelH-1){const n=cur+modelW;if(binary[n]&&!visited[n]){visited[n]=1;queue.push(n);}}
          }
          const area=(maxX-minX+1)*(maxY-minY+1);
          if(area<DET_MIN_AREA)continue;
          const bh=maxY-minY+1, vpad=Math.round(bh*DET_PAD_V), hpad=Math.round(bh*DET_PAD_H);
          const px=Math.max(0,minX-hpad), py=Math.max(0,minY-vpad);
          const px2=Math.min(modelW,maxX+1+hpad), py2=Math.min(modelH,maxY+1+vpad);
          const scale=1/resizeRatio;
          const ox=Math.max(0,Math.round(px*scale)), oy=Math.max(0,Math.round(py*scale));
          const ox2=Math.min(origW,Math.round(px2*scale)), oy2=Math.min(origH,Math.round(py2*scale));
          const fw=ox2-ox, fh=oy2-oy;
          if(fw>5&&fh>5) boxes.push({x:ox,y:oy,width:fw,height:fh});
        }
      }
      return boxes;
    }

    async function detectTextRegions(srcCanvas) {
      const {tensor,modelW,modelH,resizeRatio,origW,origH}=preprocessForDetection(srcCanvas);
      const inputTensor=new mockOrt.Tensor('float32',tensor,[1,3,modelH,modelW]);
      const results=await detSession.run({x:inputTensor});
      const output=results[Object.keys(results)[0]];
      inputTensor.dispose();
      return postprocessDetection(output.data,output.dims[3],output.dims[2],resizeRatio,origW,origH);
    }

    function preprocessForRecognition(cropCanvas) {
      const newW=Math.max(REC_MIN_W,Math.round(cropCanvas.width*REC_TARGET_H/cropCanvas.height));
      const canvas=document.createElement('canvas');
      canvas.width=newW; canvas.height=REC_TARGET_H;
      canvas.getContext('2d').drawImage(cropCanvas,0,0,newW,REC_TARGET_H);
      const {data}=canvas.getContext('2d').getImageData(0,0,newW,REC_TARGET_H);
      const HW=REC_TARGET_H*newW;
      const tensor=new Float32Array(3*HW);
      for (let i=0;i<HW;i++) {
        tensor[i]=data[i*4]/127.5-1.0;
        tensor[HW+i]=data[i*4+1]/127.5-1.0;
        tensor[HW*2+i]=data[i*4+2]/127.5-1.0;
      }
      return {tensor,width:newW};
    }

    function ctcDecode(logits,seqLen,numClasses) {
      const blank=numClasses-1; let prevIdx=-1, result='';
      for (let t=0;t<seqLen;t++) {
        let maxIdx=0,maxVal=-Infinity;
        for (let c=0;c<numClasses;c++) { const v=logits[t*numClasses+c]; if(v>maxVal){maxVal=v;maxIdx=c;} }
        if(maxIdx!==blank&&maxIdx!==prevIdx) result+=dictionary[maxIdx]||'';
        prevIdx=maxIdx;
      }
      return result;
    }

    async function recognizeCrop(srcCanvas, box) {
      const cropCanvas=document.createElement('canvas');
      cropCanvas.width=box.width; cropCanvas.height=box.height;
      cropCanvas.getContext('2d').drawImage(srcCanvas,box.x,box.y,box.width,box.height,0,0,box.width,box.height);
      const {tensor,width}=preprocessForRecognition(cropCanvas);
      const inputTensor=new mockOrt.Tensor('float32',tensor,[1,3,REC_TARGET_H,width]);
      const results=await recSession.run({x:inputTensor});
      const output=results[Object.keys(results)[0]];
      const [,seqLen,numClasses]=output.dims;
      inputTensor.dispose();
      return ctcDecode(output.data,seqLen,numClasses);
    }

    // ── Run the full pipeline ─────────────────────────────────────────────────
    await ensureOcr();

    // Build a 128×64 subtitle-area test image
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = 128; srcCanvas.height = 64;
    srcCanvas.getContext('2d').fillStyle = 'black';
    srcCanvas.getContext('2d').fillRect(0, 0, 128, 64);

    const boxes = await detectTextRegions(srcCanvas);

    let rawText = '';
    for (const box of boxes) {
      const t = await recognizeCrop(srcCanvas, box);
      if (t) rawText += t;
    }

    const text = toTraditional(rawText);

    return {
      dictSize: dictionary.length,
      boxCount: boxes.length,
      rawText,
      text,
    };
  });

  assert(result.dictSize === 5,
    `Dictionary loaded with 5 entries (got ${result.dictSize})`);
  assert(result.boxCount >= 1,
    `Detection returned at least 1 box (got ${result.boxCount})`);
  assert(result.rawText === '你好',
    `Recognition + CTC decoded to "你好" (got "${result.rawText}")`);
  assert(result.text === '【TRAD:你好】',
    `OpenCC converter applied (got "${result.text}")`);

  await page.close();
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('UAT — OCR Pipeline (full PaddleOCR: detection + recognition, no opencv)');
  console.log('=========================================================================');

  testManifestCSP();
  testOffscreenHtml();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await testCtcDecode(browser);
    await testPreprocessForDetection(browser);
    await testPreprocessForRecognition(browser);
    await testPostprocessDetection(browser);
    await testMessageHandler(browser);
  } finally {
    await browser.close();
  }

  console.log('\n=========================================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('=========================================================================\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
