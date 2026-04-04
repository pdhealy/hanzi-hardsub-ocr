/**
 * Targeted OCR init diagnostic — captures all console logs from
 * the service worker and offscreen document during OCR initialization.
 */
'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

const EXTENSION_PATH = path.resolve('/workspace/extension');
const OCR_TIMEOUT_MS = 120_000; // 2 min for diagnostic

async function ensureDisplay() {
  if (process.env.DISPLAY) return;
  const displayNum = `:${90 + (process.pid % 50)}`;
  return new Promise((resolve) => {
    const xvfb = spawn('Xvfb', [displayNum, '-screen', '0', '1280x960x24'], {
      stdio: 'ignore', detached: false,
    });
    process.env.DISPLAY = displayNum;
    setTimeout(resolve, 600);
  });
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-diag-'));
  await ensureDisplay();

  console.log('Launching Chromium with extension...');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  // Capture SW logs
  context.on('serviceworker', sw => {
    console.log('SW registered:', sw.url());
  });
  const workers = context.serviceWorkers();
  const sw = workers[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  console.log('Service worker:', sw.url());
  const extId = sw.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];
  console.log('Extension ID:', extId);

  // Open popup in a page — capture ALL console messages from it
  const popupPage = await context.newPage();
  popupPage.on('console', msg => console.log(`[Popup:${msg.type()}]`, msg.text()));
  popupPage.on('pageerror', err => console.error('[Popup:error]', err.message));

  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, {
    waitUntil: 'domcontentloaded',
  });

  // Wait for extension to settle
  await popupPage.waitForTimeout(2000);

  // Make a test image
  const testImage = await popupPage.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,640,100);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 36px sans-serif';
    ctx.fillText('你好世界', 180, 50);
    return canvas.toDataURL('image/png');
  });

  console.log('\nSending OCR_RECOGNIZE_IMAGE...');
  popupPage.setDefaultTimeout(OCR_TIMEOUT_MS + 30000);

  const result = await popupPage.evaluate(async ({ dataUrl, timeout }) => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'e2e-timeout' }), timeout);
      chrome.runtime.sendMessage(
        { action: 'OCR_RECOGNIZE_IMAGE', imageDataUrl: dataUrl },
        (resp) => { clearTimeout(timer); resolve(resp || { ok: false, error: 'no-response' }); }
      );
    });
  }, { dataUrl: testImage, timeout: OCR_TIMEOUT_MS });

  console.log('\nOCR result:', JSON.stringify(result));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
