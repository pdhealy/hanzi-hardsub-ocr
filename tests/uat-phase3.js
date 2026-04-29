/**
 * UAT Phase 3 — Settings and Customization
 * Playwright headless tests for the three human verification items.
 *
 * Run: node tests/uat-phase3.js
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

function loadSidePanel() {
  const content = fs.readFileSync(
    path.join(__dirname, '../extension/content/sidepanel.js'),
    'utf8'
  );
  return 'window.pinyin = (text) => Array.from(text).map(()=>"mock");\nwindow.pinyinToZhuyin = () => "mock";\n' + 
         content.replace(/import .*/g, '').replace(/^export class SidePanel/m, 'class SidePanel') +
         '\nwindow.__SidePanel = SidePanel;';
}

function loadOptions() {
  return fs.readFileSync(
    path.join(__dirname, '../extension/options/options.js'),
    'utf8'
  );
}

const optionsHtml = fs.readFileSync(
  path.join(__dirname, '../extension/options/options.html'),
  'utf8'
);

/** Build a page with mocked chrome APIs and SidePanel injected. */
async function makePanelPage(browser, storage = {}) {
  const page = await browser.newPage();
  await page.setContent('<html><head></head><body></body></html>');

  // Inject mock chrome APIs
  await page.addScriptTag({ content: `
    window.__storage = ${JSON.stringify(storage)};
    window.__sentMessages = [];
    window.__openedUrls = [];
    window.__storageListeners = [];

    window.chrome = {
      runtime: {
        sendMessage: (msg) => {
          window.__sentMessages.push(msg);
          // Simulate service worker opening a new tab
          if (msg.action === 'OPEN_SETTINGS') {
            window.__openedUrls.push('chrome-extension://id/options/options.html');
          }
          return Promise.resolve({ ok: true });
        },
        getURL: (path) => 'chrome-extension://id/' + path,
      },
      storage: {
        sync: {
          get: (defaults, cb) => {
            const result = Object.assign({}, defaults, window.__storage);
            if (cb) { cb(result); return; }
            return Promise.resolve(result);
          },
          set: (values, cb) => {
            Object.assign(window.__storage, values);
            // Fire onChanged listeners
            const changes = {};
            for (const key of Object.keys(values)) {
              changes[key] = { newValue: values[key] };
            }
            window.__storageListeners.forEach(fn => fn(changes, 'sync'));
            if (cb) cb();
          },
        },
        onChanged: {
          addListener: (fn) => { window.__storageListeners.push(fn); },
          removeListener: (fn) => {
            window.__storageListeners = window.__storageListeners.filter(l => l !== fn);
          },
        },
      },
    };
  ` });

  await page.evaluate(loadSidePanel());
  return page;
}

// ── test 1 — Gear icon exists and toggles inline settings menu ────────────────────

async function testGearIconMessage(browser) {
  console.log('\nTest 1: Gear icon toggles inline settings menu');
  const page = await makePanelPage(browser);

  await page.evaluate(() => {
    window.__panel = new window.__SidePanel();
    window.__panel.show();
  });

  // Gear icon should be in the DOM
  const gearExists = await page.$('#ycr-panel-settings');
  assert(!!gearExists, 'Gear icon button (#ycr-panel-settings) exists in panel header');

  const gearText = await page.evaluate(() =>
    document.getElementById('ycr-panel-settings').textContent
  );
  assert(gearText === '⚙', `Gear icon shows ⚙ character (got "${gearText}")`);

  const ariaLabel = await page.evaluate(() =>
    document.getElementById('ycr-panel-settings').getAttribute('aria-label')
  );
  assert(ariaLabel === 'Open Settings', `Gear icon has aria-label "Open Settings" (got "${ariaLabel}")`);

  // Order: collapse | settings | close — settings between them
  const headerBtnIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#ycr-panel-header button'))
      .map(b => b.id);
  });
  const settingsIdx = headerBtnIds.indexOf('ycr-panel-settings');
  const collapseIdx = headerBtnIds.indexOf('ycr-panel-collapse');
  const closeIdx = headerBtnIds.indexOf('ycr-panel-close');
  assert(
    collapseIdx < settingsIdx && settingsIdx < closeIdx,
    `Gear icon is between collapse and close (order: ${headerBtnIds.join(', ')})`
  );

  // Click the gear icon
  const menuVisibleBefore = await page.evaluate(() => {
    return document.getElementById('ycr-settings-menu').classList.contains('ycr-visible');
  });
  assert(!menuVisibleBefore, 'Settings menu is hidden initially');

  await page.click('#ycr-panel-settings');
  await page.waitForTimeout(50);

  const menuVisibleAfter = await page.evaluate(() => {
    return document.getElementById('ycr-settings-menu').classList.contains('ycr-visible');
  });
  assert(menuVisibleAfter, 'Clicking gear icon shows inline settings menu');

  await page.close();
}

