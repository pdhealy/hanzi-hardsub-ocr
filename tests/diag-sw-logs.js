/**
 * Diagnostic: list CDP targets and observe the offscreen doc via raw WebSocket.
 * Uses Node's built-in `net` + `crypto` modules — no npm deps needed.
 *
 * Steps:
 *  1. Launch Chromium with extension + --remote-debugging-port=19222
 *  2. Open popup to trigger offscreen doc creation
 *  3. List CDP targets via HTTP /json
 *  4. Attach to offscreen doc (if found) via raw CDP WebSocket and enable Runtime
 *  5. Send OCR_RECOGNIZE_IMAGE from popup and watch for console output
 *
 * Usage: node tests/diag-sw-logs.js
 */
'use strict';

const { chromium } = require('playwright');
const net    = require('net');
const crypto = require('crypto');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { spawn } = require('child_process');

const EXTENSION_PATH = path.resolve(__dirname, '../extension');
const CDP_PORT       = 19222;
const OCR_TIMEOUT_MS = 90_000;

// ── helpers ──────────────────────────────────────────────────────────────────

async function ensureDisplay() {
  if (process.env.DISPLAY) return;
  const num = `:${90 + (process.pid % 50)}`;
  await new Promise(r => {
    spawn('Xvfb', [num, '-screen', '0', '1280x960x24'], { stdio: 'ignore' });
    process.env.DISPLAY = num;
    setTimeout(r, 600);
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject);
  });
}

// ── Minimal WebSocket client over TCP ────────────────────────────────────────
// Implements RFC 6455 text-frame send/receive; sufficient for CDP JSON.

