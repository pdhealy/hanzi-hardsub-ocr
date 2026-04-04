/**
 * OCR diagnostic: load offscreen-ocr.html as a regular page and test
 * ORT InferenceSession.create() directly, bypassing the messaging system.
 */
'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

const EXTENSION_PATH = path.resolve('/workspace/extension');
const OCR_TIMEOUT = 90_000;

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-dir-'));
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
  const extId = sw.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];
  console.log('Extension ID:', extId);

  // Open offscreen-ocr.html as a regular page (same environment as offscreen doc)
  const offscreenPage = await context.newPage();
  const offscreenLogs = [];
  offscreenPage.on('console', msg => {
    const entry = `[Off:${msg.type()}] ${msg.text()}`;
    offscreenLogs.push(entry);
    console.log(entry);
  });
  offscreenPage.on('pageerror', err => console.error('[Off:error]', err.message));
  offscreenPage.setDefaultTimeout(OCR_TIMEOUT + 30_000);

  console.log('\nLoading offscreen-ocr.html as regular page...');
  await offscreenPage.goto(`chrome-extension://${extId}/background/offscreen-ocr.html`, {
    waitUntil: 'domcontentloaded',
  });
  await offscreenPage.waitForTimeout(2000);

  // Now test ORT InferenceSession.create() by sending the OFFSCREEN_OCR_RECOGNIZE
  // message from a DIFFERENT page (popup) to trigger the offscreen doc's listener.
  // Since the offscreen-ocr.html page has the listener, it will receive and process it.
  
  // But first, let's check if the page loaded the bundle correctly.
  console.log('\n=== Checking offscreen page state ===');

  // Test: trigger the OCR recognize pipeline by dispatching a custom event
  // (offscreen-ocr.js only responds to chrome.runtime.onMessage, not custom events)
  // Instead, we need to call from a different page.

  const popupPage = await context.newPage();
  popupPage.on('console', msg => console.log(`[Pop:${msg.type()}]`, msg.text()));
  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await popupPage.waitForTimeout(1000);

  // From popup, send OFFSCREEN_OCR_RECOGNIZE directly (bypassing SW relay)
  // The offscreen-ocr.html page IS open and has the listener registered.
  // The message will go from popup to ALL extension pages with a listener,
  // INCLUDING our offscreen-ocr.html regular page.
  const img = await popupPage.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,320,80);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif';
    ctx.fillText('你好', 100, 50);
    return c.toDataURL('image/png');
  });

  console.log(`\n=== Sending OFFSCREEN_OCR_RECOGNIZE directly (${OCR_TIMEOUT/1000}s timeout) ===`);
  popupPage.setDefaultTimeout(OCR_TIMEOUT + 30_000);
  const t0 = Date.now();

  const result = await popupPage.evaluate(async ({ dataUrl, timeout }) => {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ timeout: true }), timeout);
      chrome.runtime.sendMessage(
        { action: 'OFFSCREEN_OCR_RECOGNIZE', imageDataUrl: dataUrl },
        resp => {
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          resolve(resp || { noResp: true, lastError: err?.message });
        }
      );
    });
  }, { dataUrl: img, timeout: OCR_TIMEOUT });

  const elapsed = Date.now() - t0;
  console.log(`\n=== Result after ${elapsed}ms ===`);
  console.log(JSON.stringify(result));
  console.log('\n=== Offscreen page logs ===');
  offscreenLogs.forEach(l => console.log(l));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
