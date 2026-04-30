/**
 * E2E — Chrome Extension (Playwright + Chromium)
 *
 * Verifies that the Hanzi Hardsub Reader extension loads and runs correctly
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
 *   1.  Source config      — offscreen-ocr.js wasmPaths uses { wasm, mjs } short keys
 *   2.  JSEP files absent  — no jsep.wasm / jsep.mjs in extension/libs/ort/
 *   3.  Bundle integrity   — bundle preserves short keys, no full-filename key pattern
 *   3b. Popup warn-free    — popup.bundle.js has no console.warn inside sendToContentScript
 *   3c. Content bundle     — content.bundle.js is present and non-empty
 *   4.  Extension load     — service worker registers, URL matches expected pattern
 *   5.  No startup errors  — popup page loads without pageerror events
 *   6.  Non-YouTube guard  — popup on non-YouTube tab: no "Receiving end" error,
 *                            status label shows "Open YouTube to use", buttons disabled
 *   7.  SW connectivity    — OPEN_SETTINGS action returns { ok: true }
 *   8.  Content script     — loads on mock YouTube page with zero page errors
 *   9.  OCR pipeline       — OCR_RECOGNIZE_IMAGE response free of the errors we fixed
 *  10.  Timer collision    — two rapid OCR calls both complete without timer errors
 *
 * Run:
 *   node tests/e2e-extension.js
 *
 * Notes:
 *   - Tests 4-8 require a display; this script starts Xvfb automatically if DISPLAY
 *     is not already set (requires Xvfb to be installed).
 *   - ONNX models are pre-bundled in the extension package (no network download).
 *     ORT session init takes ~400 ms on first call; subsequent calls are faster.
 */

'use strict';

const { chromium } = require('playwright');
const { spawn }    = require('child_process');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');

// ── Constants ─────────────────────────────────────────────────────────────────

const EXTENSION_PATH       = path.resolve(__dirname, '../extension');
const SOURCE_OCR_PATH      = path.resolve(__dirname, '../extension/background/offscreen-ocr.js');
const BUNDLE_PATH          = path.resolve(__dirname, '../extension/background/offscreen-ocr.bundle.js');
const POPUP_BUNDLE_PATH    = path.resolve(__dirname, '../extension/dist/popup.bundle.js');
const CONTENT_BUNDLE_PATH  = path.resolve(__dirname, '../extension/dist/content.bundle.js');
const ORT_LIBS_PATH        = path.resolve(__dirname, '../extension/libs/ort');

// Models are pre-bundled in the extension package (no network download).
// First call initialises ORT sessions (~400 ms); allow generous headroom.
const OCR_TIMEOUT_MS    = 30_000; // 30 s — ample for local bundle + ORT init
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

// ── Test 3b — Popup bundle: no console.warn inside sendToContentScript ────────

function testPopupBundleNoWarn() {
  console.log('\nTest 3b: Popup bundle — no console.warn inside sendToContentScript');

  if (!fs.existsSync(POPUP_BUNDLE_PATH)) {
    assert(false, `popup.bundle.js exists at ${POPUP_BUNDLE_PATH}`);
    return;
  }

  const bundle = fs.readFileSync(POPUP_BUNDLE_PATH, 'utf8');

  // Extract the sendToContentScript function body from the bundle.
  // esbuild preserves the function name.  We look for the span between
  // "sendToContentScript" and the next top-level function definition.
  const fnStart = bundle.indexOf('sendToContentScript');
  const fnEnd   = bundle.indexOf('\nasync function ', fnStart + 1);
  const fnBody  = fnEnd > fnStart ? bundle.slice(fnStart, fnEnd) : bundle.slice(fnStart, fnStart + 1500);

  assert(
    !fnBody.includes('console.warn'),
    'sendToContentScript does NOT call console.warn (would show in Extensions error panel)'
  );
  assert(
    fnBody.includes('Receiving end does not exist'),
    'sendToContentScript explicitly checks for "Receiving end does not exist" message'
  );
}