// ── test 2 — applySettings() updates DOM styles immediately ──────────────

async function testApplySettings(browser) {
  console.log('\nTest 2: applySettings() updates DOM styles immediately (real-time propagation)');
  const page = await makePanelPage(browser);

  await page.evaluate(() => {
    window.__panel = new window.__SidePanel();
    window.__panel.show();
    window.__panel.appendEntry('00:01', '今天天气很好');
  });

  // Verify default styles are applied
  const styleElExists = await page.evaluate(() =>
    !!document.getElementById('ycr-entry-styles')
  );
  assert(styleElExists, 'Style element #ycr-entry-styles exists after show()');

  const defaultStyleContent = await page.evaluate(() =>
    document.getElementById('ycr-entry-styles').textContent
  );
  assert(
    defaultStyleContent.includes('14px'),
    `Default font size (14px) is in injected styles (got: "${defaultStyleContent.trim().slice(0, 80)}")`
  );

  // Call applySettings() directly (as content.js would via loadAndApplySettings)
  await page.evaluate(() => {
    window.__panel.applySettings({ fontSize: 22, fontColor: '#EF4444', bgOpacity: 0.5 });
  });

  const updatedStyleContent = await page.evaluate(() =>
    document.getElementById('ycr-entry-styles').textContent
  );
  assert(
    updatedStyleContent.includes('22px'),
    `Font size updated to 22px immediately (style: "${updatedStyleContent.trim().slice(0, 80)}")`
  );
  assert(
    updatedStyleContent.includes('#EF4444'),
    `Font color updated to #EF4444 immediately`
  );
  assert(
    updatedStyleContent.includes('rgba(255, 255, 255, 0.5)'),
    `Background opacity updated to 0.5 immediately`
  );

  await page.close();
}

// ── test 3 — chrome.storage.onChanged triggers live panel update ──────────

