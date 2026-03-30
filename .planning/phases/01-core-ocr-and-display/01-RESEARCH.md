# Phase 1: Core OCR and Display - Research

**Researched:** 2026-03-30
**Domain:** Chrome Extension MV3 / tesseract.js OCR / Canvas video capture
**Confidence:** HIGH (core stack), MEDIUM (tesseract.js MV3 integration specifics)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use Manifest V3 (current Chrome standard). Service worker for background script, content script for page injection.
- **D-02:** User activates drawing mode via a button in the extension popup ("Draw Subtitle Area" or "Activate").
- **D-03:** User draws the box by clicking and dragging directly over the video — crop-tool style interaction.
- **D-04:** After drawing, the box shows 4 corner handles for resizing. No edge handles.
- **D-05:** The selection box stays visible as a persistent overlay while the video plays (always visible after being set).
- **D-06:** Visual style — semi-transparent blue/white border with white corner handles.
- **D-07:** Manual trigger via a "Recognize Text" button in the extension popup. Phase 1 is manual-only — continuous loop is Phase 2.
- **D-08:** While OCR is processing, the side panel shows a loading spinner and "Recognizing..." status text.
- **D-09:** If tesseract.js finds no text, show "No text recognized" in the side panel. Do not silently leave it blank.
- **D-10:** Side panel implemented as a div injected by the content script — not Chrome's Side Panel API.
- **D-11:** Side panel positioned on the right side of the YouTube page, overlaying (not reflowing) the layout.
- **D-12:** User-resizable — drag handle on the left edge to resize width. Default starting width ~300px.
- **D-13:** Minimal header: extension name ("YouTube Chinese Reader") + a close/hide button. Non-collapsible in Phase 1.

### Claude's Discretion
- Manifest permissions needed (activeTab, scripting, storage)
- How tesseract.js is bundled/loaded (bundled with extension, not CDN — no network dependency at runtime)
- Exact canvas capture approach for the selected video area
- Content script injection timing (document_idle vs document_start)
- Popup HTML/CSS structure

### Deferred Ideas (OUT OF SCOPE)
- **Continuous OCR loop** — Phase 2 scope (real-time synchronization).
- **Collapsible side panel** — Phase 2 per roadmap.
- **Timestamps** — Phase 2 per roadmap.
</user_constraints>

---

## Summary

This phase builds a Chrome Manifest V3 extension with three surfaces: popup, content-script-injected overlay, and content-script-injected side panel. The two non-trivial technical problems are (1) integrating tesseract.js v7 with MV3's strict Content Security Policy and WASM restrictions, and (2) capturing a sub-region of the YouTube video element to a canvas without triggering cross-origin taint errors.

tesseract.js v7.0.0 (December 2024) works with MV3 but requires all runtime files — worker script, WASM core, and language traineddata — to be bundled inside the extension package. The library must be configured with local paths via `chrome.runtime.getURL()`, `workerBlobURL: false`, and `web_accessible_resources` declared in manifest.json. The manifest's `content_security_policy.extension_pages` must include `'wasm-unsafe-eval'` for WebAssembly to compile.

