---
phase: 03-settings-and-customization
plan: 01
subsystem: ui
tags: [chrome-extension, vanilla-js, dom, css, chrome-storage, options-page]

# Dependency graph
requires:
  - phase: 02-real-time-synchronization-and-ui
    provides: SidePanel with appendEntry, CSS classes .ycr-entry and .ycr-text
provides:
  - extension/options/options.html — settings page with font size, font color, bg opacity controls
  - extension/options/options.css — settings page styles
  - extension/options/options.js — load/save settings via chrome.storage.sync
  - SidePanel.loadSettings() — reads chrome.storage.sync and applies styles on init
  - SidePanel._applySettings(settings) — injects #ycr-entry-styles into document.head
  - chrome.storage.onChanged listener in SidePanel — live propagation when options page saves
affects:
  - 03-02 (if any future plan adds more settings)
  - 04-01 (persistence phase may extend chrome.storage usage)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Settings stored in chrome.storage.sync under ycrFontSize/ycrFontColor/ycrBgOpacity keys"
    - "Separate #ycr-entry-styles <style> element for setting overrides — does not touch PANEL_STYLES constant"
    - "chrome.storage.onChanged listener registered in _init(), removed in destroy() — same lifecycle as panel DOM"
    - "Options page uses plain <script> tag (no bundling) — extension options_page runs in privileged context"

key-files:
  created:
    - extension/options/options.html
    - extension/options/options.css
    - extension/options/options.js
  modified:
    - extension/content/sidepanel.js
    - extension/manifest.json
    - extension/dist/content.bundle.js
    - extension/dist/content.bundle.js.map

key-decisions:
  - "Options page JS loaded via plain <script> (not bundled) — options_page runs in privileged extension context with direct chrome.* API access, no module system needed"
  - "Settings injected as a separate #ycr-entry-styles <style> element so PANEL_STYLES constant remains unchanged and styles can be replaced atomically"
  - "chrome.storage.onChanged listener re-fetches full settings from storage (rather than computing delta) to ensure consistency when multiple keys change simultaneously"
  - "bgOpacity applies to the panel background as rgba(255,255,255,opacity) — maintains white base color with variable transparency"

patterns-established:
  - "Pattern: settings style override via separate named <style> element, replaced on each _applySettings call"
  - "Pattern: DEFAULT_SETTINGS constant in sidepanel.js serves as both fallback values and storage.get() defaults object"

requirements-completed: [REQ-SETTINGS-FONT, REQ-SETTINGS-OPACITY, REQ-SETTINGS-PERSIST]

# Metrics
duration: 2min
completed: 2026-03-31
---

# Phase 3 Plan 01: Settings Page and Style Customization Summary

**Settings options page with font size, font color, and panel background opacity controls persisted via chrome.storage.sync and applied live to SidePanel entries**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-31T12:01:46Z
- **Completed:** 2026-03-31T12:03:56Z
- **Tasks:** 3
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments
- `extension/options/options.html` — settings form with range sliders, color picker, live readouts, and Save button
- `extension/options/options.css` — card-style layout matching existing design language (system-ui, #2563EB primary, 6px radius, white background)
- `extension/options/options.js` — loads settings from `chrome.storage.sync` on open, writes on Save, shows 2s "Saved!" feedback
- `SidePanel.loadSettings()` — called in `_init()`, reads `chrome.storage.sync` and calls `_applySettings()`
- `SidePanel._applySettings()` — injects `#ycr-entry-styles` `<style>` element with `.ycr-entry .ycr-text` font overrides and `#ycr-side-panel` background-rgba override
- `chrome.storage.onChanged` listener in SidePanel propagates settings changes live (no panel reload needed)
- `manifest.json` updated with `"options_page": "options/options.html"`
- Build and ESLint pass with zero errors

## Task Commits

1. **Task 1: Options page HTML and CSS** - `3b49c3a` (feat)
2. **Task 2: Options page JS with chrome.storage.sync** - `1f1b95a` (feat)
3. **Task 3: Manifest registration and sidepanel settings wiring** - `9111d14` (feat)

## Files Created/Modified
- `extension/options/options.html` — Settings form; font size range (12-28px), color picker, opacity range (0.1-1.0), Save button
- `extension/options/options.css` — Card layout; system-ui font, #2563EB accent, responsive readout badges
- `extension/options/options.js` — Load/save settings, live readout updates, "Saved!" feedback with 2s timeout
- `extension/content/sidepanel.js` — Added DEFAULT_SETTINGS, loadSettings(), _applySettings(), _onStorageChange listener, destroy() cleanup
- `extension/manifest.json` — Added options_page field
- `extension/dist/content.bundle.js` — Rebuilt bundle
- `extension/dist/content.bundle.js.map` — Rebuilt source map

## Decisions Made
- Options page JS loaded via plain `<script>` tag (not bundled via esbuild) — extension options pages run in a privileged context with direct `chrome.*` API access, no bundling required
- Settings applied via a separate `#ycr-entry-styles` `<style>` element to keep `PANEL_STYLES` constant intact and allow atomic style replacement
- `chrome.storage.onChanged` handler re-fetches full settings from storage to avoid partial-update inconsistency
- Background opacity uses `rgba(255,255,255,opacity)` to preserve white base while allowing transparency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all three settings are fully wired: font size and color apply to `.ycr-entry .ycr-text`, opacity applies to `#ycr-side-panel` background.

## Self-Check: PASSED

- `extension/options/options.html`: EXISTS
- `extension/options/options.css`: EXISTS
- `extension/options/options.js`: EXISTS
- `manifest.json` `options_page` field: EXISTS
- `sidepanel.js` `loadSettings()`: EXISTS
- `sidepanel.js` `_applySettings()`: EXISTS
- Build (npm run build): PASSED
- Lint (npm run lint): PASSED
- Commits 3b49c3a, 1f1b95a, 9111d14: VERIFIED

## Next Phase Readiness
- Options page accessible from Chrome's extension management UI (right-click extension icon > Options)
- Settings persist across browser sessions via chrome.storage.sync
- Side panel applies settings on creation and re-applies whenever the options page saves
- No blockers for Phase 4 (Exporting and Persistence)

---
*Phase: 03-settings-and-customization*
*Completed: 2026-03-31*
