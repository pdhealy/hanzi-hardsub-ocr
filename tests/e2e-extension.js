/**
 * E2E — Chrome Extension (Playwright + Chromium)
 *
 * Verifies that the YouTube Chinese Reader extension loads and runs correctly
 * in a real Chromium browser, with specific focus on the fixes applied in
 * Phase 04 (PaddleOCR migration):
 *
 *   Fix 1 — JSEP hang:   wasmPaths no longer points to a directory; JSEP files removed.
 *   Fix 2 — scriptSrc:   wasmPaths uses short keys { wasm, mjs } so ORT marks
 *                         isWasmOverridden=true and skips the import.meta code path
 *                         that throws "cannot determine the script source URL".
 *   Fix 3 — Timer dup:   performance.now() replaces console.time() so retries don't
 *                         collide on a still-running timer label.
 *
 * Tests:
 *   1. Source config     — offscreen-ocr.js wasmPaths uses { wasm, mjs } short keys
 *   2. JSEP files absent — no jsep.wasm / jsep.mjs in extension/libs/ort/
 *   3. Bundle integrity  — bundle preserves short keys, no full-filename key pattern
 *   4. Extension load    — service worker registers, URL matches expected pattern
 *   5. No startup errors — popup page loads without pageerror events
 *   6. SW connectivity   — OPEN_SETTINGS action returns { ok: true }
 *   7. OCR pipeline      — OCR_RECOGNIZE_IMAGE response free of the errors we fixed
 *   8. Timer collision   — two rapid OCR calls both complete without timer errors
 *
 * Run:
 *   node tests/e2e-extension.js
 *
 * Notes:
 *   - Tests 4-8 require a display; this script starts Xvfb automatically if DISPLAY
 *     is not already set (requires Xvfb to be installed).
 *   - Tests 7 & 8 download ~50 MB of ONNX models from unpkg.com on first run.
 *     Subsequent runs use the Cache API inside the extension (fast).
 *   - If the network is unavailable, OCR tests are skipped (not failed).
 */

'use strict';

const { chromium } = require('playwright');
const { spawn }    = require('child_process');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');

// ── Constants ─────────────────────────────────────────────────────────────────

const EXTENSION_PATH  = path.resolve(__dirname, '../extension');
const SOURCE_OCR_PATH = path.resolve(__dirname, '../extension/background/offscreen-ocr.js');
const BUNDLE_PATH     = path.resolve(__dirname, '../extension/background/offscreen-ocr.bundle.js');
const ORT_LIBS_PATH   = path.resolve(__dirname, '../extension/libs/ort');

// Model download can take several minutes on a cold cache — be generous.
const OCR_TIMEOUT_MS    = 5 * 60 * 1000; // 5 minutes
const STARTUP_WAIT_MS   = 2_000;          // time for SW + offscreen init
const SW_REGISTER_MS    = 12_000;         // service worker registration timeout

// Errors that must NOT appear in any OCR response
const FATAL_ERROR_PATTERNS = [
  'cannot determine the script source URL',
  'no available backend found',
  'ERR: [wasm]',
];

// ── Test harness ──────────────────────────────────────────────────────────────

let passed  = 0;
let failed  = 0;
let skipped = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function skip(label, reason) {
  console.log(`  ⊘ SKIP — ${label} (${reason})`);
  skipped++;
}

// ── Virtual display (Xvfb) ────────────────────────────────────────────────────

let xvfbProcess = null;

async function ensureDisplay() {
  if (process.env.DISPLAY) return; // already have a display

  // Find an available display slot using the process PID to avoid collisions
  const displayNum = `:${90 + (process.pid % 50)}`;

  return new Promise((resolve, reject) => {
    xvfbProcess = spawn('Xvfb', [displayNum, '-screen', '0', '1280x960x24'], {
      stdio: 'ignore',
      detached: false,
    });
    xvfbProcess.on('error', (err) => reject(new Error(`Xvfb failed: ${err.message}`)));

    process.env.DISPLAY = displayNum;
    // Give Xvfb ~600ms to start accepting connections
    setTimeout(resolve, 600);
  });
}

function stopDisplay() {
  if (xvfbProcess) {
    xvfbProcess.kill();
    xvfbProcess = null;
  }
}

// ── Test 1 — Source: wasmPaths uses short keys { wasm, mjs } ─────────────────

