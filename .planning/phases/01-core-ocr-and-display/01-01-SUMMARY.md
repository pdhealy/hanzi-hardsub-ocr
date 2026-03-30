---
phase: 01-core-ocr-and-display
plan: 01
subsystem: infra
tags: [chrome-extension, mv3, tesseract.js, esbuild, eslint, ocr, wasm]

requires: []

provides:
  - Chrome MV3 extension scaffold with manifest.json, content script, service worker, popup
  - esbuild bundling pipeline (IIFE for content + popup scripts, Chrome 120 target)
  - tesseract.js v7 runtime files (worker.min.js, tesseract-core WASM) bundled in extension/libs/
  - chi_sim.traineddata (2.4MB fast model) bundled in extension/tessdata/
  - ESLint v9 flat config scoped to extension source (excludes libs/dist)
  - Popup UI with Draw Subtitle Area + Recognize Text buttons and status indicator

affects:
  - 01-02
  - 01-03
  - 01-04

tech-stack:
  added:
    - tesseract.js v7.0.0 (runtime OCR)
    - tesseract.js-core v6.1.2 (WASM binaries)
    - esbuild v0.27.4 (bundler)
    - eslint v10.1.0 (linter)
    - globals v17.4.0 (ESLint flat config globals)
  patterns:
    - Content scripts bundled as IIFE (Chrome extension requirement, no ES modules in injected scripts)
    - ESLint v9 flat config with webextensions globals, ignoring libs/ and dist/
    - Manifest web_accessible_resources exposes tesseract-core/* and tessdata/* to YouTube content scripts
    - wasm-unsafe-eval in extension_pages CSP for tesseract.js WASM compilation

key-files:
  created:
    - extension/manifest.json
    - extension/popup/popup.html
    - extension/popup/popup.css
    - extension/popup/popup.js
    - extension/content/content.js
    - extension/background/service-worker.js
    - esbuild.config.js
    - eslint.config.js
    - extension/libs/tesseract/worker.min.js
    - extension/libs/tesseract/tesseract.min.js
    - extension/libs/tesseract-core/ (WASM binaries)
    - extension/tessdata/chi_sim.traineddata
    - extension/icons/icon16.png
    - extension/icons/icon48.png
    - extension/icons/icon128.png
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Used ESLint v9 flat config (eslint.config.js) instead of legacy .eslintrc.json because ESLint 10.x requires flat config format"
  - "Excluded extension/libs/** and extension/dist/** from linting to avoid false positives in vendored tesseract WASM files"
  - "chi_sim.traineddata from tessdata_fast (2.4MB) chosen over full tessdata (~13MB) to keep extension under Chrome Web Store 10MB limit"
  - "Content scripts bundled as IIFE format (not ESM) because Chrome extension content_scripts do not support ES modules"

patterns-established:
  - "Pattern: esbuild IIFE bundling for Chrome extension content and popup scripts"
  - "Pattern: Tesseract.js local path configuration via chrome.runtime.getURL() with workerBlobURL: false"
  - "Pattern: Popup-to-content-script messaging via chrome.tabs.sendMessage with try/catch"

requirements-completed:
  - REQ-OCR-ENGINE
  - REQ-TOGGLE
  - REQ-FEEDBACK

duration: 5min
completed: 2026-03-30
---

# Phase 01 Plan 01: Project Scaffold and Build Toolchain Summary

**Chrome MV3 extension scaffold with tesseract.js v7 WASM bundled locally, esbuild pipeline, popup UI with status indicator, and all content/background script stubs in place**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-30T12:56:46Z
- **Completed:** 2026-03-30T13:01:15Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments

- Extension scaffold complete: manifest.json (MV3, wasm-unsafe-eval CSP, YouTube content script), service worker, popup HTML/CSS/JS
- Build pipeline working: `npm run build` bundles content + popup as IIFE for Chrome 120, `npm run lint` passes clean
- tesseract.js v7 assets bundled: worker.min.js (109KB), full WASM core (tesseract-core-*), and chi_sim.traineddata (2.4MB fast model)
- Popup UI renders title, status indicator (gray=inactive, green=ready, amber=recognizing), and two buttons with correct disabled state

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize project, install dependencies, and set up build toolchain** - `33ea833` (chore)
2. **Task 2: Create MV3 manifest, popup UI, content script stub, and service worker** - `9dc4d7a` (feat)

**Plan metadata:** (added in final metadata commit)

## Files Created/Modified

- `extension/manifest.json` - MV3 manifest with wasm-unsafe-eval CSP, YouTube host_permissions, web_accessible_resources for tesseract assets
- `extension/popup/popup.html` - Popup with title, status indicator, Draw Subtitle Area + Recognize Text buttons
- `extension/popup/popup.css` - Full button states (default/hover/active/disabled/focus), status dot pulse animation
- `extension/popup/popup.js` - sendToContentScript helper, ACTIVATE_DRAW_MODE / RECOGNIZE / GET_STATUS handlers
- `extension/content/content.js` - Message listener stub for all 4 actions (ACTIVATE_DRAW_MODE, RECOGNIZE, GET_STATUS, SHOW_PANEL)
- `extension/background/service-worker.js` - Minimal onInstalled listener
- `esbuild.config.js` - IIFE bundler for content + popup, --watch mode support
- `eslint.config.js` - ESLint v9 flat config with webextensions globals
- `extension/libs/tesseract/worker.min.js` - tesseract.js worker runtime (109KB)
- `extension/libs/tesseract-core/` - WASM binaries (standard, simd, lstm, relaxedsimd variants)
- `extension/tessdata/chi_sim.traineddata` - Chinese Simplified fast model (2.4MB)
- `extension/icons/icon{16,48,128}.png` - Placeholder blue icons
- `package.json` - Build/lint/watch scripts, tesseract.js dep, esbuild+eslint devDeps

## Decisions Made

- **ESLint v9 flat config required:** ESLint 10.x no longer reads `.eslintrc.json` by default. Migrated to `eslint.config.js` flat format with `globals` package for browser/webextensions globals. The `.eslintrc.json` was kept as a reference artifact but is not loaded.
- **Exclude libs/ and dist/ from linting:** Vendored tesseract WASM JS files use Node.js globals (require, process, __dirname) and lack semicolons — linting them produces thousands of false positives. Explicitly ignored in eslint.config.js.
- **chi_sim_fast (2.4MB) over chi_sim (13MB):** The full tessdata model would push the extension close to Chrome Web Store's 10MB packed limit. The fast LSTM model is sufficient for Phase 1 manual testing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESLint v9 requires flat config format**
- **Found during:** Task 1 verification (`npm run lint`)
- **Issue:** Plan specified `.eslintrc.json` format but ESLint 10.x requires `eslint.config.js` flat format. Running lint with only `.eslintrc.json` produced a fatal config error.
- **Fix:** Created `eslint.config.js` using ESLint v9 flat config with `globals` package. Installed `globals` as devDependency. Kept `.eslintrc.json` but it is unused.
- **Files modified:** `eslint.config.js` (new), `package.json` (added globals devDep)
- **Verification:** `npm run lint` exits 0 with only 1 expected warning (unused stub variable)
- **Committed in:** `33ea833` (Task 1 commit)

**2. [Rule 1 - Bug] Duplicate `description` key in package.json**
- **Found during:** Task 1 (`npm run build` esbuild warning)
- **Issue:** package.json had two `description` fields — one with the real description and one empty string. esbuild emitted a warning about duplicate object literal keys.
- **Fix:** Removed the duplicate empty `description` field.
- **Files modified:** `package.json`
- **Verification:** `npm run build` produces no duplicate-key warning
- **Committed in:** `33ea833` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking config format, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correct operation. No scope creep.

## Issues Encountered

- ESLint v9 flat config migration required installing the `globals` package (not in original plan). The `.eslintrc.json` format is not loaded by ESLint 10.x without a migration step.
- tesseract-core WASM JS files trigger hundreds of lint errors if not excluded — they use CJS globals like `require` and `process` that are valid in their Node.js build context but invalid in the browser ESM context the linter assumes.

## Known Stubs

- `extension/content/content.js` line 5: `sidePanelVisible = false` — variable declared but never read in this plan (will be used when side panel is implemented in 01-02 or 01-03)
- `extension/content/content.js` line 4: `selectionBox = null` — stub; actual draw mode implementation is in the next plan
- All message handlers (`ACTIVATE_DRAW_MODE`, `RECOGNIZE`, `SHOW_PANEL`) respond with stub `ok: true` or placeholder text — real implementations are in subsequent plans

These stubs are intentional scaffolding. They do not prevent this plan's goal (loadable extension scaffold + working build pipeline) from being achieved.

## Next Phase Readiness

- Extension loads as unpacked in Chrome: manifest, icons, popup, content script, service worker all in place
- Build pipeline verified: `npm run build` and `npm run lint` both exit 0
- tesseract.js runtime assets accessible from content scripts via `chrome.runtime.getURL('libs/tesseract/worker.min.js')`
- Ready for Plan 01-02: SelectionOverlay implementation (draw mode, resize handles)
- No blockers for subsequent plans

---
*Phase: 01-core-ocr-and-display*
*Completed: 2026-03-30*
