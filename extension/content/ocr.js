/* global Tesseract */
// OCR module — YouTube Chinese Reader
// Handles tesseract.js initialization with local extension paths and video frame capture.

export class OCREngine {
  constructor() {
    this.worker = null;
    this.initialized = false;
  }

  /**
   * Initializes the tesseract.js worker with locally bundled files.
   * Uses chrome.runtime.getURL to construct extension-internal resource paths.
   * Must be called before recognize(), though recognize() will auto-call it.
   */
  async initialize() {
    if (this.worker) return;

    const workerPath = chrome.runtime.getURL('libs/tesseract/worker.min.js');
    const corePath = chrome.runtime.getURL('libs/tesseract-core/');
    const langPath = chrome.runtime.getURL('tessdata/');

    this.worker = await Tesseract.createWorker('chi_sim', 1, {
      workerPath,
      corePath,
      langPath,
      // workerBlobURL defaults to true: Tesseract fetches the worker script from
      // the chrome-extension:// URL (content scripts can do this), then constructs
      // a blob: Worker from the fetched content. Direct new Worker(chrome-extension://)
      // is blocked by Chrome even for web_accessible_resources entries — only the
      // blob: approach works from a web page origin context.
      gzip: false,            // traineddata is pre-decompressed in extension bundle
      logger: m => console.log('[YCR:Tesseract]', m.status, Math.round((m.progress || 0) * 100) + '%'),
    });

    this.initialized = true;
  }

  /**
   * Captures a region of the video element and runs OCR on it.
   * @param {HTMLVideoElement} videoEl - The YouTube video element
   * @param {{x: number, y: number, width: number, height: number}} intrinsicRect - Region in video intrinsic pixels
   * @returns {Promise<{text: string, confidence: number}>}
   */
  async recognize(videoEl, intrinsicRect) {
    if (!this.worker) {
      await this.initialize();
    }

    // Create an offscreen canvas sized to the selected region
    const canvas = document.createElement('canvas');
    canvas.width = intrinsicRect.width;
    canvas.height = intrinsicRect.height;
    const ctx = canvas.getContext('2d');

    // Draw only the selected sub-region of the video frame into the canvas.
    // Source coordinates are in video intrinsic pixel space (not CSS pixels).
    ctx.drawImage(
      videoEl,
      intrinsicRect.x, intrinsicRect.y,
      intrinsicRect.width, intrinsicRect.height,
      0, 0,
      intrinsicRect.width, intrinsicRect.height
    );

    const dataURL = canvas.toDataURL('image/png');

    // Run OCR — request only 'text' output format (other formats are disabled by default in v7)
    const result = await this.worker.recognize(dataURL, {}, { text: true });

    return {
      text: (result.data.text || '').trim(),
      confidence: result.data.confidence || 0,
    };
  }

  /**
   * Terminates the tesseract.js worker and frees its resources.
   */
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
  }

  /**
   * Returns true if the worker has been initialized.
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }
}
