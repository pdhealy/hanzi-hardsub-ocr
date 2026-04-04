/**
 * Try Playwright's backgroundPages() API to get the offscreen doc as a Page
 * and test ORT initialization inside it.
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-bg-'));
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

  // Open popup to trigger offscreen doc creation
  const popup = await context.newPage();
  popup.on('console', msg => console.log(`[Pop:${msg.type()}]`, msg.text()));
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(3000);

  // Check backgroundPages
  const bgPages = context.backgroundPages ? context.backgroundPages() : [];
  console.log(`\nBackground pages: ${bgPages.length}`);
  bgPages.forEach((p, i) => console.log(`  [${i}] ${p.url()}`));

  // Also check regular pages
  const pages = context.pages();
  console.log(`\nRegular pages: ${pages.length}`);
  pages.forEach((p, i) => console.log(`  [${i}] ${p.url()}`));

  // Find the offscreen doc page (either background or regular)
  const offPage = [...bgPages, ...pages].find(p => p.url().includes('offscreen-ocr'));
  if (offPage) {
    console.log('\nFound offscreen page via Playwright:', offPage.url());
    const offLogs = [];
    offPage.on('console', msg => {
      const entry = `[Off:${msg.type()}] ${msg.text()}`;
      offLogs.push(entry);
      console.log(entry);
    });

    // Test ORT directly in this page
    console.log('\n=== Testing ORT in offscreen page (60s timeout) ===');
    offPage.setDefaultTimeout(90_000);
    const t0 = Date.now();
    const res = await offPage.evaluate(async () => {
      try {
        // Access chrome.runtime to confirm we're in the extension context
        const extId = chrome.runtime.id;
        const wasmUrl = chrome.runtime.getURL('libs/models/ch_PP-OCRv4_det_infer.onnx');
        const r = await fetch(wasmUrl);
        const buf = await r.arrayBuffer();
        return { extId, modelSize: buf.byteLength, ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }).catch(err => ({ ok: false, error: err.message }));
    console.log(`Offscreen page eval (${Date.now()-t0}ms):`, JSON.stringify(res));
  } else {
    console.log('\nOffscreen page NOT accessible via Playwright context API');
  }

  // Now test ORT directly in the popup (which we know works as a regular page)
  // by sending OFFSCREEN_OCR_RECOGNIZE to the popup's own listener
  // (popup DOESN'T have an OFFSCREEN_OCR_RECOGNIZE listener, but the open
  //  offscreen-ocr.html page created during onInstalled DOES)
  console.log('\n=== Testing full pipeline via SW (60s timeout) ===');
  popup.setDefaultTimeout(90_000);
  const img = await popup.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,320,80);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif';
    ctx.fillText('你好', 100, 50);
    return c.toDataURL('image/png');
  });

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
  console.log(`Pipeline result (${Date.now()-t0}ms):`, JSON.stringify(result));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
