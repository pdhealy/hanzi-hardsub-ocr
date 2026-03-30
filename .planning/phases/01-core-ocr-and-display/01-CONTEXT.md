# Phase 1: Core OCR and Display - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Set up the Chrome extension scaffold (manifest, content script, background script), integrate tesseract.js, implement a click-drag selection box overlay on the YouTube player, capture the selected area, perform a manual OCR trigger on the static frame, and display the raw recognized text in an injected side panel on the right side of the page. Collapsibility, real-time loop, timestamps, settings, and export are out of scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### Extension Architecture
- **D-01:** Use Manifest V3 (current Chrome standard). Service worker for background script, content script for page injection.

### Selection Box Behavior
- **D-02:** User activates drawing mode via a button in the extension popup ("Draw Subtitle Area" or "Activate").
- **D-03:** User draws the box by clicking and dragging directly over the video — crop-tool style interaction.
- **D-04:** After drawing, the box shows 4 corner handles for resizing. No edge handles.
- **D-05:** The selection box stays visible as a persistent overlay while the video plays (always visible after being set, so the user can verify alignment).
- **D-06:** Visual style — semi-transparent blue/white border with white corner handles. Visible on most video content.

### OCR Trigger
- **D-07:** Manual trigger via a "Recognize Text" button in the extension popup. Phase 1 is manual-only — continuous loop is Phase 2.
- **D-08:** While OCR is processing, the side panel shows a loading spinner and "Recognizing..." status text.
- **D-09:** If tesseract.js finds no text, show "No text recognized" in the side panel. Do not silently leave it blank.

### Side Panel
- **D-10:** Implemented as a div injected by the content script — not Chrome's Side Panel API. Simpler and works reliably on YouTube.
- **D-11:** Positioned on the right side of the YouTube page, overlaying the page (not pushing/reflowing YouTube's layout).
- **D-12:** User-resizable — drag handle on the left edge to resize width. Default starting width ~300px.
- **D-13:** Has a minimal header: extension name ("YouTube Chinese Reader") + a close/hide button. Non-collapsible in Phase 1 (close button just hides the panel without disabling the extension).

### Claude's Discretion
- Manifest permissions needed (activeTab, scripting, storage)
- How tesseract.js is bundled/loaded (bundled with extension, not CDN — no network dependency at runtime)
- Exact canvas capture approach for the selected video area
- Content script injection timing (document_idle vs document_start)
- Popup HTML/CSS structure

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements are fully captured in decisions above and in `.planning/REQUIREMENTS.md`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project. Only `package-lock.json` exists in the workspace root.

### Established Patterns
- No existing patterns to inherit. All patterns will be established in this phase.

### Integration Points
- The content script will inject into YouTube (`https://www.youtube.com/*`).
- The popup communicates with the content script via `chrome.tabs.sendMessage` / `chrome.runtime.onMessage`.
- The selection box overlay interacts with the YouTube video player element (`#movie_player` or equivalent).

</code_context>

<specifics>
## Specific Ideas

- Side panel should be user-resizable (drag handle on left edge) — user explicitly overrode the fixed-width default.
- The real-time OCR loop (1-second interval or change-detection, whichever is best-practice) was deferred to Phase 2 by the user's preference, not because it's unwanted.

</specifics>

<deferred>
## Deferred Ideas

- **Continuous OCR loop** — User wants OCR to trigger every time subtitle text changes, or every 1 second (whichever is more feasible/best-practice). This is Phase 2 scope (real-time synchronization). Capture this preference in Phase 2 context.
- **Collapsible side panel** — Phase 2 per roadmap.
- **Timestamps** — Phase 2 per roadmap.

</deferred>

---

*Phase: 01-core-ocr-and-display*
*Context gathered: 2026-03-30*
