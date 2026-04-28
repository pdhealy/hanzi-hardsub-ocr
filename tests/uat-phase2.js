/**
 * UAT Phase 2 — Playwright headless tests
 * Tests three user-observable scenarios without a real YouTube page.
 *
 * Run: node tests/uat-phase2.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
    results.push({ label, result: 'pass' });
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
    results.push({ label, result: 'fail' });
  }
}

// Strip ES module export so we can inject into a plain browser context
function loadSidePanel() {
  return fs.readFileSync(
    path.join(__dirname, '../extension/content/sidepanel.js'),
    'utf8'
  )
    .replace(/^export class SidePanel/m, 'class SidePanel')
    + '\nwindow.__SidePanel = SidePanel;';
}

function loadPopup() {
  return fs.readFileSync(
    path.join(__dirname, '../extension/dist/popup.bundle.js'),
    'utf8'
  );
}

// ── test 1 — Panel collapse visual behavior ───────────────────────────────

async function testCollapse(browser) {
  console.log('\nTest 1: Panel collapse visual behavior');
  const page = await browser.newPage();
  await page.setContent('<html><head></head><body></body></html>');
  
  // Inject mock chrome object
  await page.evaluate(() => {
    window.chrome = {
      storage: {
        sync: { get: (defaults, cb) => cb(defaults) },
        onChanged: { addListener: () => {}, removeListener: () => {} }
      }
    };
  });

  await page.evaluate(loadSidePanel());

  await page.evaluate(() => {
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.storage) {
      window.chrome.storage = {
        sync: { get: (defaults, cb) => cb(defaults) },
        onChanged: { addListener: () => {}, removeListener: () => {} }
      };
    }
    window.__panel = new window.__SidePanel();
    window.__panel.show();
  });

  // Initial state: panel visible, tab hidden
  const panelVisibleBefore = await page.evaluate(() =>
    document.getElementById('ycr-side-panel').classList.contains('ycr-visible')
  );
  const tabVisibleBefore = await page.evaluate(() =>
    document.getElementById('ycr-collapse-tab').classList.contains('ycr-tab-visible')
  );
  assert(panelVisibleBefore, 'Panel is visible before collapse');
  assert(!tabVisibleBefore, 'YCR tab is hidden before collapse');

  // Click the collapse button in the header
  await page.click('#ycr-panel-collapse');

  const panelVisibleAfter = await page.evaluate(() =>
    document.getElementById('ycr-side-panel').classList.contains('ycr-visible')
  );
  const tabVisibleAfter = await page.evaluate(() =>
    document.getElementById('ycr-collapse-tab').classList.contains('ycr-tab-visible')
  );
  assert(!panelVisibleAfter, 'Panel is hidden after collapse');
  assert(tabVisibleAfter, 'YCR tab appears after collapse');

  // Check tab text and position style
  const tabText = await page.evaluate(() =>
    document.getElementById('ycr-collapse-tab').textContent.trim()
  );
  const tabStyle = await page.evaluate(() => {
    const tab = document.getElementById('ycr-collapse-tab');
    const cs = window.getComputedStyle(tab);
    return { position: cs.position, right: cs.right, writingMode: cs.writingMode };
  });
  assert(tabText === 'YCR', `Tab shows "YCR" text (got "${tabText}")`);
  assert(tabStyle.position === 'fixed', 'Tab is position:fixed (anchored to viewport edge)');
  assert(tabStyle.right === '0px', 'Tab is anchored to right edge');
  assert(
    tabStyle.writingMode === 'vertical-rl' || tabStyle.writingMode === 'vertical-lr',
    `Tab has vertical text (writing-mode: ${tabStyle.writingMode})`
  );

  // Click the YCR tab to restore panel
  await page.click('#ycr-collapse-tab');

  const panelRestoredAfterExpand = await page.evaluate(() =>
    document.getElementById('ycr-side-panel').classList.contains('ycr-visible')
  );
  const tabHiddenAfterExpand = await page.evaluate(() =>
    document.getElementById('ycr-collapse-tab').classList.contains('ycr-tab-visible')
  );
  assert(panelRestoredAfterExpand, 'Panel is restored after clicking YCR tab');
  assert(!tabHiddenAfterExpand, 'YCR tab is hidden after expanding panel');

  await page.close();
}

// ── test 2 — Entry list auto-scroll ──────────────────────────────────────

async function testAutoScroll(browser) {
  console.log('\nTest 2: Entry list auto-scroll');
  const page = await browser.newPage();
  // Small viewport so overflow happens quickly
  await page.setViewportSize({ width: 800, height: 400 });
  await page.setContent('<html><head></head><body></body></html>');
  await page.evaluate(loadSidePanel());

  await page.evaluate(() => {
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.storage) {
      window.chrome.storage = {
        sync: { get: (defaults, cb) => cb(defaults) },
        onChanged: { addListener: () => {}, removeListener: () => {} }
      };
    }
    window.__panel = new window.__SidePanel();
    window.__panel.show();
    // Track scrollIntoView calls
    window.__scrollCalls = 0;
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(...args) {
      window.__scrollCalls++;
      return orig.apply(this, args);
    };
  });

  // Append 20 entries to force overflow
  await page.evaluate(() => {
    for (let i = 1; i <= 20; i++) {
      window.__panel.appendEntry(`00:${String(i).padStart(2, '0')}`, `Line ${i}: 今天天气很好`);
    }
  });

  const scrollCallCount = await page.evaluate(() => window.__scrollCalls);
  assert(scrollCallCount === 20, `scrollIntoView called once per entry (called ${scrollCallCount} times)`);

  // Verify entry list exists and has 20 entries
  const entryCount = await page.evaluate(() =>
    document.querySelectorAll('.ycr-entry').length
  );
  assert(entryCount === 20, `20 entries rendered in DOM (found ${entryCount})`);

  // The last entry should be the most recently scrolled-to element
  const lastEntryText = await page.evaluate(() => {
    const entries = document.querySelectorAll('.ycr-entry');
    return entries[entries.length - 1]?.querySelector('.ycr-text')?.textContent;
  });
  assert(lastEntryText === 'Line 20: 今天天气很好', `Last entry is "Line 20" (got "${lastEntryText}")`);

  // Verify timestamps are shown
  const firstTs = await page.evaluate(() =>
    document.querySelector('.ycr-ts')?.textContent
  );
  assert(firstTs === '[00:01]', `First entry has timestamp [00:01] (got "${firstTs}")`);

  await page.close();
}

// ── test 3 — Popup / panel toggle sync round-trip ─────────────────────────

async function testToggleSync(browser) {
  console.log('\nTest 3: Popup / panel toggle sync round-trip');
  const page = await browser.newPage();
  await page.setViewportSize({ width: 400, height: 600 });

  // Serve the popup HTML inline, with mocked chrome API
  const popupBundle = loadPopup();
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  .status-dot{}
  .status-dot.active{}
  .status-dot.processing{}
  .btn{}
</style>
</head>
<body>
  <h1>YouTube Chinese Reader</h1>
  <div>
    <span class="status-dot" id="status-dot"></span>
    <span class="status-label" id="status-label">Inactive</span>
  </div>
  <div class="buttons">
    <button id="btn-draw" class="btn">Draw New Subtitle Area</button>
    <button id="btn-recognize" class="btn" disabled>Recognize Text</button>
  </div>
  <script>
    // Mock chrome APIs — simulate a content script that is NOT looping initially
    window.__mockIsLooping = false;
    window.__sentMessages = [];

    window.chrome = {
      storage: {
        local: { get: async () => ({}), set: async () => {} }
      },
      tabs: {
        query: async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=123' }],
        sendMessage: async (tabId, msg) => {
          window.__sentMessages.push(msg);
          if (msg.action === 'GET_STATUS') {
            return { boxDrawn: true, isLooping: window.__mockIsLooping };
          }
          if (msg.action === 'START_LIVE') {
            window.__mockIsLooping = true;
            return { ok: true, isLooping: true };
          }
          if (msg.action === 'STOP_LIVE') {
            window.__mockIsLooping = false;
            return { ok: true, isLooping: false };
          }
          return { ok: true };
        }
      }
    };
  </script>
  <script>${popupBundle}</script>
</body></html>`;

  await page.setContent(html);

  // Wait for the on-open IIFE (GET_STATUS) to complete
  await page.waitForTimeout(100);

  // Check button syncs to "not looping" on open
  const btnTextOnOpen = await page.evaluate(() =>
    document.getElementById('btn-recognize').textContent
  );
  const btnLoopingOnOpen = await page.evaluate(() =>
    document.getElementById('btn-recognize').dataset.looping
  );
  assert(
    btnTextOnOpen === 'Recognize Text',
    `Popup shows "Recognize Text" when NOT looping on open (got "${btnTextOnOpen}")`
  );
  assert(
    btnLoopingOnOpen !== 'true',
    `Button data-looping is not "true" when stopped (got "${btnLoopingOnOpen}")`
  );

  // Click Recognize → should send START_LIVE
  await page.click('#btn-recognize');
  await page.waitForTimeout(50);

  const btnTextAfterStart = await page.evaluate(() =>
    document.getElementById('btn-recognize').textContent
  );
  const btnLoopingAfterStart = await page.evaluate(() =>
    document.getElementById('btn-recognize').dataset.looping
  );
  const sentStart = await page.evaluate(() =>
    window.__sentMessages.some(m => m.action === 'START_LIVE')
  );
  assert(sentStart, 'Clicking "Recognize Text" sends START_LIVE message');
  assert(
    btnTextAfterStart === 'Stop Recognition',
    `Button changes to "Stop Recognition" after starting (got "${btnTextAfterStart}")`
  );
  assert(
    btnLoopingAfterStart === 'true',
    `data-looping becomes "true" after starting (got "${btnLoopingAfterStart}")`
  );

  // Simulate user closing and reopening popup while loop is running
  // Re-inject popup script to simulate fresh popup open
  await page.evaluate(() => { window.__sentMessages = []; });

  // Re-trigger the IIFE manually (simulate popup re-open)
  await page.evaluate(async () => {
    const response = await window.chrome.tabs.sendMessage(1, { action: 'GET_STATUS' });
    const btn = document.getElementById('btn-recognize');
    if (response?.isLooping) {
      btn.textContent = 'Stop Recognition';
      btn.dataset.looping = 'true';
    } else {
      btn.textContent = 'Recognize Text';
      btn.dataset.looping = 'false';
    }
  });

  const btnTextOnReopen = await page.evaluate(() =>
    document.getElementById('btn-recognize').textContent
  );
  assert(
    btnTextOnReopen === 'Stop Recognition',
    `After re-open while looping, button shows "Stop Recognition" (got "${btnTextOnReopen}")`
  );

  // Now click Stop Recognition → should send STOP_LIVE
  await page.click('#btn-recognize');
  await page.waitForTimeout(50);

  const btnTextAfterStop = await page.evaluate(() =>
    document.getElementById('btn-recognize').textContent
  );
  const sentStop = await page.evaluate(() =>
    window.__sentMessages.some(m => m.action === 'STOP_LIVE')
  );
  assert(sentStop, 'Clicking "Stop Recognition" sends STOP_LIVE message');
  assert(
    btnTextAfterStop === 'Recognize Text',
    `Button reverts to "Recognize Text" after stopping (got "${btnTextAfterStop}")`
  );

  await page.close();
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('UAT Phase 2 — Playwright headless tests');
  console.log('========================================');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await testCollapse(browser);
    await testAutoScroll(browser);
    await testToggleSync(browser);
  } finally {
    await browser.close();
  }

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) process.exit(1);

  // Write results summary
  return results;
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
