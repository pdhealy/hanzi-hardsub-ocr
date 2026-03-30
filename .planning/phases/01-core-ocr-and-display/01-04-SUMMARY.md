---
phase: 01-core-ocr-and-display
plan: 04
subsystem: ocr
tags: [tesseract.js, canvas, chrome-extension, content-script, mv3, ocr, chinese]

# Dependency graph
requires:
  - phase: 01-core-ocr-and-display plan 02
    provides: SelectionOverlay with getVideoIntrinsicRect() for intrinsic-pixel canvas capture
  - phase: 01-core-ocr-and-display plan 03
    provides: SidePanel with show/hide/showLoading/showText/showEmpty/showNoSelection/showError

provides:
  - OCREngine class (extension/content/ocr.js): tesseract.js v7 initialization with local extension paths, canvas video frame capture, recognize() returning {text, confidence}
  - Fully wired content.js orchestrator connecting popup messages to overlay, OCR engine, and side panel
  - Complete end-to-end flow: ACTIVATE_DRAW_MODE -> overlay, RECOGNIZE -> OCR -> panel display
  - All UI states handled: loading, text, empty (no text), no-selection, error

affects: [02-continuous-ocr, popup-button-state, background-service-worker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - tesseract.min.js loaded as UMD global via manifest content_scripts entry before content bundle
    - OCREngine auto-initializes on first recognize() call (lazy init with guard)
    - Canvas drawImage uses video intrinsic pixel coordinates from overlay.getVideoIntrinsicRect()
    - Async message handler returns `true` to keep Chrome message channel open for sendResponse
    - All three modules (overlay, sidepanel, ocrEngine) nulled and destroyed on yt-navigate-finish

key-files:
  created:
    - extension/content/ocr.js
  modified:
    - extension/content/content.js
    - extension/manifest.json

key-decisions:
  - "tesseract.min.js loaded via manifest content_scripts js array (Option A from plan) — UMD global approach avoids bundling complications"
  - "OCREngine lazy-initializes on first use rather than at content script load — avoids expensive worker startup unless user actually triggers OCR"
  - "canvas.toDataURL('image/png') used for OCR input — accepted directly by worker.recognize()"

patterns-established:
  - "Lazy init pattern: ensureXxx() functions create module instances on first use"
  - "Async chrome message handler: async IIFE + return true keeps sendResponse channel open"
  - "SPA cleanup: yt-navigate-finish destroys all injected module instances and nulls references"

requirements-completed: [REQ-OCR-ENGINE, REQ-TOGGLE, REQ-DISPLAY, REQ-FEEDBACK]

# Metrics
duration: 4min
completed: 2026-03-30
---

# Phase 1 Plan 04: OCR Pipeline and Content Script Wiring Summary

**tesseract.js v7 OCR engine with canvas video frame capture wired to side panel via fully orchestrated content.js message handler**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-30T13:12:47Z
- **Completed:** 2026-03-30T13:16:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- OCREngine class with tesseract.js v7 initialization using local extension paths (workerBlobURL: false, gzip: false for MV3 CSP compliance)
- Canvas-based video frame capture using intrinsic pixel coordinates from SelectionOverlay.getVideoIntrinsicRect()
- Fully wired content.js handling all 4 popup message types: ACTIVATE_DRAW_MODE, GET_STATUS, SHOW_PANEL, RECOGNIZE
- All side panel states driven correctly: loading spinner, recognized text, no-text, no-selection, error

## Task Commits

1. **Task 1: Implement OCR module with tesseract.js initialization and video frame capture** - `6ab5291` (feat)
2. **Task 2: Wire all modules in content.js — complete popup-to-display flow** - `4f8cdde` (feat)

## Files Created/Modified

- `extension/content/ocr.js` - OCREngine class: worker init with local paths, canvas capture, recognize(), terminate()
- `extension/content/content.js` - Complete orchestrator: all message handlers, lazy module init, SPA cleanup
- `extension/manifest.json` - Added libs/tesseract/tesseract.min.js before dist/content.bundle.js in content_scripts

## Decisions Made

- Used Option A from plan: tesseract.min.js loaded as UMD global via manifest content_scripts rather than bundled by esbuild. This avoids esbuild bundling issues with the tesseract.js WASM worker pattern.
- OCREngine uses lazy initialization (initializes on first recognize() call) to avoid expensive worker startup until the user actually triggers OCR.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — all panel state methods are wired to real data sources. The OCREngine calls real tesseract.js worker, canvas capture uses the live video element, and side panel displays actual OCR output.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- End-to-end flow complete: popup buttons trigger draw mode or OCR, side panel shows all states
- Phase 2 (continuous OCR loop) can extend the RECOGNIZE handler with a timer/requestAnimationFrame loop
- tesseract.js worker persists in memory as long as the page is open; Phase 2 should reuse the existing OCREngine instance
- Manual testing in Chrome required to validate actual OCR output quality on Chinese subtitles

---
*Phase: 01-core-ocr-and-display*
*Completed: 2026-03-30*
