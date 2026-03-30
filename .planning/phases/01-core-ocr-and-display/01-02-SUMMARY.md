---
phase: 01-core-ocr-and-display
plan: 02
subsystem: ui
tags: [chrome-extension, overlay, selection-box, ocr, event-handling, coordinate-conversion]

requires:
  - phase: 01-01
    provides: Extension scaffold with content.js stub, esbuild IIFE bundling pipeline

provides:
  - SelectionOverlay class in extension/content/overlay.js — draw mode, corner resize handles, box drag/move, coordinate conversion
  - Content script updated to import and wire overlay for ACTIVATE_DRAW_MODE and GET_STATUS messages

affects:
  - 01-03
  - 01-04

tech-stack:
  added: []
  patterns:
    - SelectionOverlay encapsulates all draw/resize/move DOM interactions and event cleanup
    - document-level mousemove/mouseup listeners tracked in array for cleanup in destroy()
    - Video intrinsic rect computed via videoWidth/videoHeight divided by getBoundingClientRect dimensions
    - SPA navigation cleanup via yt-navigate-finish listener in both overlay module and content script

key-files:
  created:
    - extension/content/overlay.js
  modified:
    - extension/content/content.js

key-decisions:
  - "SelectionOverlay tracks all document-level event listeners in an array so destroy() can remove them all — prevents event leaks on YouTube SPA navigation"
  - "Overlay container attached as child of #movie_player so position:absolute coordinates are relative to the player, not the viewport"
  - "pointer-events: none on overlay container by default so YouTube controls remain accessible; set to auto only during draw/resize/move operations"

patterns-established:
  - "Pattern: Document-level listener array for reliable cleanup in content script modules"
  - "Pattern: Overlay z-index 2147483646 (max-1) for content injected above YouTube UI"

requirements-completed:
  - REQ-AREA

duration: 2min
completed: 2026-03-30
---

# Phase 01 Plan 02: Selection Box Overlay Summary

**Click-drag SelectionOverlay module with corner resize handles, box drag/move, intrinsic-pixel coordinate conversion, and YouTube SPA cleanup wired into content script**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-30T13:06:15Z
- **Completed:** 2026-03-30T13:08:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- SelectionOverlay class implemented with full draw, resize, and move interactions matching UI spec colors and corner handle styles
- Video coordinate conversion maps CSS pixels to video intrinsic pixels via videoWidth/getBoundingClientRect scaling (ready for OCR capture)
- Content script imports overlay, handles ACTIVATE_DRAW_MODE by calling ensureOverlay().activateDrawMode(), and reports hasSelection() on GET_STATUS
- Both overlay module and content script listen for yt-navigate-finish to destroy/reset the overlay on YouTube SPA navigation

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement SelectionOverlay module with draw and resize interactions** - `39c5d76` (feat)
2. **Task 2: Wire overlay module into content script message handlers** - `bf7f3e4` (feat)

**Plan metadata:** (added in final metadata commit)

## Files Created/Modified

- `extension/content/overlay.js` - SelectionOverlay class: draw mode, corner resize handles (nw/ne/sw/se), box drag/move with clamping, getVideoIntrinsicRect for OCR coordinate mapping, destroy() with full listener cleanup
- `extension/content/content.js` - Updated with import, ensureOverlay(), ACTIVATE_DRAW_MODE wired, GET_STATUS returns hasSelection(), yt-navigate-finish cleanup

## Decisions Made

- Overlay container attached as child of `#movie_player` so `position: absolute` coordinates are relative to the player element, matching the video element bounds.
- All document-level listeners stored in `_docListeners` array so `destroy()` cleans up reliably without leaking handlers on SPA navigation.
- `pointer-events: none` on overlay container by default to preserve YouTube controls; toggled to `auto` only for the duration of draw/resize/move interactions.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

- `extension/content/content.js`: `sidePanelVisible` variable declared but unused (will be needed in Plan 01-03 when side panel is implemented)
- `extension/content/content.js`: `RECOGNIZE` handler returns stub text — will be wired to tesseract.js in Plan 01-03
- `extension/content/content.js`: `SHOW_PANEL` handler is stub — will be wired in Plan 01-03/01-04

These stubs do not prevent this plan's goal (working selection box overlay) from being achieved.

## Next Phase Readiness

- SelectionOverlay fully functional: draw mode, 4 corner resize handles, box drag/move, coordinate conversion
- content.js imports overlay, ACTIVATE_DRAW_MODE activates draw mode on the overlay, GET_STATUS reports box drawn state
- `npm run build` bundles overlay into content.bundle.js, `npm run lint` exits 0 (1 pre-existing warning about sidePanelVisible)
- Ready for Plan 01-03: OCR capture using getVideoIntrinsicRect() to crop the canvas from the video frame

---
*Phase: 01-core-ocr-and-display*
*Completed: 2026-03-30*
