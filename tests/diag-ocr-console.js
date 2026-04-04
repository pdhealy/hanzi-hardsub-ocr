/**
 * OCR diagnostic — captures console from ALL browser contexts
 * including service worker and offscreen document.
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-con-'));
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

  // Capture ALL console messages from any page in the context
  const allLogs = [];
  context.on('console', msg => {
    const entry = `[CTX:${msg.type()}] ${msg.text()}`;
    allLogs.push(entry);
    console.log(entry);
  });

  // Wait for service worker
  const sw = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  console.log('SW:', sw.url());
  const extId = sw.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];

  // Open popup
  const popup = await context.newPage();
  popup.on('console', msg => console.log(`[Popup:${msg.type()}]`, msg.text()));
  popup.on('pageerror', err => console.error('[Popup:error]', err.message));
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(2000);

  // Make test image
  const img = await popup.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,320,80);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif';
    ctx.fillText('你好', 100, 50);
    return c.toDataURL('image/png');
  });

  console.log('\n=== Sending OCR_RECOGNIZE_IMAGE (timeout 60s) ===\n');
  popup.setDefaultTimeout(120_000);

  const t0 = Date.now();
  const result = await popup.evaluate(async ({ dataUrl }) => {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ timeout: true }), 60000);
      chrome.runtime.sendMessage(
        { action: 'OCR_RECOGNIZE_IMAGE', imageDataUrl: dataUrl },
        resp => { clearTimeout(timer); resolve(resp || { noResp: true }); }
      );
    });
  }, { dataUrl: img });

  console.log(`\n=== Result after ${Date.now()-t0}ms ===`);
  console.log(JSON.stringify(result));
  console.log('\n=== All captured logs ===');
  allLogs.forEach(l => console.log(l));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
