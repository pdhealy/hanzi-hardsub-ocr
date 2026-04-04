/**
 * OCR diagnostic: attach to offscreen document via CDP, capture logs,
 * and evaluate WASM init directly to find where it hangs.
 */
'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

const EXTENSION_PATH = path.resolve('/workspace/extension');

async function ensureDisplay() {
  if (process.env.DISPLAY) return;
  const displayNum = `:${90 + (process.pid % 50)}`;
  await new Promise(resolve => {
    spawn('Xvfb', [displayNum, '-screen', '0', '1280x960x24'], { stdio: 'ignore' });
    process.env.DISPLAY = displayNum;
    setTimeout(resolve, 600);
  });
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-off-'));
  await ensureDisplay();

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  // Wait for service worker
  const sw = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  console.log('SW:', sw.url());
  const extId = sw.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];

  // Open popup (triggers offscreen doc creation via onInstalled / first message)
  const popupPage = await context.newPage();
  popupPage.on('console', msg => console.log(`[Popup:${msg.type()}]`, msg.text()));
  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await popupPage.waitForTimeout(3000); // wait for offscreen doc to be created

  // Get CDP session from any page so we can list all targets
  const cdp = await context.newCDPSession(popupPage);

  // Find the offscreen document target
  const { targetInfos } = await cdp.send('Target.getTargets');
  const offscreenInfo = targetInfos.find(t => t.url.includes('offscreen-ocr'));
  console.log('Offscreen target:', offscreenInfo?.url || 'NOT FOUND', '| type:', offscreenInfo?.type);
  if (!offscreenInfo) { await context.close(); return; }

  // Attach to the offscreen doc with its own flat CDP session
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: offscreenInfo.targetId,
    flatten: true,
  });
  console.log('Attached, sessionId:', sessionId);

  // Capture console messages from the offscreen doc
  const offscreenLogs = [];
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.sessionId === sessionId) {
      const text = params.args.map(a => a.value ?? a.description ?? '').join(' ');
      const entry = `[Offscreen:${params.type}] ${text}`;
      offscreenLogs.push(entry);
      console.log(entry);
    }
  });

  // Enable Runtime domain for the offscreen doc
  await cdp.send('Runtime.enable', {}, sessionId);

  // Test 1: Check module-level state in the offscreen doc
  console.log('\n=== Evaluating in offscreen doc ===');
  try {
    const res = await cdp.send('Runtime.evaluate', {
      expression: JSON.stringify({
        sab: typeof SharedArrayBuffer !== 'undefined',
        coi: self.crossOriginIsolated,
        numThreads: typeof ort !== 'undefined' ? 'ort exists' : 'ort not in global',
      }),
      sessionId,
    });
    console.log('Offscreen state:', res.result?.value);
  } catch (e) {
    console.log('Evaluate error:', e.message);
  }

  // Test 2: Try to create an ORT session directly in the offscreen doc
  console.log('\n=== Testing ORT session creation in offscreen doc (30s timeout) ===');
  try {
    const ortTest = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const t0 = Date.now();
          console.log('[ORT-TEST] Starting session creation...');
          // The offscreen-ocr.bundle.js defines ort in its IIFE scope — not accessible here.
          // But we can test fetch of the WASM file directly.
          const wasmUrl = chrome.runtime.getURL('libs/ort/ort-wasm-simd-threaded.wasm');
          const mjsUrl = chrome.runtime.getURL('libs/ort/ort-wasm-simd-threaded.mjs');
          console.log('[ORT-TEST] WASM URL:', wasmUrl);
          const r = await fetch(wasmUrl);
          const buf = await r.arrayBuffer();
          console.log('[ORT-TEST] WASM fetched:', buf.byteLength, 'bytes in', Date.now()-t0, 'ms');
          // Try to compile the WASM
          const compiled = await WebAssembly.compile(buf);
          console.log('[ORT-TEST] WASM compiled in', Date.now()-t0, 'ms. Exports:', WebAssembly.Module.exports(compiled).length);
          return { ok: true, wasmSize: buf.byteLength, elapsed: Date.now()-t0 };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
      sessionId,
      timeout: 30000,
    });
    console.log('ORT test result:', JSON.stringify(ortTest.result?.value));
  } catch (e) {
    console.log('ORT test error:', e.message);
  }

  // Test 3: Now trigger the actual OCR pipeline
  console.log('\n=== Triggering OCR via service worker (30s timeout) ===');
  const img = await popupPage.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,320,80);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif';
    ctx.fillText('你好', 100, 50);
    return c.toDataURL('image/png');
  });

  popupPage.setDefaultTimeout(90_000);
  const t0 = Date.now();
  const ocrResult = await popupPage.evaluate(async ({ dataUrl }) => {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ timeout: true }), 30000);
      chrome.runtime.sendMessage(
        { action: 'OCR_RECOGNIZE_IMAGE', imageDataUrl: dataUrl },
        resp => { clearTimeout(timer); resolve(resp || { noResp: true }); }
      );
    });
  }, { dataUrl: img });

  console.log(`\nOCR result after ${Date.now()-t0}ms:`, JSON.stringify(ocrResult));
  console.log('\n=== Offscreen doc logs captured ===');
  offscreenLogs.forEach(l => console.log(l));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
