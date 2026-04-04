/**
 * Proper CDP flat-session test for the offscreen document.
 * Uses low-level CDP protocol to route messages to the right target.
 */
'use strict';

const { chromium } = require('playwright');
const WebSocket = require('ws');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const http = require('http');

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

// Use Playwright's internal WS endpoint to get a direct CDP connection
async function getBrowserWsUrl(browser) {
  // Playwright exposes _connection._transport._ws for debugging
  try {
    const transport = browser._connection?._transport;
    if (transport?._ws) return transport._ws.url;
  } catch {}
  return null;
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-cdp2-'));
  await ensureDisplay();

  const browser = await chromium.launch({
    headless: false,
    executablePath: '/home/node/.cache/ms-playwright/chromium-1217/chrome-linux/chrome',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--remote-debugging-port=19222',
    ],
  });

  // Connect to the remote debugging port
  await new Promise(r => setTimeout(r, 2000));
  
  // Get list of targets via HTTP
  const targets = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:19222/json', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  console.log('=== CDP Targets via remote debugging ===');
  targets.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0, 100)}`));

  // Find the offscreen doc target
  const offTarget = targets.find(t => t.url?.includes('offscreen-ocr'));
  const swTarget = targets.find(t => t.url?.includes('service-worker'));
  console.log('\nOffscreen target:', offTarget?.url || 'NOT YET CREATED');

  // Connect to the browser via WebSocket
  const { webSocketDebuggerUrl } = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:19222/json/version', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('Connected to browser CDP at', webSocketDebuggerUrl.substring(0, 60));

  let msgId = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Open a page to trigger the extension
  const { targetId: newTargetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: newSession } = await send('Target.attachToTarget', { targetId: newTargetId, flatten: true });
  await send('Page.navigate', { url: 'about:blank', sessionId: newSession });

  await new Promise(r => setTimeout(r, 3000));

  // List targets again
  const targets2 = await send('Target.getTargets');
  console.log('\n=== CDP Targets after extension startup ===');
  targets2.targetInfos.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0, 100)}`));

  const offTarget2 = targets2.targetInfos.find(t => t.url?.includes('offscreen-ocr'));
  if (!offTarget2) {
    console.log('Offscreen doc not found. Closing.');
    ws.close();
    await browser.close();
    return;
  }

  // Attach to the offscreen doc
  console.log('\nAttaching to offscreen doc:', offTarget2.url);
  const { sessionId: offSession } = await send('Target.attachToTarget', {
    targetId: offTarget2.targetId,
    flatten: true,
  });
  console.log('Offscreen session:', offSession);

  // Enable runtime
  await send('Runtime.enable', { sessionId: offSession });

  // Test 1: Confirm context
  const ctx = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({url: location.href, title: document.title, hasChromeRuntime: typeof chrome !== "undefined"})',
    sessionId: offSession,
    returnByValue: true,
  });
  console.log('\nOffscreen context:', ctx.result?.value);

  // Test 2: Fetch model
  console.log('\n=== Testing fetch in offscreen context ===');
  const fetchTest = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const url = chrome.runtime.getURL('libs/models/ch_PP-OCRv4_det_infer.onnx');
        const r = await fetch(url);
        const buf = await r.arrayBuffer();
        return JSON.stringify({ ok: true, size: buf.byteLength });
      } catch(e) { return JSON.stringify({ ok: false, error: e.message }); }
    })()`,
    awaitPromise: true,
    returnByValue: true,
    sessionId: offSession,
    timeout: 15000,
  });
  console.log('Fetch test:', fetchTest.result?.value);

  // Test 3: Dynamic import of .mjs
  console.log('\n=== Testing dynamic import of ORT .mjs ===');
  const importTest = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const mjsUrl = chrome.runtime.getURL('libs/ort/ort-wasm-simd-threaded.mjs');
        const mod = await import(mjsUrl);
        return JSON.stringify({ ok: true, exports: Object.keys(mod) });
      } catch(e) { return JSON.stringify({ ok: false, error: e.message }); }
    })()`,
    awaitPromise: true,
    returnByValue: true,
    sessionId: offSession,
    timeout: 15000,
  });
  console.log('Import test:', importTest.result?.value);

  ws.close();
  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