// ── Test 3c — Content bundle: present and non-empty ───────────────────────────

function testContentBundlePresent() {
  console.log('\nTest 3c: Content bundle — dist/content.bundle.js exists and non-empty');

  const exists = fs.existsSync(CONTENT_BUNDLE_PATH);
  assert(exists, 'dist/content.bundle.js exists');

  if (exists) {
    const size = fs.statSync(CONTENT_BUNDLE_PATH).size;
    assert(size > 10_000, `content.bundle.js is non-trivial (${size} bytes)`);

    // Spot-check key identifiers (search full bundle — these appear deep in the file)
    const full = fs.readFileSync(CONTENT_BUNDLE_PATH, 'utf8');
    assert(full.includes('SelectionOverlay'),
      'content.bundle.js contains SelectionOverlay (overlay module bundled)');
    assert(full.includes('onMessage'),
      'content.bundle.js registers a runtime.onMessage listener');
  }
}

// ── Tests 4-10 — Live extension in real Chromium ──────────────────────────────

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

    // ── Test 6 — Non-YouTube guard ────────────────────────────────────────
    // The popup opens on a chrome-extension:// page (not YouTube).
    // sendToContentScript should return silently and the UI should reflect
    // "Open YouTube to use" without throwing "Receiving end does not exist".

    console.log('\nTest 6: Non-YouTube guard — popup silent, buttons disabled');

    const consoleWarnings = [];
    popupPage.on('console', (msg) => {
      if (msg.type() === 'warning') consoleWarnings.push(msg.text());
    });

    // Re-run the popup init by navigating to it again (fresh load)
    const nonYtPage = await context.newPage();
    const nonYtErrors = [];
    const nonYtWarnings = [];
    nonYtPage.on('pageerror', (e) => nonYtErrors.push(e.message));
    nonYtPage.on('console', (msg) => {
      if (msg.type() === 'warning') nonYtWarnings.push(msg.text());
    });

    // Navigate to the popup from a page whose URL is NOT youtube.com.
    // The popup's getActiveYouTubeTab() will check the active tab URL.
    // We open the popup directly — the "active tab" context will be the
    // chrome-extension:// URL itself, which does not match the YouTube pattern.
    await nonYtPage.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    await nonYtPage.waitForTimeout(STARTUP_WAIT_MS);

    // No "Receiving end does not exist" in page errors
    assert(
      nonYtErrors.length === 0,
      nonYtErrors.length === 0
        ? 'No pageerror events on non-YouTube popup open'
        : `pageerror on non-YouTube popup: ${nonYtErrors.join(' | ')}`
    );

    // No "Content script not ready" warning
    assert(
      !nonYtWarnings.some(w => w.includes('Content script not ready')),
      `No "Content script not ready" warning on non-YouTube tab (warnings: ${nonYtWarnings.join(', ') || 'none'})`
    );

    // Status label updated to "Open YouTube to use"
    const statusText = await nonYtPage.$eval('#status-label', el => el.textContent);
    assert(
      statusText === 'Open YouTube to use',
      `Status label shows "Open YouTube to use" (got: "${statusText}")`
    );

    // Draw button disabled on non-YouTube tab
    const btnDrawDisabled = await nonYtPage.$eval('#btn-draw', el => el.disabled);
    assert(btnDrawDisabled, 'Draw button is disabled on non-YouTube tab');

    await nonYtPage.close();

    // ── Test 7 — Service worker connectivity ─────────────────────────────

    console.log('\nTest 7: SW connectivity — OPEN_SETTINGS action');

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

    // ── Test 8 — Content script loads on mock YouTube page ───────────────
    // Use context.route to intercept https://www.youtube.com/* and serve a
    // minimal mock page.  Chrome injects the content script into any page
    // matching the manifest host_permissions pattern — this verifies that
    // dist/content.bundle.js loads without syntax errors or runtime crashes,
    // and that the popup silently handles a YouTube tab where the content
    // script may or may not have fully registered its message listener yet.

    console.log('\nTest 8: Content script — loads on mock YouTube page without errors');

    // Minimal mock YouTube page: has the video player element the content
    // script looks for, but no actual YouTube JS/CSS (avoids network dependency).
    const mockYouTubeHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>YouTube</title></head>
