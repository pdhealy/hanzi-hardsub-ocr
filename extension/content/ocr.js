// OCR module — YouTube Chinese Reader
// Captures a selected video frame and delegates OCR to background service worker.

export class OCREngine {
  constructor() {
    this.initialized = true;
  }

  /**
   * Captures a region of the video element and runs OCR on it.
   * @param {HTMLVideoElement} videoEl - The YouTube video element
   * @param {{x: number, y: number, width: number, height: number}} intrinsicRect - Region in video intrinsic pixels
   * @returns {Promise<{text: string, confidence: number}>}
   */
  async recognize(videoEl, intrinsicRect) {

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

    const response = await chrome.runtime.sendMessage({
      action: 'OCR_RECOGNIZE_IMAGE',
      imageDataUrl: dataURL,
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : 'Background OCR failed');
    }

    return { text: response.text || '', confidence: response.confidence || 0 };
  }

  /**
   * Terminates the tesseract.js worker and frees its resources.
   */
  async terminate() {
    this.initialized = true;
  }

  /**
   * Returns true if the worker has been initialized.
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }
}