async function testStorageChangeListener(browser) {
  console.log('\nTest 3: chrome.storage.onChanged triggers real-time panel update');

  // Start with default settings in mock storage
  const page = await makePanelPage(browser, {
    ycrFontSize: 14,
    ycrFontColor: '#111827',
    ycrBgOpacity: 1.0,
  });

  // Simulate content.js: set up loadAndApplySettings wired to the panel
  await page.evaluate(() => {
    window.__panel = new window.__SidePanel();
    window.__panel.show();

    // Wire storage.onChanged listener like content.js does
    const SETTING_KEYS = ['ycrFontSize', 'ycrFontColor', 'ycrBgOpacity'];
    function loadAndApplySettings() {
      chrome.storage.sync.get(
        { ycrFontSize: 14, ycrFontColor: '#111827', ycrBgOpacity: 1.0 },
        (settings) => {
          window.__panel.applySettings({
            fontSize: settings.ycrFontSize,
            fontColor: settings.ycrFontColor,
            bgOpacity: settings.ycrBgOpacity,
          });
        }
      );
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (!SETTING_KEYS.some(k => k in changes)) return;
      loadAndApplySettings();
    });

    // Apply initial settings
    loadAndApplySettings();
  });

  const initialStyle = await page.evaluate(() =>
    document.getElementById('ycr-entry-styles').textContent
  );
  assert(initialStyle.includes('14px'), `Initial font size is 14px`);
  assert(initialStyle.includes('#111827'), `Initial font color is #111827`);

  // Simulate options.js saving new settings → fires onChanged listeners
  await page.evaluate(() => {
    chrome.storage.sync.set({
      ycrFontSize: 22,
      ycrFontColor: '#EF4444',
      ycrBgOpacity: 0.6,
    });
  });

  await page.waitForTimeout(50);

  const updatedStyle = await page.evaluate(() =>
    document.getElementById('ycr-entry-styles').textContent
  );
  assert(
    updatedStyle.includes('22px'),
    `Font size updates to 22px after storage change (style: "${updatedStyle.trim().slice(0, 80)}")`
  );
  assert(
    updatedStyle.includes('#EF4444'),
    `Font color updates to #EF4444 after storage change`
  );
  assert(
    updatedStyle.includes('rgba(255, 255, 255, 0.6)'),
    `Background opacity updates to 0.6 after storage change`
  );

  await page.close();
}

// ── test 4 — settings persist: panel reads from storage on show ───────────

async function testSettingsPersistence(browser) {
  console.log('\nTest 4: Panel applies persisted settings on first show (cross-session persistence)');

  // Pre-populate storage with non-default settings (simulates a previously-saved session)
  const page = await makePanelPage(browser, {
    ycrFontSize: 20,
    ycrFontColor: '#DC2626',
    ycrBgOpacity: 0.7,
  });

  await page.evaluate(() => {
    window.__panel = new window.__SidePanel();
    window.__panel.show();
    // Simulate the loadAndApplySettings() call from content.js on panel show
    chrome.storage.sync.get(
      { ycrFontSize: 14, ycrFontColor: '#111827', ycrBgOpacity: 1.0 },
      (settings) => {
        window.__panel.applySettings({
          fontSize: settings.ycrFontSize,
          fontColor: settings.ycrFontColor,
          bgOpacity: settings.ycrBgOpacity,
        });
      }
    );
  });

  await page.waitForTimeout(50);

  const styleContent = await page.evaluate(() =>
    document.getElementById('ycr-entry-styles').textContent
  );

  assert(
    styleContent.includes('20px'),
    `Panel loads persisted font size (20px) on first show (style: "${styleContent.trim().slice(0, 80)}")`
  );
  assert(
    styleContent.includes('#DC2626'),
    `Panel loads persisted font color (#DC2626) on first show`
  );
  assert(
    styleContent.includes('rgba(255, 255, 255, 0.7)'),
    `Panel loads persisted bg opacity (0.7) on first show`
  );

  // Default (14px) must NOT be present — would indicate storage wasn't read
  assert(
    !styleContent.includes('14px'),
    `Default font size (14px) is NOT used when storage has saved values`
  );

  await page.close();
}

// ── test 5 — options page: save button writes to chrome.storage.sync ──────

