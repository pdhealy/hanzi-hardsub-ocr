# Roadmap

## Phase 1: Core OCR and Display

- **Objective:** Establish the basic functionality of the extension.
- **Goal:** Be able to manually trigger OCR on a static video frame and see the text output.
- **Plans:** 2/4 plans executed

Plans:
- [x] 01-01-PLAN.md — Project scaffold, build toolchain, tesseract.js bundling, popup UI
- [x] 01-02-PLAN.md — Selection box overlay with draw, resize, and coordinate tracking
- [ ] 01-03-PLAN.md — Injected side panel with display states and resize
- [ ] 01-04-PLAN.md — OCR capture pipeline and full wiring (popup -> overlay -> OCR -> side panel)

**Requirements:**
- REQ-OCR-ENGINE: tesseract.js integration for Chinese OCR
- REQ-AREA: Subtitle area selection (draw box, corner resize)
- REQ-TOGGLE: Toggle/activate recognition (manual trigger)
- REQ-DISPLAY: Display recognized text in side panel
- REQ-FEEDBACK: Clear visual feedback (status indicator, loading states)

## Phase 2: Real-time Synchronization and UI

- **Objective:** Make the subtitle display dynamic and user-friendly.
- **Tasks:**
  - Implement a loop to continuously capture video frames and run OCR to create a real-time experience.
  - Associate the recognized text with the current timestamp of the YouTube video.
  - Enhance the side panel to be collapsible.
  - Structure the display to show a list of subtitles with their timestamps.
- **Goal:** Have a functional, real-time feed of subtitles in the side panel that keeps up with the video.

## Phase 3: Settings and Customization

- **Objective:** Allow users to personalize their viewing experience.
- **Tasks:**
  - Create the extension's settings page.
  - Add controls on the settings page for adjusting:
    - Font size
    - Font color
    - Background opacity
  - Apply the user's chosen settings to the displayed subtitles in the side panel.
- **Goal:** Enable users to customize the look and feel of the recognized subtitles.

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
