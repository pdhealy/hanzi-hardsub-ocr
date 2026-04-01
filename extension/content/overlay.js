// SelectionOverlay module — YouTube Chinese Reader
// Implements draw mode, corner resize handles, box dragging, and coordinate conversion.

export class SelectionOverlay {
  constructor() {
    // Internal state
    this._videoEl = null;
    this._container = null;
    this._box = null;
    this._handles = {};
    this._selectionCSS = null; // {x, y, width, height} relative to overlay container
    this._drawMode = false;

    // Tracked document-level listeners for cleanup
    this._docListeners = [];

    // YouTube SPA navigation cleanup
    this._navHandler = () => this.destroy();
    document.addEventListener('yt-navigate-finish', this._navHandler);

    // Find or wait for the video element
    this._init();
  }

  // ------------------------------------------------------------------ init --

  _init() {
    const video = document.querySelector('#movie_player video');
    if (video) {
      this._videoEl = video;
      this._createContainer();
    } else {
      // Wait for the video element via MutationObserver
      const observer = new MutationObserver(() => {
        const v = document.querySelector('#movie_player video');
        if (v) {
          observer.disconnect();
          clearTimeout(timeout);
          this._videoEl = v;
          this._createContainer();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const timeout = setTimeout(() => {
        observer.disconnect();
        console.log('[YCR] Video element not found');
      }, 5000);
    }
  }

  _createContainer() {
    const container = document.createElement('div');
    container.id = 'ycr-overlay-container';
    document.body.appendChild(container);
    this._container = container;

    // Position the container over the video element using fixed coordinates.
    // This avoids dependence on #movie_player's positioning context and ensures
    // the drawable area is always constrained to the video element itself.
    const updatePosition = () => {
      const rect = this._videoEl.getBoundingClientRect();
      container.style.cssText = [
        'position: fixed',
        `top: ${rect.top}px`,
        `left: ${rect.left}px`,
        `width: ${rect.width}px`,
        `height: ${rect.height}px`,
        'z-index: 2147483646',
        'pointer-events: none',
      ].join('; ');
    };

    updatePosition();

    // Keep aligned when the video or window resizes
    this._resizeObserver = new ResizeObserver(updatePosition);
    this._resizeObserver.observe(this._videoEl);
    this._onWindowResize = updatePosition;
    window.addEventListener('resize', this._onWindowResize);

    // Create the selection box element (hidden until first draw)
    this._createBox();
  }

  _createBox() {
    const box = document.createElement('div');
    box.id = 'ycr-selection-box';
    box.style.cssText = [
      'position: absolute',
      'display: none',
      'box-sizing: border-box',
      'border: 2px solid rgba(255, 255, 255, 0.9)',
      'box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.6)',
      'background: rgba(37, 99, 235, 0.10)',
      'cursor: move',
      'pointer-events: auto',
    ].join('; ');

    // Create four corner handles
    const handleDefs = [
      { cls: 'ycr-handle-nw', style: 'top: -6px; left: -6px; cursor: nw-resize;' },
      { cls: 'ycr-handle-ne', style: 'top: -6px; right: -6px; cursor: ne-resize;' },
      { cls: 'ycr-handle-sw', style: 'bottom: -6px; left: -6px; cursor: sw-resize;' },
      { cls: 'ycr-handle-se', style: 'bottom: -6px; right: -6px; cursor: se-resize;' },
    ];

    handleDefs.forEach(({ cls, style }) => {
      const handle = document.createElement('div');
      handle.className = `ycr-handle ${cls}`;
      handle.style.cssText = [
        'position: absolute',
        'width: 12px',
        'height: 12px',
        'background: #FFFFFF',
        'border: 2px solid #2563EB',
        'box-shadow: 0 0 2px rgba(0,0,0,0.3)',
        'box-sizing: border-box',
        style,
      ].join('; ');
      box.appendChild(handle);
      this._handles[cls] = handle;
    });

    this._container.appendChild(box);
    this._box = box;

    // Wire handle resize listeners
    this._wireHandles();

    // Wire box-drag (move) listener
    this._wireBoxDrag();
  }

  // -------------------------------------------------------------- draw mode --

  activateDrawMode() {
    if (!this._container) {
      console.log('[YCR] Overlay container not ready yet');
      return;
    }
    this._drawMode = true;
    this._container.style.pointerEvents = 'auto';
    this._container.style.cursor = 'crosshair';

    // Hide any existing box while drawing a new one
    if (this._box) this._box.style.display = 'none';
    this._selectionCSS = null;

    const onMouseDown = (e) => {
      if (!this._drawMode) return;
      // Only react to left button on the container itself (not handles/box)
      if (e.button !== 0) return;
      if (e.target !== this._container) return;

      const containerRect = this._container.getBoundingClientRect();
      const startX = e.clientX - containerRect.left;
      const startY = e.clientY - containerRect.top;

      // Show box at start point with 0 size
      this._applyBoxRect(startX, startY, 0, 0);
      this._box.style.display = 'block';
      this._setHandlesVisible(false);

      const onMouseMove = (me) => {
        const curX = me.clientX - containerRect.left;
        const curY = me.clientY - containerRect.top;
        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const w = Math.abs(curX - startX);
        const h = Math.abs(curY - startY);
        this._applyBoxRect(left, top, w, h);
      };

      const onMouseUp = (me) => {
        this._removeDocListener('mousemove', onMouseMove);
        this._removeDocListener('mouseup', onMouseUp);

        const containerRect2 = this._container.getBoundingClientRect();
        const curX = me.clientX - containerRect2.left;
        const curY = me.clientY - containerRect2.top;
        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const w = Math.abs(curX - startX);
        const h = Math.abs(curY - startY);

        if (w < 20 || h < 20) {
          // Too small — discard
          this._box.style.display = 'none';
          this._selectionCSS = null;
        } else {
          this._applyBoxRect(left, top, w, h);
          this._selectionCSS = { x: left, y: top, width: w, height: h };
          this._setHandlesVisible(true);
        }

        // Deactivate draw mode
        this.deactivateDrawMode();
      };

      this._addDocListener('mousemove', onMouseMove);
      this._addDocListener('mouseup', onMouseUp);
    };

    this._container.addEventListener('mousedown', onMouseDown);
    // Store so we can remove on deactivate
    this._currentDrawHandler = onMouseDown;
  }

  deactivateDrawMode() {
    this._drawMode = false;
    if (this._container) {
      this._container.style.pointerEvents = 'none';
      this._container.style.cursor = 'default';
    }
    if (this._currentDrawHandler) {
      this._container.removeEventListener('mousedown', this._currentDrawHandler);
      this._currentDrawHandler = null;
    }
  }

  // ---------------------------------------------------------- handle resize --

  _wireHandles() {
    const MIN = 20;

    const wireHandle = (handleEl, corner) => {
      handleEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;

        // Enable pointer events on container so mousemove reaches document
        this._container.style.pointerEvents = 'auto';

        const containerRect = this._container.getBoundingClientRect();
        const { x, y, width, height } = this._selectionCSS;

        // Fixed corner coords (opposite of dragged corner)
        let fixedX, fixedY;
        if (corner === 'ycr-handle-nw') { fixedX = x + width; fixedY = y + height; }
        else if (corner === 'ycr-handle-ne') { fixedX = x; fixedY = y + height; }
        else if (corner === 'ycr-handle-sw') { fixedX = x + width; fixedY = y; }
        else { /* se */ fixedX = x; fixedY = y; }

        const onMouseMove = (me) => {
          const curX = me.clientX - containerRect.left;
          const curY = me.clientY - containerRect.top;
          const newLeft = Math.min(fixedX, curX);
          const newTop = Math.min(fixedY, curY);
          const newW = Math.max(MIN, Math.abs(curX - fixedX));
          const newH = Math.max(MIN, Math.abs(curY - fixedY));
          this._applyBoxRect(newLeft, newTop, newW, newH);
          this._selectionCSS = { x: newLeft, y: newTop, width: newW, height: newH };
        };

        const onMouseUp = () => {
          this._removeDocListener('mousemove', onMouseMove);
          this._removeDocListener('mouseup', onMouseUp);
          this._container.style.pointerEvents = 'none';
        };

        this._addDocListener('mousemove', onMouseMove);
        this._addDocListener('mouseup', onMouseUp);
      });
    };

    wireHandle(this._handles['ycr-handle-nw'], 'ycr-handle-nw');
    wireHandle(this._handles['ycr-handle-ne'], 'ycr-handle-ne');
    wireHandle(this._handles['ycr-handle-sw'], 'ycr-handle-sw');
    wireHandle(this._handles['ycr-handle-se'], 'ycr-handle-se');
  }

  // ---------------------------------------------------------- box drag/move --

  _wireBoxDrag() {
    this._box.addEventListener('mousedown', (e) => {
      // Ignore if clicking a handle
      if (e.target !== this._box) return;
      if (e.button !== 0) return;
      e.stopPropagation();

      this._container.style.pointerEvents = 'auto';

      const containerRect = this._container.getBoundingClientRect();
      const startMouseX = e.clientX - containerRect.left;
      const startMouseY = e.clientY - containerRect.top;
      const startBoxX = this._selectionCSS.x;
      const startBoxY = this._selectionCSS.y;
      const containerW = this._container.offsetWidth;
      const containerH = this._container.offsetHeight;

      this._box.style.cursor = 'move';

      const onMouseMove = (me) => {
        const dx = (me.clientX - containerRect.left) - startMouseX;
        const dy = (me.clientY - containerRect.top) - startMouseY;
        const newX = Math.max(0, Math.min(startBoxX + dx, containerW - this._selectionCSS.width));
        const newY = Math.max(0, Math.min(startBoxY + dy, containerH - this._selectionCSS.height));
        this._selectionCSS = { ...this._selectionCSS, x: newX, y: newY };
        this._applyBoxRect(newX, newY, this._selectionCSS.width, this._selectionCSS.height);
      };

      const onMouseUp = () => {
        this._removeDocListener('mousemove', onMouseMove);
        this._removeDocListener('mouseup', onMouseUp);
        this._container.style.pointerEvents = 'none';
      };

      this._addDocListener('mousemove', onMouseMove);
      this._addDocListener('mouseup', onMouseUp);
    });
  }

  // ------------------------------------------------- DOM / style helpers ----

  _applyBoxRect(x, y, w, h) {
    this._box.style.left = `${x}px`;
    this._box.style.top = `${y}px`;
    this._box.style.width = `${w}px`;
    this._box.style.height = `${h}px`;
  }

  _setHandlesVisible(visible) {
    Object.values(this._handles).forEach((h) => {
      h.style.display = visible ? 'block' : 'none';
    });
  }

  // --------------------------------------------------- event tracking -------

  _addDocListener(type, fn) {
    document.addEventListener(type, fn);
    this._docListeners.push({ type, fn });
  }

  _removeDocListener(type, fn) {
    document.removeEventListener(type, fn);
    this._docListeners = this._docListeners.filter((l) => !(l.type === type && l.fn === fn));
  }

  // -------------------------------------------------- public API ------------

  /**
   * Returns the selection rect in CSS pixels relative to the overlay container,
   * or null if no selection has been made.
   * @returns {{x: number, y: number, width: number, height: number}|null}
   */
  getSelectionRect() {
    return this._selectionCSS ? { ...this._selectionCSS } : null;
  }

  /**
   * Returns the selection rect in video intrinsic pixels (for canvas/OCR capture).
   * Uses the video element's displayed size vs its natural size for scaling.
   * @returns {{x: number, y: number, width: number, height: number}|null}
   */
  getVideoIntrinsicRect() {
    if (!this._selectionCSS || !this._videoEl) return null;

    const rect = this._videoEl.getBoundingClientRect();
    const scaleX = this._videoEl.videoWidth / rect.width;
    const scaleY = this._videoEl.videoHeight / rect.height;

    return {
      x: this._selectionCSS.x * scaleX,
      y: this._selectionCSS.y * scaleY,
      width: this._selectionCSS.width * scaleX,
      height: this._selectionCSS.height * scaleY,
    };
  }

  /**
   * Returns true if a selection has been drawn.
   * @returns {boolean}
   */
  hasSelection() {
    return this._selectionCSS !== null;
  }

  /**
   * Removes all DOM elements and event listeners. Called on SPA navigation.
   */
  destroy() {
    // Remove all document-level listeners
    this._docListeners.forEach(({ type, fn }) => {
      document.removeEventListener(type, fn);
    });
    this._docListeners = [];

    // Remove draw mode listener if active
    if (this._currentDrawHandler && this._container) {
      this._container.removeEventListener('mousedown', this._currentDrawHandler);
      this._currentDrawHandler = null;
    }

    // Remove navigation listener
    document.removeEventListener('yt-navigate-finish', this._navHandler);

    // Stop resize tracking
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._onWindowResize) {
      window.removeEventListener('resize', this._onWindowResize);
      this._onWindowResize = null;
    }

    // Remove overlay container from DOM
    if (this._container && this._container.parentElement) {
      this._container.parentElement.removeChild(this._container);
    }

    this._container = null;
    this._box = null;
    this._handles = {};
    this._videoEl = null;
    this._selectionCSS = null;
    this._drawMode = false;
  }
}
