/**
 * Baseline OCR Diagnostic Test
 * Tests the extension's offscreen OCR pipeline against the 20 baseline images.
 */
'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

const EXTENSION_PATH = path.resolve(__dirname, '../extension');
const IMAGES_DIR = path.resolve(__dirname, '../docs/exp-workspace/poc_2/images');

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-baseline-'));
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

  // Open popup to trigger offscreen doc creation
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(3000); // Give offscreen doc time to initialize

  const files = fs.readdirSync(IMAGES_DIR)
    .filter(f => f.match(/\.(png|jpe?g)$/i))
    .sort((a, b) => parseInt(path.parse(a).name, 10) - parseInt(path.parse(b).name, 10));

  console.log('Running extension OCR on baseline images...\n');

  for (const file of files) {
    const imgPath = path.join(IMAGES_DIR, file);
    const base64 = fs.readFileSync(imgPath).toString('base64');
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${base64}`;

    const result = await popup.evaluate(async (dataUrl) => {
      return new Promise(resolve => {
        // Send to service worker, which forwards to offscreen doc
        chrome.runtime.sendMessage(
          { action: 'OCR_RECOGNIZE_IMAGE', imageDataUrl: dataUrl },
          resp => resolve(resp)
        );
      });
    }, dataUrl);

    console.log(`File: ${file}`);
    if (result && result.ok) {
      console.log(`  Extension : ${result.text}`);
    } else {
      console.log(`  Extension Error: ${JSON.stringify(result)}`);
    }
  }

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
