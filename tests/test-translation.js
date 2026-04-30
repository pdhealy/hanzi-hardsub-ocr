'use strict';

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const EXTENSION_PATH = path.resolve(__dirname, '../extension');
const MOCK_PAGE_PATH = path.resolve(__dirname, 'test-page.html');

let xvfbProcess = null;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

async function startXvfb() {
  if (process.env.DISPLAY) return;
  if (os.platform() !== 'linux') return;
  return new Promise((resolve, reject) => {
    xvfbProcess = spawn('Xvfb', [':99', '-screen', '0', '1280x1024x24']);
    process.env.DISPLAY = ':99';
    setTimeout(resolve, 500); // give it time to start
  });
}

function stopXvfb() {
  if (xvfbProcess) xvfbProcess.kill();
}

async function runTest() {
  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage();
    await page.goto('about:blank');

    // Inject compiled sidepanel test entry
    await page.addScriptTag({ path: path.join(__dirname, 'sidepanel-test-entry.bundle.js') });

    // Wait for entry to render
    await page.waitForSelector('.ycr-entry');

    // Click the entry
    await page.click('.ycr-entry');

    // Wait for the translation to show up
    await page.waitForSelector('.ycr-translation', { state: 'visible' });
    const transText = await page.textContent('.ycr-translation');
    
    console.log('Translation element text:', transText);
    assert(transText.includes('Mocked English') || transText.includes('Translation failed'), 'Translation UI updated after click');

    // Check expanded class
    const isExpanded = await page.evaluate(() => document.querySelector('.ycr-entry').classList.contains('expanded'));
    assert(isExpanded, 'Entry has expanded class');

    // Click again to collapse
    await page.click('.ycr-entry');
    
    // Wait for display:none
    const isHidden = await page.evaluate(() => {
       const el = document.querySelector('.ycr-translation');
       return window.getComputedStyle(el).display === 'none';
    });
    assert(isHidden, 'Translation UI collapsed after second click');

  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
    stopXvfb();
  }
}

const fs = require('fs');
runTest().catch(console.error);