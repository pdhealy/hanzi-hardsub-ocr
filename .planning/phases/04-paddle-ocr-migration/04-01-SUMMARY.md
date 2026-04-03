---
phase: 04-paddle-ocr-migration
plan: 01
subsystem: extension-ocr
tags: [paddle-ocr, ocr, offscreen, opencc, onnxruntime, opencv]
dependency_graph:
  requires: []
  provides: [paddleocr-offscreen, model-caching, opencc-conversion, ort-wasm-runtime]
  affects: [extension/background/offscreen-ocr.js, extension/background/service-worker.js, extension/manifest.json]
tech_stack:
  added: [ppu-paddle-ocr@4.1.1, opencc-js, onnxruntime-web@1.24.3, @techstark/opencv-js]
  patterns: [singleton-init, cache-storage, wasm-external-load, esbuild-bundle]
key_files:
  created:
    - extension/background/offscreen-ocr.bundle.js
    - extension/libs/opencv/opencv.js
    - extension/libs/ort/ort-wasm-simd-threaded.wasm
    - extension/libs/ort/ort-wasm-simd-threaded.mjs
  modified:
    - extension/background/offscreen-ocr.js
    - extension/background/offscreen-ocr.html
    - extension/background/service-worker.js
    - extension/manifest.json
    - esbuild.config.js
    - package.json
  deleted:
    - extension/libs/tesseract/ (tesseract.min.js, worker.min.js)
    - extension/libs/tesseract-core/ (all WASM/JS files)
    - extension/tessdata/ (chi_sim.traineddata.gz, chi_tra.traineddata.gz)
decisions:
  - "onnxruntime-web v1.24.3 ships threaded WASM only; copy ort-wasm-simd-threaded.wasm/.mjs instead of plan's non-threaded filenames"
  - "manifest web_accessible_resources uses libs/ort/* and libs/opencv/* globs to cover both WASM and .mjs files"
metrics:
  duration: 2 min
  completed_date: "2026-04-03"
  tasks: 8
  files: 10
---

# Phase 4 Plan 1: PaddleOCR Migration Summary

Replaced Tesseract.js OCR pipeline with PaddleOCR (ppu-paddle-ocr/web) using PP-OCRv4 Chinese ONNX models, OpenCC Simplified-to-Traditional conversion, and Cache Storage model caching in the Chrome Extension's offscreen document.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 0 | Pre-implementation snapshot | ca7de6e | (all modified files) |
| 1 | Install npm deps (ppu-paddle-ocr, opencc-js, onnxruntime-web) | ba2c9b0 | package.json, package-lock.json |
| 2 | Rewrite esbuild.config.js (offscreen bundle + asset copy) | ba2c9b0 | esbuild.config.js |
| 3 | Rewrite offscreen-ocr.js (PaddleOCR engine) | ba2c9b0 | extension/background/offscreen-ocr.js |
| 4 | Update offscreen-ocr.html (opencv.js before bundle) | ba2c9b0 | extension/background/offscreen-ocr.html |
| 5 | Update service-worker.js (pre-warm on install) | ba2c9b0 | extension/background/service-worker.js |
| 6 | Update manifest.json (remove Tesseract, add unpkg.com) | ba2c9b0 | extension/manifest.json |
| 7 | Delete Tesseract files | ba2c9b0 | (30+ files removed) |
| 8 | Run build — verified offscreen-ocr.bundle.js (2.6MB) | ba2c9b0 | extension/background/offscreen-ocr.bundle.js |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] onnxruntime-web v1.24.3 WASM filenames differ from plan**
- **Found during:** Step 8 (build) — first run failed with `ENOENT: ort-wasm-simd.wasm`
- **Issue:** The plan assumed `ort-wasm-simd.wasm` and `ort-wasm.wasm` exist in node_modules. onnxruntime-web v1.24.x removed non-threaded variants and only ships `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.mjs`
- **Fix:** Updated `esbuild.config.js` copyFile targets to `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.mjs`. Updated manifest `web_accessible_resources` to `libs/ort/*` glob (already was a glob, no change needed) and `libs/opencv/*` glob to cover the .mjs file
- **Files modified:** `esbuild.config.js`, `extension/manifest.json`
- **Commit:** ba2c9b0

## Decisions Made

1. **ort-wasm-simd-threaded.* instead of ort-wasm-simd.*** — onnxruntime-web v1.24.3 only ships threaded WASM. The threaded variant works with the 'wasm' execution provider in Chrome extension offscreen documents which support SharedArrayBuffer/Workers.

2. **manifest web_accessible_resources uses `libs/opencv/*`** — expanded from `libs/opencv/opencv.js` to cover any future opencv assets in that directory.

## Known Stubs

None — all data paths are wired. The offscreen document downloads real ONNX models from unpkg.com on first use and caches them in Cache Storage. The OCR pipeline flows: imageDataUrl → canvas → PaddleOCR.recognize() → OpenCC.toTraditional() → sendResponse.

## Self-Check: PASSED

All 9 artifact files confirmed present. All 3 Tesseract directories confirmed deleted. Commits ca7de6e (snapshot) and ba2c9b0 (migration) confirmed in git log.
