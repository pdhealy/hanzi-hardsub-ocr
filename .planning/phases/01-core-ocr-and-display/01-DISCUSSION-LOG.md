# Phase 1: Core OCR and Display - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the Q&A.

**Date:** 2026-03-30
**Phase:** 01-core-ocr-and-display
**Mode:** discuss
**Areas discussed:** Selection box behavior, OCR trigger & feedback, Side panel implementation

---

## Areas Selected

User selected 3 of 4 gray areas:
- ✓ Selection box behavior
- ✓ OCR trigger & feedback
- ✓ Side panel implementation
- ✗ Extension architecture (skipped — Claude defaults to MV3)

---

## Selection Box Behavior

| Question | Options Presented | User Selected |
|----------|------------------|---------------|
| How does the user create the selection box? | Click-drag / Default box / You decide | Click-drag to draw |
| How should handles work? | 8-handle / 4-corner / You decide | 4-corner handles only |
| Should box persist visually? | Always visible / Hidden after set / You decide | Always visible overlay |
| How does user activate drawing mode? | Extension popup button / Injected page button / You decide | Button in extension popup |
| Visual style? | Semi-transparent blue/white / Dashed border / You decide | Semi-transparent blue/white border with corner handles |

No corrections or scope redirects in this area.

---

## OCR Trigger & Feedback

| Question | Options Presented | User Selected |
|----------|------------------|---------------|
| How does user trigger OCR? | Popup button / Page button / You decide | *Scope redirect — see below* |
| Feedback while OCR runs? | Side panel spinner / Button disabled state / You decide | Loading spinner in side panel |
| If no text found? | Show "No text recognized" / Silent / You decide | Show "No text recognized" |

**Scope redirect:** User answered the trigger question with "OCR must trigger every time the subtitle text changes, or every 1 second, whichever is more feasible and best-practice." This is real-time behavior from Phase 2 scope. Redirected: "That's Phase 2 — deferred. Phase 1 will use a manual button trigger." User acknowledged.

---

## Side Panel Implementation

| Question | Options Presented | User Selected |
|----------|------------------|---------------|
| Implementation approach? | Injected div / Chrome Side Panel API / You decide | Injected div (content script) |
| Where should panel appear? | Right side of page / Floating overlay / You decide | Right side of YouTube page |
| Minimal chrome (header/close)? | Header + close button / Raw text only / You decide | Header with title + close/hide button |
| Resize or push layout? | Overlay on top / Push content left / You decide | Overlay on top |
| Panel width? | Fixed ~300px / User-resizable / You decide | Fixed width (~300px) |

**Correction after summary:** User overrode the "fixed width" selection with free-text: "I want the side-panel to be resizable by the user instead of fixed width." Decision updated to user-resizable with drag handle, default ~300px.

---

## No Corrections Requested

All other selections were first-choice (recommended) options. One scope redirect and one post-summary correction (see above).