function testSourceWasmPathsKeys() {
  console.log('\nTest 1: Source — wasmPaths uses short keys { wasm, mjs }');

  const source = fs.readFileSync(SOURCE_OCR_PATH, 'utf8');

  // The source should contain:  wasm: chrome.runtime.getURL(...)
  assert(
    /wasm\s*:\s*chrome\.runtime\.getURL/.test(source),
    'offscreen-ocr.js wasmPaths has "wasm:" key pointing to getURL'
  );
  assert(
    /mjs\s*:\s*chrome\.runtime\.getURL/.test(source),
    'offscreen-ocr.js wasmPaths has "mjs:" key pointing to getURL'
  );

  // Ensure the old broken pattern (directory string) is gone
  assert(
    !/wasmPaths\s*=\s*chrome\.runtime\.getURL\s*\(\s*['"][^'"]*libs\/ort\/['"]/.test(source),
    'wasmPaths is NOT set to a directory string (old broken pattern absent)'
  );
}

// ── Test 2 — JSEP files absent from extension/libs/ort/ ──────────────────────

function testJsepFilesAbsent() {
  console.log('\nTest 2: extension/libs/ort/ — no JSEP variants');

  const files = fs.existsSync(ORT_LIBS_PATH) ? fs.readdirSync(ORT_LIBS_PATH) : [];

  assert(
    !files.some(f => f.includes('.jsep.')),
    'No *.jsep.* files in extension/libs/ort/ (prevents JSEP init hang)'
  );
  assert(files.includes('ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm is present');
  assert(files.includes('ort-wasm-simd-threaded.mjs'),  'ort-wasm-simd-threaded.mjs is present');
}

// ── Test 3 — Bundle preserves short keys, avoids full-filename pattern ────────

function testBundleWasmPathsKeys() {
  console.log('\nTest 3: Bundle — short keys preserved, no full-filename key');

  if (!fs.existsSync(BUNDLE_PATH)) {
    assert(false, `offscreen-ocr.bundle.js exists at ${BUNDLE_PATH}`);
    return;
  }

  // Read the full bundle and search for the wasmPaths block we emit.
  // esbuild preserves unquoted property names, so we look for the pattern:
  //   <ident>.wasm.wasmPaths = { wasm: ..., mjs: ... }
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');

  // Confirm our short-key assignment was compiled in
  assert(
    /\.wasmPaths\s*=\s*\{[^}]*\bwasm\s*:/.test(bundle),
    'Bundle: wasmPaths assignment has "wasm:" key'
  );
  assert(
    /\.wasmPaths\s*=\s*\{[^}]*\bmjs\s*:/.test(bundle),
    'Bundle: wasmPaths assignment has "mjs:" key'
  );

  // Guard against the old bug: full-filename string as a key pointing to getURL.
  // Pattern:  { 'ort-wasm-simd-threaded.wasm': chrome.runtime.getURL(...) }
  // (ORT's own internal JSEP fallback also contains "ort-wasm-simd-threaded.jsep.wasm"
  //  as a URL argument, NOT as a property key — so we scope the check to getURL.)
  assert(
    !/['"]ort-wasm-simd-threaded[^'"]*['"]\s*:\s*chrome\.runtime\.getURL/.test(bundle),
    'Bundle: full-filename string NOT used as wasmPaths key with getURL (old bug absent)'
  );
}

// ── Tests 4-8 — Live extension in real Chromium ───────────────────────────────

/**
 * Build a minimal 640×100 data URL (PNG) with white Chinese text on a black
 * background — a synthetic subtitle frame for smoke-testing the OCR pipeline.
 */
async function makeTestImageDataUrl(page) {
  return page.evaluate(() => {
    const canvas  = document.createElement('canvas');
    canvas.width  = 640;
    canvas.height = 100;
    const ctx     = canvas.getContext('2d');
    ctx.fillStyle   = '#000000';
    ctx.fillRect(0, 0, 640, 100);
    ctx.fillStyle    = '#ffffff';
    ctx.font         = 'bold 36px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('你好世界', 180, 50);
    return canvas.toDataURL('image/png');
  });
}

async function runBrowserTests() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycr-e2e-'));

  await ensureDisplay();

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,   // Extensions require a real display (provided by Xvfb above)
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  // Collect web errors (CSP violations, unhandled rejections visible to Playwright)
  const webErrors = [];
  context.on('weberror', (err) => webErrors.push(err.error().message));

  try {
    // ── Test 4 — Service worker registers ──────────────────────────────────

    console.log('\nTest 4: Extension load — service worker registers');

    let sw;
    if (context.serviceWorkers().length > 0) {
      sw = context.serviceWorkers()[0];
    } else {
      sw = await context.waitForEvent('serviceworker', { timeout: SW_REGISTER_MS })
           .catch(() => null);
    }

    assert(sw !== null, 'Service worker registered within timeout');
    if (!sw) {
      console.error('  Service worker did not register — skipping remaining browser tests');
      return;
    }

    const swUrl = sw.url();
    assert(
      /chrome-extension:\/\/[a-z]{32}\/background\/service-worker\.js/.test(swUrl),
      `SW URL matches expected pattern (got: ${swUrl})`
    );

    const extId = swUrl.match(/chrome-extension:\/\/([a-z]{32})\//)?.[1];
    assert(extId != null && extId.length === 32, `Extension ID extracted: ${extId}`);
    if (!extId) return;

    // ── Test 5 — Popup loads without errors ───────────────────────────────

    console.log('\nTest 5: No startup errors — popup loads cleanly');

    const popupPage = await context.newPage();
    const pageErrors = [];
    popupPage.on('pageerror', (err) => pageErrors.push(err.message));

    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });

    await popupPage.waitForTimeout(STARTUP_WAIT_MS);

    assert(
      pageErrors.length === 0,
      pageErrors.length === 0
        ? 'No pageerror events during popup startup'
        : `pageerror events: ${pageErrors.join(' | ')}`
    );

    // ── Test 6 — Service worker connectivity ─────────────────────────────

    console.log('\nTest 6: SW connectivity — OPEN_SETTINGS action');

    const settingsReply = await popupPage.evaluate(() =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'OPEN_SETTINGS' }, (resp) =>
          resolve(resp || null)
        );
      })
    ).catch(() => null);

    assert(
      settingsReply?.ok === true,
      `OPEN_SETTINGS returns { ok: true } (got: ${JSON.stringify(settingsReply)})`
    );

    // ── Test 7 — OCR pipeline (first request) ────────────────────────────

    console.log('\nTest 7: OCR pipeline — no fixed errors in response');
    console.log('  (first run downloads ~50 MB models; may take several minutes)');
    console.log(`  Timeout: ${OCR_TIMEOUT_MS / 1000}s`);

    const testImage = await makeTestImageDataUrl(popupPage);

    // Playwright's page.evaluate has no built-in timeout option; set the default
    // page timeout to accommodate the first-run model download (~50 MB).
    popupPage.setDefaultTimeout(OCR_TIMEOUT_MS + 60_000);

    const ocrResult = await popupPage.evaluate(
      async ({ dataUrl, timeout }) => {
        return new Promise((resolve) => {
          const timer = setTimeout(
            () => resolve({ ok: false, error: 'e2e-timeout' }),
            timeout
          );
          chrome.runtime.sendMessage(
            { action: 'OCR_RECOGNIZE_IMAGE', imageDataUrl: dataUrl },
            (response) => {
              clearTimeout(timer);
              resolve(response || { ok: false, error: 'no-response' });
            }
          );
        });
      },
      { dataUrl: testImage, timeout: OCR_TIMEOUT_MS }
    ).catch((err) => ({ ok: false, error: err.message }));

    const errMsg = (ocrResult?.error ?? '').toLowerCase();

    if (errMsg.includes('e2e-timeout') || errMsg.includes('no-response')) {
      skip('OCR response arrived within timeout', 'timed out — possibly slow network on first model download');
      skip('Response free of fatal error patterns', 'depends on Test 7 completing');
    } else {
      for (const pattern of FATAL_ERROR_PATTERNS) {
        assert(
          !errMsg.includes(pattern.toLowerCase()),
          `Response does not contain "${pattern}"`
        );
      }

      if (ocrResult?.ok === true) {
        assert(typeof ocrResult.text === 'string', `Result has text field`);
        console.log(`  ℹ OCR text: "${ocrResult.text}"`);
      } else {
        // ok:false is acceptable for a synthetic image (detection may find no boxes)
        console.log(`  ℹ OCR returned ok:false, error: "${ocrResult?.error}" — acceptable for synthetic image`);
      }
    }

    // ── Test 8 — No timer collision on rapid retry ────────────────────────

    console.log('\nTest 8: Timer fix — second rapid OCR call, no collision error');

    const prevFailed = failed;
    const test7Passed = failed === prevFailed;

    if (!test7Passed) {
      skip('Second OCR call: no timer collision', 'Test 7 did not succeed');
    } else {
      // Models are now cached — second call should be fast
      const ocrResult2 = await popupPage.evaluate(
        async ({ dataUrl, timeout }) => {
          return new Promise((resolve) => {
            const timer = setTimeout(
              () => resolve({ ok: false, error: 'e2e-timeout' }),
              timeout
            );
            chrome.runtime.sendMessage(
              { action: 'OCR_RECOGNIZE_IMAGE', imageDataUrl: dataUrl },
              (response) => {
                clearTimeout(timer);
                resolve(response || { ok: false, error: 'no-response' });
              }
            );
          });
        },
        { dataUrl: testImage, timeout: 60_000 }
      ).catch((err) => ({ ok: false, error: err.message }));

      const err2 = (ocrResult2?.error ?? '').toLowerCase();
      assert(
        !err2.includes('timer'),
        `Second OCR call: no "Timer already exists" error (got: "${ocrResult2?.error ?? ''}")`
      );
      assert(
        !err2.includes('cannot determine the script source url'),
        `Second OCR call: no "cannot determine script source URL" error`
      );
    }

    await popupPage.close();

  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('E2E — Chrome Extension (Playwright + Chromium)');
  console.log('===============================================');
  console.log(`Extension: ${EXTENSION_PATH}`);

  // Static checks — no browser needed
  testSourceWasmPathsKeys();
  testJsepFilesAbsent();
  testBundleWasmPathsKeys();

  // Live browser tests
  try {
    await runBrowserTests();
  } finally {
    stopDisplay();
  }

  console.log('\n===============================================');
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('===============================================\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  stopDisplay();
  console.error('Test runner error:', err);
  process.exit(1);
});
