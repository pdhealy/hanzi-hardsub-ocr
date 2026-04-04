/**
 * OCR diagnostic using raw CDP to attach to the offscreen document target
 * and capture its console messages directly.
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-cdp-'));
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

  // Get the browser's CDP session to list ALL targets
  const browser = context.browser();
  const cdpSession = await context.newCDPSession(context.pages()[0] || await context.newPage());

  // List all targets
  const targets = await cdpSession.send('Target.getTargets');
  console.log('\n=== All CDP Targets ===');
  targets.targetInfos.forEach(t => {
    console.log(`  [${t.type}] ${t.url.substring(0, 100)}`);
  });

  // Find offscreen document
  const offscreenTarget = targets.targetInfos.find(t =>
    t.url.includes('offscreen-ocr') || t.type === 'other'
  );
  console.log('\nOffscreen target:', offscreenTarget?.url || 'NOT FOUND');

  // Open popup and trigger OCR
  const popup = await context.newPage();
  popup.on('console', msg => console.log(`[Popup:${msg.type()}]`, msg.text()));
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(2000);

  // List targets again after OCR setup
  const targets2 = await cdpSession.send('Target.getTargets');
  console.log('\n=== All CDP Targets (after popup load) ===');
  targets2.targetInfos.forEach(t => {
    console.log(`  [${t.type}] ${t.url.substring(0, 100)}`);
  });

  // Try to attach to each "other" or "offscreen" target
  for (const t of targets2.targetInfos) {
    if (t.url.includes('offscreen') || (t.type === 'other' && t.url.includes('chrome-extension'))) {
      console.log('\nAttaching to:', t.url);
      try {
        const attached = await cdpSession.send('Target.attachToTarget', {
          targetId: t.targetId,
          flatten: true,
        });
        console.log('Attached, sessionId:', attached.sessionId);
        // Enable console for this target
        await cdpSession.send('Runtime.enable', {}, attached.sessionId);
        console.log('Runtime.enable sent');
      } catch (e) {
        console.log('Attach failed:', e.message);
      }
    }
  }

  // Make test image and trigger OCR
  const img = await popup.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,320,80);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif';
    ctx.fillText('你好', 100, 50);
    return c.toDataURL('image/png');
  });

  console.log('\n=== Sending OCR_RECOGNIZE_IMAGE (30s timeout) ===');
  popup.setDefaultTimeout(90_000);

  const t0 = Date.now();
  const result = await popup.evaluate(async ({ dataUrl }) => {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ timeout: true }), 30000);
      chrome.runtime.sendMessage(
        { action: 'OCR_RECOGNIZE_IMAGE', imageDataUrl: dataUrl },
        resp => { clearTimeout(timer); resolve(resp || { noResp: true }); }
      );
    });
  }, { dataUrl: img });

  // List targets one more time after OCR attempt
  const targets3 = await cdpSession.send('Target.getTargets');
  console.log('\n=== All CDP Targets (after OCR) ===');
  targets3.targetInfos.forEach(t => {
    console.log(`  [${t.type}] ${t.url.substring(0, 100)}`);
  });

  console.log(`\nResult after ${Date.now()-t0}ms:`, JSON.stringify(result));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