async function testOptionsPageSave(browser) {
  console.log('\nTest 5: Options page save button writes settings to chrome.storage.sync');

  // Build the options page HTML with mock chrome API injected
  const mockChrome = `
    window.__savedSettings = null;
    window.chrome = {
      storage: {
        sync: {
          get: (defaults, cb) => {
            cb(Object.assign({}, defaults));
          },
          set: (values, cb) => {
            window.__savedSettings = values;
            if (cb) cb();
          },
        },
      },
    };
  `;

  // Inline the options.js into the page (replace external <script> with inline)
  const optionsScript = loadOptions();
  const html = optionsHtml.replace(
    '<script src="options.js"></script>',
    `<script>${mockChrome}</script><script>${optionsScript}</script>`
  );

  const page = await browser.newPage();
  await page.setContent(html);
  await page.waitForTimeout(50);

  // Change controls to non-default values
  await page.evaluate(() => {
    document.getElementById('font-size').value = 20;
    document.getElementById('font-color').value = '#DC2626';
    document.getElementById('bg-opacity').value = 0.75;
  });

  // Click Save
  await page.click('#btn-save');
  await page.waitForTimeout(50);

  const saved = await page.evaluate(() => window.__savedSettings);

  assert(saved !== null, 'Save button triggers chrome.storage.sync.set');
  assert(
    saved.ycrFontSize === 20,
    `ycrFontSize saved as integer 20 (got ${JSON.stringify(saved?.ycrFontSize)})`
  );
  assert(
    saved.ycrFontColor.toLowerCase() === '#dc2626',
    `ycrFontColor saved as "#DC2626" (got "${saved?.ycrFontColor}")`
  );
  assert(
    saved.ycrBgOpacity === 0.75,
    `ycrBgOpacity saved as float 0.75 (got ${JSON.stringify(saved?.ycrBgOpacity)})`
  );

  // Verify "Saved!" feedback appears
  const saveStatusVisible = await page.evaluate(() =>
    document.getElementById('save-status').classList.contains('visible')
  );
  assert(saveStatusVisible, '"Saved!" status message appears after saving');

  await page.close();
}

// ── test 6 — options page: loads stored settings into controls ────────────

async function testOptionsPageLoad(browser) {
  console.log('\nTest 6: Options page populates controls from chrome.storage.sync on open');

  const storedSettings = { ycrFontSize: 18, ycrFontColor: '#7C3AED', ycrBgOpacity: 0.8 };
  const mockChrome = `
    window.chrome = {
      storage: {
        sync: {
          get: (defaults, cb) => {
            cb(${JSON.stringify(storedSettings)});
          },
          set: (values, cb) => { if (cb) cb(); },
        },
      },
    };
  `;

  const optionsScript = loadOptions();
  const html = optionsHtml.replace(
    '<script src="options.js"></script>',
    `<script>${mockChrome}</script><script>${optionsScript}</script>`
  );

  const page = await browser.newPage();
  await page.setContent(html);
  await page.waitForTimeout(50);

  const fontSizeVal = await page.evaluate(() => document.getElementById('font-size').value);
  const fontColorVal = await page.evaluate(() => document.getElementById('font-color').value);
  const bgOpacityVal = await page.evaluate(() => document.getElementById('bg-opacity').value);
  const fontSizeReadout = await page.evaluate(() => document.getElementById('font-size-val').textContent);
  const fontColorHint = await page.evaluate(() => document.getElementById('font-color-hint').textContent);
  const bgOpacityReadout = await page.evaluate(() => document.getElementById('bg-opacity-val').textContent);

  assert(fontSizeVal === '18', `Font size slider set to 18 from storage (got "${fontSizeVal}")`);
  assert(fontColorVal === '#7c3aed', `Font color picker set to #7C3AED from storage (got "${fontColorVal}")`);
  assert(bgOpacityVal === '0.8', `Opacity slider set to 0.8 from storage (got "${bgOpacityVal}")`);
  assert(fontSizeReadout === '18px', `Font size readout shows "18px" (got "${fontSizeReadout}")`);
  assert(fontColorHint === '#7C3AED', `Color hint shows "#7C3AED" (got "${fontColorHint}")`);
  assert(bgOpacityReadout === '0.80', `Opacity readout shows "0.80" (got "${bgOpacityReadout}")`);

  await page.close();
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('UAT Phase 3 — Settings and Customization');
  console.log('=========================================');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await testGearIconMessage(browser);
    await testApplySettings(browser);
    await testStorageChangeListener(browser);
    await testSettingsPersistence(browser);
    await testOptionsPageSave(browser);
    await testOptionsPageLoad(browser);
  } finally {
    await browser.close();
  }

  console.log('\n=========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('=========================================\n');

  if (failed > 0) process.exit(1);
  return results;
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