Canvas capture of the YouTube `<video>` element works reliably from a content script running on `youtube.com` because the video content is same-origin from the extension's perspective (the content script shares the page's origin). The critical restriction is that capture must be performed in the content script, not the service worker (service workers have no DOM access; they use OffscreenCanvas but cannot access the live page's video element).

**Primary recommendation:** Bundle tesseract.js v7 files locally, configure with `workerBlobURL: false` and `chrome.runtime.getURL()` paths, capture video frames with a `<canvas>` in the content script, and run OCR in the content script (not the service worker).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tesseract.js | 7.0.0 (latest) | In-browser OCR for Chinese characters | Only mature pure-JS OCR library; no native binary dependency |
| tesseract.js-core | 6.1.2 | WASM binaries (auto-installed as dependency) | Peer dep of tesseract.js; do not install independently |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Chrome Extensions API (built-in) | MV3 | Extension lifecycle, messaging, storage | Built-in — no npm package |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tesseract.js (user-locked) | Chrome's built-in ML / cloud OCR | No alternative — user explicitly chose tesseract.js |
| Injected div panel | Chrome Side Panel API | Side Panel API requires Chrome 114+, cannot be opened programmatically from popup without user gesture in all versions; injected div is simpler and fully controlled |
| Canvas capture in content script | chrome.tabs.captureVisibleTab | captureVisibleTab captures the full visible tab, not a sub-region; requires additional cropping; also requires the extension popup to be closed first or the screenshot shows the popup. Canvas from content script is the correct approach for a live video sub-region. |

**Installation (local dev / build step):**
```bash
npm install tesseract.js
```

After install, copy runtime assets into the extension's build output:
```bash
# Copy worker and core files
cp node_modules/tesseract.js/dist/worker.min.js extension/libs/tesseract/
cp -r node_modules/tesseract.js-core/ extension/libs/tesseract-core/
# Download chi_sim traineddata (~13 MB) for offline use
# Source: https://tessdata.projectnaptha.com/4.0.0/chi_sim.traineddata.gz
# Or: https://github.com/tesseract-ocr/tessdata_fast/raw/main/chi_sim.traineddata
```

**Version verification (performed 2026-03-30):**
```
tesseract.js: 7.0.0 (npm registry confirmed)
tesseract.js-core: 6.1.2 (npm registry confirmed)
```

---

## Architecture Patterns

### Recommended Project Structure
```
extension/
├── manifest.json              # MV3 manifest
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.css
│   └── popup.js               # Sends messages to content script
├── content/
│   ├── content.js             # Main content script — injected into YouTube
│   ├── overlay.js             # SelectionOverlay module
│   └── sidepanel.js           # SidePanel module
├── background/
│   └── service-worker.js      # MV3 service worker (minimal — message relay only)
├── libs/
│   ├── tesseract/
│   │   └── worker.min.js      # Bundled tesseract worker
│   └── tesseract-core/        # WASM core files (from tesseract.js-core package)
│       ├── tesseract-core.wasm.js
│       ├── tesseract-core-simd.wasm.js
│       ├── tesseract-core-lstm.wasm.js
│       └── tesseract-core-simd-lstm.wasm.js
├── tessdata/
│   └── chi_sim.traineddata    # Chinese Simplified language model (~13 MB)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Pattern 1: Manifest V3 with WASM-enabled CSP

**What:** A MV3 manifest.json that grants the minimum permissions for YouTube injection, allows WASM execution, and exposes bundled tesseract assets to content scripts.
**When to use:** Every MV3 extension using WebAssembly.

```json
{
  "manifest_version": 3,
  "name": "YouTube Chinese Reader",
  "version": "1.0.0",
  "description": "OCR hard-coded Chinese subtitles on YouTube videos",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["https://www.youtube.com/*"],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/*"],
      "js": ["content/content.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  },
  "web_accessible_resources": [
    {
      "resources": [
        "libs/tesseract/worker.min.js",
        "libs/tesseract-core/*.js",
        "libs/tesseract-core/*.wasm",
        "tessdata/*.traineddata"
      ],
      "matches": ["https://www.youtube.com/*"]
    }
  ]
}
```

Source: Chrome Extensions CSP documentation; tesseract.js issue #961 (MV3 compatibility thread)

### Pattern 2: Tesseract.js v7 initialized with local paths

**What:** Configure tesseract.js to use bundled files instead of CDN, with `workerBlobURL: false` to avoid CSP violations.
**When to use:** Any Chrome extension usage of tesseract.js.

```javascript
// In content script (content/content.js)
import { createWorker } from '../libs/tesseract/tesseract.esm.min.js';
// OR using importScripts-style if bundling is avoided:
// Use the UMD build and access Tesseract globally

async function initOCR() {
  const workerPath = chrome.runtime.getURL('libs/tesseract/worker.min.js');
  const corePath = chrome.runtime.getURL('libs/tesseract-core/');
  const langPath = chrome.runtime.getURL('tessdata/');

  const worker = await Tesseract.createWorker('chi_sim', 1, {
    workerPath,
    corePath,
    langPath,
    workerBlobURL: false,  // CRITICAL for MV3 CSP compliance
    gzip: false,           // tessdata is pre-decompressed in extension
    logger: m => console.log('[Tesseract]', m),
  });
  return worker;
}
```

Source: tesseract.js issue #961, local installation docs

### Pattern 3: Video frame capture via Canvas in content script

**What:** Draw a region of the YouTube `<video>` element to a canvas, extract as ImageData or dataURL, pass to tesseract.js.
**When to use:** Sub-region OCR trigger from the content script.

```javascript
// In content script — triggered by "Recognize Text" message from popup
function captureVideoRegion(videoEl, rect) {
  // rect = { x, y, width, height } relative to video element's bounding box
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');

  // drawImage with source rectangle — captures only the selected area
  ctx.drawImage(
    videoEl,
    rect.x, rect.y, rect.width, rect.height,  // source (video pixel coords)
    0, 0, rect.width, rect.height              // dest (canvas)
  );

  // Returns base64 data URL — accepted by tesseract.js recognize()
  return canvas.toDataURL('image/png');
}
```

**Important:** `rect` coordinates must be in video intrinsic pixel space, not CSS pixel space. Scale using `videoEl.videoWidth / videoEl.getBoundingClientRect().width`.

Source: Content script canvas capture pattern (verified: canvas taint does not apply to content scripts running on youtube.com reading from the youtube.com `<video>` element)

### Pattern 4: Popup-to-content-script messaging (MV3)

**What:** Popup sends a command to the content script via `chrome.tabs.sendMessage`.
**When to use:** Popup buttons that trigger content script actions.

```javascript
// popup/popup.js
async function sendToContentScript(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response;
  } catch (err) {
    console.warn('Content script not ready:', err);
  }
}

document.getElementById('btn-draw').addEventListener('click', () => {
  sendToContentScript({ action: 'ACTIVATE_DRAW_MODE' });
});

document.getElementById('btn-recognize').addEventListener('click', async () => {
  const response = await sendToContentScript({ action: 'RECOGNIZE' });
  // Response comes back via message from content script updating side panel
});
```

```javascript
// content/content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ACTIVATE_DRAW_MODE') {
    overlay.activateDrawMode();
    sendResponse({ ok: true });
  }
  if (message.action === 'RECOGNIZE') {
    // Async: must return true to keep sendResponse channel open
    runOCR().then(text => sendResponse({ text }));
    return true;  // CRITICAL: keeps message channel open for async response
  }
});
```

Source: Chrome Extensions messaging documentation; victoronsoftware.com message passing guide (2024)

### Pattern 5: Selection box overlay (vanilla JS drag interaction)

**What:** A div overlay that intercepts mouse events over the YouTube player to implement click-drag drawing and corner-handle resizing.
**When to use:** The selection rectangle UI component.

Key implementation notes:
- Attach `mousedown` to the overlay container, `mousemove`/`mouseup` to `document` (not the overlay) to avoid losing the drag when mouse leaves the element.
- YouTube places a transparent `div.ytp-gradient-top` and `div.html5-video-container` above the video — the overlay must sit at a z-index above these (YouTube player UI is z-index ~10; use z-index 2147483646 to be safe).
- The overlay container itself should have `pointer-events: none` when not in draw mode, so normal YouTube controls remain usable.
- Corner handles need `pointer-events: auto` with their own `mousedown` listeners.

```javascript
// Coordinate conversion: CSS pixels to video intrinsic pixels
function cssToVideoCoords(cssX, cssY, videoEl) {
  const rect = videoEl.getBoundingClientRect();
  const scaleX = videoEl.videoWidth / rect.width;
  const scaleY = videoEl.videoHeight / rect.height;
  return {
    x: (cssX - rect.left) * scaleX,
    y: (cssY - rect.top) * scaleY,
  };
}
```

### Anti-Patterns to Avoid

- **Loading tesseract.js from CDN:** MV3 blocks remote script sources in `extension_pages`. Bundle locally.
- **Using `workerBlobURL: true` (default) in MV3:** Blob URL creation may be blocked by CSP. Always set `workerBlobURL: false` in extension context.
- **Running tesseract in the service worker:** Service workers have no access to DOM/video elements. Keep OCR in the content script.
- **Using `chrome.tabs.captureVisibleTab` for sub-region capture:** This captures the whole tab screenshot (expensive, async, closes popup). Canvas in content script is the right tool for live video sub-regions.
- **Setting `run_at: document_start` for content script:** The video element is not in the DOM yet. Use `document_idle`.
- **Applying `all_frames: true` in content_scripts:** This would inject into iframes including ads. Use `all_frames: false`.
- **Attaching mousemove to the overlay element instead of document:** The drag breaks when the mouse moves faster than the element updates.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chinese OCR | Custom WASM OCR bindings | tesseract.js (user-locked) | Tesseract's LSTM models handle CJK; thousands of edge cases in segmentation, OEM modes, HOCR parsing |
| Side panel resize (left-edge drag) | Custom CSS resize directive | Vanilla JS `mousedown`+`mousemove` pattern | CSS `resize` property only works on right/bottom edges; left-edge resize requires JS mouse tracking |
| Language data download management | Custom fetch + cache logic | tesseract.js's built-in caching (idb-keyval) | Already handles IndexedDB caching; pre-bundling the traineddata avoids download entirely |

**Key insight:** The hardest part of this phase is not the OCR itself — tesseract.js handles that. The hard parts are: (1) MV3 WASM bundling setup, and (2) getting the YouTube overlay pointer events correct without breaking the YouTube player controls.

---

## Common Pitfalls

### Pitfall 1: Tainted canvas when capturing video
**What goes wrong:** `canvas.toDataURL()` throws `SecurityError: The operation is insecure` after `drawImage(videoEl, ...)`.
**Why it happens:** This happens if the `<video>` element has loaded a resource from a different origin (e.g., a CORS-unprotected media URL) OR if the canvas was created outside the content script's DOM context.
**How to avoid:** Create the canvas directly in the content script. YouTube's video element is served from `googlevideo.com` but the browser does not taint the canvas for extension content scripts running on `youtube.com` because the content script shares the page's principal. Multiple developers have confirmed this works without taint errors on YouTube specifically.
**Warning signs:** If taint errors appear, verify the canvas is created by the content script (not passed from the popup or service worker), and that you are not doing anything with cross-origin image elements.

### Pitfall 2: `workerBlobURL` default breaks MV3
**What goes wrong:** `Error: Content Security Policy: The page's settings blocked the loading of a resource at blob:...`
**Why it happens:** tesseract.js default behavior creates a Blob URL for the worker script. MV3 CSP blocks blob: as a worker source.
**How to avoid:** Always pass `workerBlobURL: false` in `createWorker` options.
**Warning signs:** Error message mentioning `blob:` in console when OCR is triggered.

### Pitfall 3: WASM compilation blocked without CSP directive
**What goes wrong:** `WebAssembly.instantiate` fails silently or throws `CompileError`.
**Why it happens:** MV3 does not allow `unsafe-eval`. WASM compilation uses dynamic code evaluation and requires `wasm-unsafe-eval`.
**How to avoid:** Add `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" }` to manifest.json.
**Warning signs:** Tesseract worker initialization hangs or logs a WASM compile error.

### Pitfall 4: Content script not injected when popup fires message
**What goes wrong:** `chrome.tabs.sendMessage` throws `Error: Could not establish connection. Receiving end does not exist.`
**Why it happens:** The content script hasn't loaded yet (user opened YouTube after installing the extension, or navigated within YouTube SPA without a full page reload).
**How to avoid:** Wrap `sendMessage` in try/catch. Optionally use `chrome.scripting.executeScript` to programmatically inject the content script if the listener is not registered, or show an error state in the popup instructing the user to reload the tab.
**Warning signs:** Error fires reliably on the first use after installing the extension on an already-open YouTube tab.

### Pitfall 5: YouTube SPA navigation breaks the injected overlay and side panel
**What goes wrong:** User navigates from one YouTube video to another; the old overlay/side panel DOM persists on the new page, or the content script re-runs and creates duplicates.
**Why it happens:** YouTube is a Single Page App. Navigation does not trigger a full page load, so content scripts are not re-injected. But the old injected elements remain.
**How to avoid:** Listen for YouTube's custom `yt-navigate-finish` DOM event (or use `MutationObserver` on the page title) to detect navigation. On navigation: clean up existing injected elements before re-initializing. Guard against duplicate injection with a sentinel variable or a DOM presence check.
**Warning signs:** Duplicate panels appear, or the overlay references stale video elements.

### Pitfall 6: Video coordinate scaling mismatch
**What goes wrong:** OCR captures a region but the actual video content captured doesn't match what the user drew on screen (shifted or scaled incorrectly).
**Why it happens:** The selection box stores coordinates in CSS pixels, but `drawImage(videoEl, sx, sy, sw, sh)` uses the video's intrinsic pixel dimensions. On 1440p monitors or when the video is small, these differ by a factor of 2-4x.
**How to avoid:** Always convert selection coordinates using `scaleX = videoEl.videoWidth / videoEl.getBoundingClientRect().width` before passing to `drawImage`.
**Warning signs:** OCR captures black bars or wrong areas of the video.

### Pitfall 7: chi_sim traineddata size adds 13 MB to extension
**What goes wrong:** The unpacked extension exceeds Chrome Web Store's 10 MB limit (relevant for eventual publishing, not local dev).
**Why it happens:** chi_sim.traineddata is approximately 13 MB. Extension packages have a 10 MB (packed .crx) limit on the Chrome Web Store.
**How to avoid:** For Phase 1 (local development), this is not a blocker — load unpacked extensions have no size limit. For production/publishing (Phase 5), consider: (1) using `chi_sim_fast.traineddata` (~2 MB, lower accuracy) or (2) downloading traineddata on first use via `chrome.downloads` API and caching in extension's local storage.
**Warning signs:** Not relevant in Phase 1 but must be noted in the roadmap.

---

## Code Examples

Verified patterns from official sources and community-confirmed working approaches:

### tesseract.js recognize() with a canvas region
```javascript
// Source: tesseract.js v7 API docs (github.com/naptha/tesseract.js/blob/master/docs/api.md)
const result = await worker.recognize(canvasDataURL);
// result.data.text  — the plain text string
// result.data.confidence — overall confidence (0-100)
```

### Recognized text output shape (v7)
```javascript
// source: tesseract.js v6/v7 changelog (output formats disabled by default)
const result = await worker.recognize(imageSource, {}, { text: true });
// result.data.text  — string of recognized text
// Other formats (hocr, tsv, blocks) require explicit opt-in: { hocr: true }
```

### Side panel resize via left-edge drag handle
```javascript
// Pattern: mousedown on left handle, mousemove on document
const handle = document.getElementById('ycr-resize-handle');
let isResizing = false;
let startX, startWidth;

handle.addEventListener('mousedown', (e) => {
  isResizing = true;
  startX = e.clientX;
  startWidth = parseInt(panel.style.width, 10) || 300;
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.removeEventListener('mousemove', onMouseMove);
  }, { once: true });
});

function onMouseMove(e) {
  if (!isResizing) return;
  const delta = startX - e.clientX;  // panel grows leftward
  const newWidth = Math.min(600, Math.max(200, startWidth + delta));
  panel.style.width = newWidth + 'px';
}
```

### YouTube SPA navigation detection
```javascript
// YouTube fires 'yt-navigate-finish' on video navigation
document.addEventListener('yt-navigate-finish', () => {
  // Clean up and optionally re-initialize
  cleanupOverlay();
  cleanupSidePanel();
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Background page (persistent) | Service worker (MV3) | MV3 (Chrome 88+, mandatory ~2024) | Service workers are ephemeral — don't store state in the service worker between events |
| `worker.initialize()` + `worker.loadLanguage()` (tesseract v2-4) | `createWorker(lang, oem, opts)` single call (v5+) | tesseract.js v5 (2023) | Removed in v6/v7 — using old API throws errors |
| CDN-loaded tesseract | Bundled tesseract with local paths | MV3 CSP enforcement | CDN scripts are blocked; bundle everything |
| `unsafe-eval` in CSP | `wasm-unsafe-eval` only | MV3 | `unsafe-eval` is disallowed; WASM needs `wasm-unsafe-eval` specifically |
| tesseract.js v5/v6 | tesseract.js v7 (Dec 2024) | December 2024 | 15-35% faster due to relaxedsimd WASM; v7 is the current stable |

**Deprecated/outdated:**
- `worker.initialize(lang)`: Removed in v6. Use `createWorker(lang)` instead.
- `worker.loadLanguage(lang)`: Removed in v6. Pass language to `createWorker`.
- `chrome.browserAction` API: Replaced by `chrome.action` in MV3.
- `background.scripts` in manifest: Replaced by `background.service_worker` in MV3.

---

## Open Questions

1. **tesseract.js v7 local bundle in a non-built extension**
   - What we know: tesseract.js distributes a UMD bundle (`dist/tesseract.min.js`) that sets `window.Tesseract`. This can be loaded via `<script src>` in popup.html or via content script declaration.
   - What's unclear: Whether the UMD bundle includes the WASM inline or still requires the separate `tesseract.js-core` directory. The API docs reference this as a separate `corePath`.
   - Recommendation: The planner should include a Wave 0 task to verify the bundle structure after `npm install tesseract.js`, identify which files must be copied to `libs/`, and validate the local path setup works before OCR tasks begin.

2. **YouTube `<video>` element selector stability**
   - What we know: The `document.querySelector('video')` selector finds the YouTube player video element. The `#movie_player` container is also long-standing. Both have been used in extensions for years.
   - What's unclear: YouTube frequently changes its DOM structure. The selector may need to wait for the element (not present on immediate injection at `document_idle`).
   - Recommendation: Use `document.querySelector('#movie_player video')` with a MutationObserver or a timed retry loop (max 5s) to wait for the element.

3. **chi_sim.traineddata acquisition**
   - What we know: The file is ~13 MB. It can be downloaded from `tessdata.projectnaptha.com/4.0.0/chi_sim.traineddata.gz` (gzipped) or from the tesseract-ocr GitHub repo (uncompressed). Since `gzip: false` is set, the file should be decompressed before bundling.
   - What's unclear: Whether tesseract.js v7 uses tessdata format 4.0.0 or a newer format.
   - Recommendation: Use `chi_sim.traineddata` from `github.com/tesseract-ocr/tessdata_fast` (LSTM fast model, ~1.5 MB). This is sufficient for Phase 1 accuracy testing and avoids the extension size concern entirely. The planner should include a download step in Wave 0.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build/copy scripts | Yes | v20.20.1 | — |
| npm | Package install | Yes | 10.8.2 | — |
| Chrome browser | Manual testing | Unknown (dev container) | — | Test by loading unpacked extension in Chrome on host machine |
| tesseract.js (npm) | OCR | Not installed yet | — | Run `npm install tesseract.js` in Wave 0 |

**Missing dependencies with no fallback:**
- Chrome browser for manual testing — the extension must be loaded as an unpacked extension in Chrome. This is not available in the dev container. Testing will occur on the developer's host machine by loading the `extension/` directory at `chrome://extensions` with Developer Mode enabled.

**Missing dependencies with fallback:**
- None.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — greenfield project, no test config present |
| Config file | None — see Wave 0 |
| Quick run command | N/A — Phase 1 validation is manual (load extension in Chrome) |
| Full suite command | N/A |

### Phase Requirements to Test Map
| Behavior | Test Type | Verification Method |
|----------|-----------|---------------------|
| Extension loads in Chrome without errors | Manual smoke | Load unpacked at chrome://extensions, confirm no errors badge |
| Popup renders with "Draw Subtitle Area" + "Recognize Text" buttons and status indicator | Manual visual | Open popup on a YouTube tab |
| Clicking "Draw Subtitle Area" enters crosshair draw mode on YouTube player | Manual | Draw a box — confirm cursor changes, box appears |
| Selection box shows 4 corner handles and is resizable | Manual | Drag corner handles — confirm resize |
| "Recognize Text" button triggers OCR; side panel shows "Recognizing..." spinner | Manual | Click button while video is paused on a frame with Chinese text |
| Side panel shows recognized text or "No text recognized" | Manual | Confirm output appears after OCR completes |
| Side panel is injected on the right side, does not reflow YouTube layout | Manual visual | Confirm panel floats as overlay at z-index 9999 |
| Side panel is resizable via left-edge drag handle (200px min, 600px max) | Manual | Drag handle — confirm resize within bounds |
| Side panel close button hides the panel | Manual | Click "×" — confirm panel hidden |
| No errors in browser console during normal use | Manual | Open DevTools, perform all steps, check console |

### Wave 0 Gaps
- [ ] No test framework — Phase 1 uses manual verification only. Automated testing of DOM injection and canvas OCR requires a browser automation layer (Puppeteer/Playwright) which is Phase 5 scope.
- [ ] `npm install tesseract.js` — package not installed yet, must be Wave 0 step.
- [ ] Verify tesseract.js v7 bundle structure post-install (identify which files to copy to `libs/`).
- [ ] Download `chi_sim.traineddata` to `extension/tessdata/` — required before any OCR task can be tested.

---

## Sources

### Primary (HIGH confidence)
- `npm view tesseract.js` — confirmed version 7.0.0 as of 2026-03-30
- `npm view tesseract.js-core` — confirmed version 6.1.2 as of 2026-03-30
- [tesseract.js API docs](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) — createWorker options, recognize() signature
- [tesseract.js local installation docs](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) — corePath, workerPath, langPath, required files
- [tesseract.js v6 changelog](https://github.com/naptha/tesseract.js/issues/993) — removed deprecated APIs
- [tesseract.js v7 release notes](https://github.com/naptha/tesseract.js/releases) — performance improvements, relaxedsimd

### Secondary (MEDIUM confidence)
- [tesseract.js issue #961](https://github.com/naptha/tesseract.js/issues/961) — MV3 compatibility: `workerBlobURL: false` workaround, community-verified
- [Chrome Extensions MV3 CSP documentation reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — `wasm-unsafe-eval` in `extension_pages`
- [victoronsoftware.com message passing guide (2024)](https://victoronsoftware.com/posts/message-passing-in-chrome-extension/) — popup-to-content-script pattern verified
- Multiple WebSearch results confirming canvas capture from content script on YouTube does not trigger taint errors (multiple independent sources agree)

### Tertiary (LOW confidence)
- YouTube SPA navigation `yt-navigate-finish` event — documented in community extensions but not in official YouTube developer docs. Flag for validation during Wave 0 manual testing.
- YouTube DOM selector `#movie_player video` — widely used by extension developers but not in official YouTube API docs.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions confirmed against npm registry on research date
- Architecture (MV3 structure): HIGH — well-documented in Chrome developer docs
- tesseract.js MV3 integration: MEDIUM — community-verified workarounds, not officially documented by Google
- Pitfalls: MEDIUM — canvas taint, CSP issues verified by multiple sources; YouTube DOM selectors LOW (unofficial)
- Validation: N/A — manual-only in Phase 1

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (tesseract.js is active; MV3 policies are stable; YouTube DOM structure LOW confidence by nature)