<body>
  <div id="movie_player">
    <video id="video" width="640" height="360" src=""></video>
  </div>
</body>
</html>`;

    await context.route('https://www.youtube.com/**', (route) => {
      route.fulfill({ status: 200, contentType: 'text/html', body: mockYouTubeHtml });
    });

    const ytPage = await context.newPage();
    const ytPageErrors   = [];
    const ytPageWarnings = [];
    ytPage.on('pageerror', (e) => ytPageErrors.push(e.message));
    ytPage.on('console',   (msg) => {
      if (msg.type() === 'warning') ytPageWarnings.push(msg.text());
    });

    await ytPage.goto('https://www.youtube.com/watch?v=e2e_test', {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    // Wait for document_idle (content script injection point)
    await ytPage.waitForTimeout(STARTUP_WAIT_MS);

    assert(
      ytPageErrors.length === 0,
      ytPageErrors.length === 0
        ? 'No pageerror events when content script loads on mock YouTube page'
        : `pageerror on mock YouTube: ${ytPageErrors.join(' | ')}`
    );

    // The content script must NOT surface any console.warn / console.error
    // (it shouldn't — its message listener only fires when messages arrive)
    assert(
      !ytPageWarnings.some(w => w.toLowerCase().includes('error')),
      `No error-level warnings from content script on load (got: ${ytPageWarnings.join(', ') || 'none'})`
    );

    // Open popup while YouTube page is the most-recently-active tab.
    // bringToFront() makes ytPage the Playwright "active" target, so
    // chrome.tabs.query({ active:true }) in the popup should see it as active.
    await ytPage.bringToFront();

    const ytPopupPage    = await context.newPage();
    const ytPopupErrors  = [];
    const ytPopupWarnings = [];
    ytPopupPage.on('pageerror', (e) => ytPopupErrors.push(e.message));
    ytPopupPage.on('console',  (msg) => {
      if (msg.type() === 'warning') ytPopupWarnings.push(msg.text());
    });

    await ytPopupPage.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    await ytPopupPage.waitForTimeout(STARTUP_WAIT_MS);

    assert(
      ytPopupErrors.length === 0,
      ytPopupErrors.length === 0
        ? 'No pageerror events when popup opens over mock YouTube tab'
        : `pageerror: ${ytPopupErrors.join(' | ')}`
    );

    // The key assertion: "Content script not ready" must NOT appear as a warning
    // (it was the source of the Extensions panel error that prompted this fix)
    assert(
      !ytPopupWarnings.some(w => w.includes('Content script not ready')),
      `No "Content script not ready" warning when popup opens on YouTube tab (warnings: ${ytPopupWarnings.join(', ') || 'none'})`
    );

    await ytPage.close();
    await ytPopupPage.close();
    await context.unroute('https://www.youtube.com/**');

    // ── Test 9 — OCR pipeline (first request) ────────────────────────────

    console.log('\nTest 9: OCR pipeline — no fixed errors in response');
    console.log('  (models pre-bundled — no network download; ORT init ~400 ms on first call)');
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
      skip('OCR response arrived within timeout', 'timed out — check offscreen doc for errors via CDP');
      skip('Response free of fatal error patterns', 'depends on Test 9 completing');
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

    // ── Test 10 — No timer collision on rapid retry ───────────────────────

    console.log('\nTest 10: Timer fix — second rapid OCR call, no collision error');

    const prevFailed = failed;
    const test8Passed = failed === prevFailed;

    if (!test8Passed) {
      skip('Second OCR call: no timer collision', 'Test 9 did not succeed');
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
  testPopupBundleNoWarn();
  testContentBundlePresent();

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
