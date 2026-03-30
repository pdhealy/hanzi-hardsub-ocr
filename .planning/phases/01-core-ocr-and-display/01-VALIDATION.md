---
phase: 1
slug: core-ocr-and-display
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — Wave 0 installs (Chrome extension: no test runner yet) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npm run lint` |
| **Full suite command** | `npm run build && npm run lint` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run lint`
- **After every plan wave:** Run `npm run build && npm run lint`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | manifest setup | build | `npm run build` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | content script | build | `npm run build` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | tesseract.js bundle | build | `npm run build` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | selection overlay | manual | see manual table | n/a | ⬜ pending |
| 1-04-01 | 04 | 2 | canvas capture + OCR | manual | see manual table | n/a | ⬜ pending |
| 1-05-01 | 05 | 2 | side panel display | manual | see manual table | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — with build script (webpack or esbuild config)
- [ ] `webpack.config.js` or `esbuild.config.js` — bundler configuration
- [ ] `.eslintrc.json` — lint config for JS/plain-HTML extension

*Wave 0 establishes the build toolchain. All subsequent tasks depend on `npm run build` succeeding.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Selection box renders over YouTube player | CONTEXT D-02/D-03 | Requires live browser + YouTube page | Load extension, open YouTube video, click "Draw Subtitle Area", drag over video, verify semi-transparent blue/white box appears |
| Corner handles allow resize | CONTEXT D-04 | Requires mouse interaction | Drag each of the 4 corners, verify box resizes correctly |
| Canvas OCR captures correct region | CONTEXT D-07 | Requires live video frame + tesseract.js | Draw box over subtitled area, click "Recognize Text", verify output matches visible text |
| Side panel renders on right side | CONTEXT D-10/D-11 | Requires browser layout inspection | Verify panel injects at right edge, overlays page, has header with title and close button |
| Side panel is resizable | CONTEXT D-13 | Requires mouse drag | Drag left edge of panel, verify width changes |
| "No text recognized" shows on empty result | CONTEXT D-09 | Requires live OCR result | Draw box over non-text area, trigger OCR, verify message appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
