# Roadmap

## Phase 1: Core OCR and Display

- **Objective:** Establish the basic functionality of the extension.
- **Goal:** Be able to manually trigger OCR on a static video frame and see the text output.
- **Plans:** 4/4 plans complete

Plans:
- [x] 01-01-PLAN.md — Project scaffold, build toolchain, tesseract.js bundling, popup UI
- [x] 01-02-PLAN.md — Selection box overlay with draw, resize, and coordinate tracking
- [x] 01-03-PLAN.md — Injected side panel with display states and resize
- [x] 01-04-PLAN.md — OCR capture pipeline and full wiring (popup -> overlay -> OCR -> side panel)

**Requirements:**
- REQ-OCR-ENGINE: tesseract.js integration for Chinese OCR
- REQ-AREA: Subtitle area selection (draw box, corner resize)
- REQ-TOGGLE: Toggle/activate recognition (manual trigger)
- REQ-DISPLAY: Display recognized text in side panel
- REQ-FEEDBACK: Clear visual feedback (status indicator, loading states)

## Phase 2: Real-time Synchronization and UI

- **Objective:** Make the subtitle display dynamic and user-friendly.
- **Goal:** Have a functional, real-time feed of subtitles in the side panel that keeps up with the video.
- **Plans:** 2/2 plans complete

Plans:
- [x] 02-01-PLAN.md — Side panel: append-only entry list, floating collapse tab, in-panel toggle button
- [x] 02-02-PLAN.md — Live OCR loop in content.js, popup Start/Stop toggle with state sync

**Requirements:**
- REQ-REALTIME: Continuous OCR loop at 1-second interval
- REQ-COLLAPSIBLE: Panel collapses to floating tab, re-expands on click
- REQ-TIMESTAMPS: Each entry shows video timestamp
- REQ-DEDUP: Consecutive identical results suppressed
- REQ-TOGGLE: Start/Stop toggle in popup and side panel, synced
- REQ-DISPLAY: Append-only running log of timestamped entries

## Phase 3: Settings and Customization

- **Objective:** Allow users to personalize their viewing experience.
- **Plans:** 2/2 plans complete

Plans:
- [x] 03-01-PLAN.md — Settings options page (font size, font color, bg opacity) with chrome.storage.sync persistence and live SidePanel wiring
- [x] 03-02-PLAN.md — Gear icon in SidePanel header, public applySettings() method, chrome.storage.onChanged listener in content.js for real-time settings feedback loop

**Requirements:**
- REQ-SETTINGS-FONT: Font size and color controls in options page
- REQ-SETTINGS-OPACITY: Panel background opacity control in options page
- REQ-SETTINGS-PERSIST: Settings persisted via chrome.storage.sync and applied to SidePanel
- REQ-SETTINGS-APPLY: applySettings() method on SidePanel wired from content.js storage listener
- REQ-SETTINGS-REALTIME: Real-time settings feedback loop via chrome.storage.onChanged

## Phase 4: Exporting and Persistence

- **Objective:** Add data export and improve usability.
- **Tasks:**
  - Implement the "Export to .txt" functionality, which compiles all recognized subtitles and their timestamps into a downloadable text file.
  - Implement a mechanism (e.g., using `chrome.storage`) to save and retrieve the position and size of the selection box for each unique YouTube video URL.
- **Goal:** Allow users to save their work and persist their settings across sessions.

## Phase 5: Refinement and Testing

- **Objective:** Ensure the extension is robust, performant, and reliable.
- **Tasks:**
  - Conduct thorough testing across a wide range of YouTube videos with different layouts and subtitle styles.
  - Address any bugs or performance bottlenecks.
  - Refine the overall user interface and user experience based on testing.
  - Prepare the extension for potential publication.
- **Goal:** A polished and stable extension ready for users.