class CDPWebSocket {
  constructor(host, port, wsPath) {
    this.host    = host;
    this.port    = port;
    this.wsPath  = wsPath;
    this.socket  = null;
    this.buf     = Buffer.alloc(0);
    this._mid    = 0;
    this._pend   = new Map();   // id → { resolve, reject }
    this._events = [];          // incoming events (no id)
    this._eventCb = null;       // callback for events
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port });
      this.socket.once('error', reject);
      this.socket.once('connect', () => {
        const key = crypto.randomBytes(16).toString('base64');
        const req = [
          `GET ${this.wsPath} HTTP/1.1`,
          `Host: ${this.host}:${this.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '', '',
        ].join('\r\n');
        this.socket.write(req);

        // Read HTTP upgrade response
        let header = '';
        const onData = (chunk) => {
          header += chunk.toString('binary');
          if (header.includes('\r\n\r\n')) {
            this.socket.removeListener('data', onData);
            const leftover = chunk.slice(chunk.indexOf('\r\n\r\n') + 4);
            if (leftover.length) this._onData(leftover);
            this.socket.on('data', d => this._onData(d));
            resolve();
          }
        };
        this.socket.on('data', onData);
      });
    });
  }

  onEvent(cb) { this._eventCb = cb; }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const masked = (b1 & 0x80) !== 0;
      let payLen = b1 & 0x7f;
      let offset = 2;
      if (payLen === 126) {
        if (this.buf.length < 4) break;
        payLen = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (payLen === 127) {
        if (this.buf.length < 10) break;
        payLen = Number(this.buf.readBigUInt64BE(2));
        offset = 10;
      }
      if (masked) offset += 4;
      if (this.buf.length < offset + payLen) break;
      const payload = this.buf.slice(offset, offset + payLen);
      this.buf = this.buf.slice(offset + payLen);
      try {
        const msg = JSON.parse(payload.toString());
        if (msg.id !== undefined && this._pend.has(msg.id)) {
          const { resolve, reject } = this._pend.get(msg.id);
          this._pend.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (this._eventCb) {
          this._eventCb(msg);
        }
      } catch {}
    }
  }

  send(method, params = {}, sessionId) {
    const id  = ++this._mid;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const payload = Buffer.from(JSON.stringify(msg));
    const mask    = crypto.randomBytes(4);
    const header  = payLen126(payload.length, mask);
    const masked  = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
    return new Promise((resolve, reject) => this._pend.set(id, { resolve, reject }));
  }

  close() { this.socket?.destroy(); }
}

function payLen126(len, mask) {
  if (len < 126) {
    return Buffer.from([0x81, 0x80 | len]);
  }
  const b = Buffer.alloc(4);
  b[0] = 0x81; b[1] = 0xfe;
  b.writeUInt16BE(len, 2);
  return b;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-swlog-'));
  await ensureDisplay();

  console.log('Launching Chromium with extension + remote-debugging-port=19222 …');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--remote-debugging-port=${CDP_PORT}`,
    ],
  });

  // ── 1. Get extension ID ─────────────────────────────────────────────────────
  const sw = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = sw.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];
  console.log(`Extension ID: ${extId}`);

  // ── 2. Open popup to trigger onInstalled + offscreen doc creation ───────────
  const popup = await context.newPage();
  popup.on('console', msg => console.log(`[Pop:${msg.type()}] ${msg.text()}`));
  popup.on('pageerror', err => console.error(`[Pop:error] ${err.message}`));
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`, {
    waitUntil: 'domcontentloaded', timeout: 10_000,
  });
  console.log('Popup open. Waiting 3 s for offscreen doc …');
  await popup.waitForTimeout(3_000);

  // ── 3. List CDP targets ─────────────────────────────────────────────────────
  console.log('\n=== CDP targets via /json ===');
  const targets = await httpGet(`http://127.0.0.1:${CDP_PORT}/json`).catch(() => []);
  let offTarget = null;
  let swTarget  = null;
  if (Array.isArray(targets)) {
    for (const t of targets) {
      const url = (t.url || '').substring(0, 120);
      console.log(`  [${t.type}] ${url}`);
      if (url.includes('offscreen-ocr')) offTarget = t;
      if (url.includes('service-worker')) swTarget = t;
    }
  }
  console.log(`\nOffscreen doc target: ${offTarget ? offTarget.url : 'NOT FOUND'}`);
  console.log(`Service-worker target: ${swTarget ? swTarget.url : 'not found in /json'}`);

  // ── 4. Get browser WebSocket URL and attach CDP ─────────────────────────────
  const version = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`).catch(() => null);
  console.log('\nBrowser WS URL:', version?.webSocketDebuggerUrl?.substring(0, 80) || 'unavailable');

  let cdp = null;
  let offSessionId = null;
  let swSessionId  = null;

  if (version?.webSocketDebuggerUrl) {
    const wsUrl  = version.webSocketDebuggerUrl;
    const wsPath = wsUrl.replace(/^ws:\/\/[^/]+/, '');

    cdp = new CDPWebSocket('127.0.0.1', CDP_PORT, wsPath);
    cdp.onEvent(msg => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const sid = msg.sessionId || 'root';
        const txt = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
        console.log(`[CDP:${sid.substring(0,8)}:${msg.params.type}] ${txt}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const sid = msg.sessionId || 'root';
        console.log(`[CDP:${sid.substring(0,8)}:exception] ${msg.params.exceptionDetails?.exception?.description}`);
      }
    });

    await cdp.connect();
    console.log('CDP WebSocket connected.');

    // Get all targets at the browser level
    const targetsResult = await cdp.send('Target.getTargets');
    console.log('\n=== Targets via CDP Target.getTargets ===');
    let offTargetId = null;
    let swTargetId  = null;
    for (const t of targetsResult.targetInfos) {
      const url = (t.url || '').substring(0, 120);
      console.log(`  [${t.type}] ${url}`);
      if (url.includes('offscreen-ocr')) offTargetId = t.targetId;
      if (url.includes('service-worker')) swTargetId  = t.targetId;
    }

    // Attach to offscreen doc if found
    if (offTargetId) {
      console.log(`\nAttaching to offscreen doc (targetId=${offTargetId.substring(0,16)} …)`);
      try {
        const { sessionId } = await cdp.send('Target.attachToTarget',
          { targetId: offTargetId, flatten: true });
        offSessionId = sessionId;
        console.log(`Offscreen session: ${sessionId}`);
        await cdp.send('Runtime.enable', {}, sessionId);

        // Read initial context info
        const ctx = await cdp.send('Runtime.evaluate', {
          expression: 'JSON.stringify({ url: location.href, crossOriginIsolated: self.crossOriginIsolated, hasSharedArrayBuffer: typeof SharedArrayBuffer !== "undefined" })',
          returnByValue: true,
        }, sessionId);
        console.log('Offscreen context info:', ctx.result?.value);
      } catch (err) {
        console.log('Could not attach to offscreen doc:', err.message);
      }
    } else {
      console.log('\nOffscreen doc not yet created — will re-check after OCR call.');
    }

    // Attach to SW if found
    if (swTargetId) {
      console.log(`\nAttaching to service worker (targetId=${swTargetId.substring(0,16)} …)`);
      try {
        const { sessionId } = await cdp.send('Target.attachToTarget',
          { targetId: swTargetId, flatten: true });
        swSessionId = sessionId;
        await cdp.send('Runtime.enable', {}, sessionId);
        console.log(`SW session: ${sessionId} — Runtime enabled`);
      } catch (err) {
        console.log('Could not attach to SW:', err.message);
      }
    }
  }

  // ── 5. Send OCR pipeline ────────────────────────────────────────────────────
  const img = await popup.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 320, 80);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif';
    ctx.fillText('你好', 100, 50);
    return c.toDataURL('image/png');
  });

  console.log(`\n=== Sending OCR_RECOGNIZE_IMAGE (${OCR_TIMEOUT_MS / 1000}s timeout) ===`);
  popup.setDefaultTimeout(OCR_TIMEOUT_MS + 30_000);
  const t0 = Date.now();

  // Run pipeline (don't await yet — let CDP events arrive in parallel)
  const pipelinePromise = popup.evaluate(async ({ dataUrl, timeout }) => {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ timedOut: true }), timeout);
      chrome.runtime.sendMessage(
        { action: 'OCR_RECOGNIZE_IMAGE', imageDataUrl: dataUrl },
        resp => {
          clearTimeout(timer);
          resolve(resp || { noResp: true, lastError: chrome.runtime.lastError?.message });
        }
      );
    });
  }, { dataUrl: img, timeout: OCR_TIMEOUT_MS });

  // After 5s, re-check targets to see if offscreen doc appeared
  await popup.waitForTimeout(5_000);
  if (!offSessionId && cdp) {
    console.log('\n=== Re-checking targets after 5s ===');
    try {
      const tr2 = await cdp.send('Target.getTargets');
      for (const t of tr2.targetInfos) {
        const url = (t.url || '').substring(0, 120);
        console.log(`  [${t.type}] ${url}`);
        if (url.includes('offscreen-ocr')) {
          console.log('  → Offscreen doc appeared! Attaching …');
          const { sessionId } = await cdp.send('Target.attachToTarget',
            { targetId: t.targetId, flatten: true });
          offSessionId = sessionId;
          await cdp.send('Runtime.enable', {}, sessionId);
          const ctx = await cdp.send('Runtime.evaluate', {
            expression: 'JSON.stringify({ url: location.href, crossOriginIsolated: self.crossOriginIsolated, hasSharedArrayBuffer: typeof SharedArrayBuffer !== "undefined", numThreads: (typeof ort !== "undefined" ? ort.env?.wasm?.numThreads : "ort not defined") })',
            returnByValue: true,
          }, sessionId);
          console.log('Offscreen context:', ctx.result?.value);
        }
      }
    } catch (err) {
      console.log('Re-check failed:', err.message);
    }
  }

  const result = await pipelinePromise;
  const elapsed = Date.now() - t0;
  console.log(`\n=== Pipeline result after ${elapsed}ms ===`);
  console.log(JSON.stringify(result, null, 2));

  cdp?.close();
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
