(() => {
  // extension/content/overlay.js
  var SelectionOverlay = class {
    constructor() {
      this._videoEl = null;
      this._container = null;
      this._box = null;
      this._handles = {};
      this._selectionCSS = null;
      this._drawMode = false;
      this._docListeners = [];
      this._navHandler = () => this.destroy();
      document.addEventListener("yt-navigate-finish", this._navHandler);
      this._init();
    }
    // ------------------------------------------------------------------ init --
    _init() {
      const video = document.querySelector("#movie_player video");
      if (video) {
        this._videoEl = video;
        this._createContainer();
      } else {
        const observer = new MutationObserver(() => {
          const v = document.querySelector("#movie_player video");
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
          console.log("[YCR] Video element not found");
        }, 5e3);
      }
    }
    _createContainer() {
      const container = document.createElement("div");
      container.id = "ycr-overlay-container";
      document.body.appendChild(container);
      this._container = container;
      container.style.position = "fixed";
      container.style.zIndex = "2147483646";
      container.style.pointerEvents = "none";
      const updatePosition = () => {
        const rect = this._videoEl.getBoundingClientRect();
        container.style.top = `${rect.top}px`;
        container.style.left = `${rect.left}px`;
        container.style.width = `${rect.width}px`;
        container.style.height = `${rect.height}px`;
      };
      updatePosition();
      this._resizeObserver = new ResizeObserver(updatePosition);
      this._resizeObserver.observe(this._videoEl);
      this._onWindowResize = updatePosition;
      window.addEventListener("resize", this._onWindowResize);
      this._createBox();
    }
    _createBox() {
      const box = document.createElement("div");
      box.id = "ycr-selection-box";
      box.style.cssText = [
        "position: absolute",
        "display: none",
        "box-sizing: border-box",
        "border: 2px solid rgba(255, 255, 255, 0.9)",
        "box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.6)",
        "background: rgba(37, 99, 235, 0.10)",
        "cursor: move",
        "pointer-events: auto"
      ].join("; ");
      const handleDefs = [
        { cls: "ycr-handle-nw", style: "top: -6px; left: -6px; cursor: nw-resize;" },
        { cls: "ycr-handle-ne", style: "top: -6px; right: -6px; cursor: ne-resize;" },
        { cls: "ycr-handle-sw", style: "bottom: -6px; left: -6px; cursor: sw-resize;" },
        { cls: "ycr-handle-se", style: "bottom: -6px; right: -6px; cursor: se-resize;" }
      ];
      handleDefs.forEach(({ cls, style }) => {
        const handle = document.createElement("div");
        handle.className = `ycr-handle ${cls}`;
        handle.style.cssText = [
          "position: absolute",
          "width: 12px",
          "height: 12px",
          "background: #FFFFFF",
          "border: 2px solid #2563EB",
          "box-shadow: 0 0 2px rgba(0,0,0,0.3)",
          "box-sizing: border-box",
          style
        ].join("; ");
        box.appendChild(handle);
        this._handles[cls] = handle;
      });
      this._container.appendChild(box);
      this._box = box;
      this._wireHandles();
      this._wireBoxDrag();
    }
    // -------------------------------------------------------------- draw mode --
    activateDrawMode() {
      if (!this._container) {
        console.log("[YCR] Overlay container not ready yet");
        return;
      }
      this._drawMode = true;
      this._container.style.pointerEvents = "auto";
      this._container.style.cursor = "crosshair";
      if (this._box) this._box.style.display = "none";
      this._selectionCSS = null;
      const onMouseDown = (e) => {
        if (!this._drawMode) return;
        if (e.button !== 0) return;
        if (e.target !== this._container) return;
        const containerRect = this._container.getBoundingClientRect();
        const startX = e.clientX - containerRect.left;
        const startY = e.clientY - containerRect.top;
        this._applyBoxRect(startX, startY, 0, 0);
        this._box.style.display = "block";
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
          this._removeDocListener("mousemove", onMouseMove);
          this._removeDocListener("mouseup", onMouseUp);
          const containerRect2 = this._container.getBoundingClientRect();
          const curX = me.clientX - containerRect2.left;
          const curY = me.clientY - containerRect2.top;
          const left = Math.min(startX, curX);
          const top = Math.min(startY, curY);
          const w = Math.abs(curX - startX);
          const h = Math.abs(curY - startY);
          if (w < 20 || h < 20) {
            this._box.style.display = "none";
            this._selectionCSS = null;
          } else {
            this._applyBoxRect(left, top, w, h);
            this._selectionCSS = { x: left, y: top, width: w, height: h };
            this._setHandlesVisible(true);
          }
          this.deactivateDrawMode();
        };
        this._addDocListener("mousemove", onMouseMove);
        this._addDocListener("mouseup", onMouseUp);
      };
      this._container.addEventListener("mousedown", onMouseDown);
      this._currentDrawHandler = onMouseDown;
    }
    deactivateDrawMode() {
      this._drawMode = false;
      if (this._container) {
        this._container.style.pointerEvents = "none";
        this._container.style.cursor = "default";
      }
      if (this._currentDrawHandler) {
        this._container.removeEventListener("mousedown", this._currentDrawHandler);
        this._currentDrawHandler = null;
      }
    }
    // ---------------------------------------------------------- handle resize --
    _wireHandles() {
      const MIN = 20;
      const wireHandle = (handleEl, corner) => {
        handleEl.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          this._container.style.pointerEvents = "auto";
          const containerRect = this._container.getBoundingClientRect();
          const { x, y, width, height } = this._selectionCSS;
          let fixedX, fixedY;
          if (corner === "ycr-handle-nw") {
            fixedX = x + width;
            fixedY = y + height;
          } else if (corner === "ycr-handle-ne") {
            fixedX = x;
            fixedY = y + height;
          } else if (corner === "ycr-handle-sw") {
            fixedX = x + width;
            fixedY = y;
          } else {
            fixedX = x;
            fixedY = y;
          }
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
            this._removeDocListener("mousemove", onMouseMove);
            this._removeDocListener("mouseup", onMouseUp);
            this._container.style.pointerEvents = "none";
          };
          this._addDocListener("mousemove", onMouseMove);
          this._addDocListener("mouseup", onMouseUp);
        });
      };
      wireHandle(this._handles["ycr-handle-nw"], "ycr-handle-nw");
      wireHandle(this._handles["ycr-handle-ne"], "ycr-handle-ne");
      wireHandle(this._handles["ycr-handle-sw"], "ycr-handle-sw");
      wireHandle(this._handles["ycr-handle-se"], "ycr-handle-se");
    }
    // ---------------------------------------------------------- box drag/move --
    _wireBoxDrag() {
      this._box.addEventListener("mousedown", (e) => {
        if (e.target !== this._box) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        this._container.style.pointerEvents = "auto";
        const containerRect = this._container.getBoundingClientRect();
        const startMouseX = e.clientX - containerRect.left;
        const startMouseY = e.clientY - containerRect.top;
        const startBoxX = this._selectionCSS.x;
        const startBoxY = this._selectionCSS.y;
        const containerW = this._container.offsetWidth;
        const containerH = this._container.offsetHeight;
        this._box.style.cursor = "move";
        const onMouseMove = (me) => {
          const dx = me.clientX - containerRect.left - startMouseX;
          const dy = me.clientY - containerRect.top - startMouseY;
          const newX = Math.max(0, Math.min(startBoxX + dx, containerW - this._selectionCSS.width));
          const newY = Math.max(0, Math.min(startBoxY + dy, containerH - this._selectionCSS.height));
          this._selectionCSS = { ...this._selectionCSS, x: newX, y: newY };
          this._applyBoxRect(newX, newY, this._selectionCSS.width, this._selectionCSS.height);
        };
        const onMouseUp = () => {
          this._removeDocListener("mousemove", onMouseMove);
          this._removeDocListener("mouseup", onMouseUp);
          this._container.style.pointerEvents = "none";
        };
        this._addDocListener("mousemove", onMouseMove);
        this._addDocListener("mouseup", onMouseUp);
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
        h.style.display = visible ? "block" : "none";
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
        height: this._selectionCSS.height * scaleY
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
      this._docListeners.forEach(({ type, fn }) => {
        document.removeEventListener(type, fn);
      });
      this._docListeners = [];
      if (this._currentDrawHandler && this._container) {
        this._container.removeEventListener("mousedown", this._currentDrawHandler);
        this._currentDrawHandler = null;
      }
      document.removeEventListener("yt-navigate-finish", this._navHandler);
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._onWindowResize) {
        window.removeEventListener("resize", this._onWindowResize);
        this._onWindowResize = null;
      }
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
  };

  // extension/content/sidepanel.js
  var PANEL_STYLES = `
#ycr-side-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: 300px;
  z-index: 9999;
  background: #FFFFFF;
  border-left: 1px solid #E5E7EB;
  display: none;
  flex-direction: column;
  font-family: system-ui, -apple-system, sans-serif;
}

#ycr-side-panel.ycr-visible {
  display: flex;
}

#ycr-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  z-index: 1;
}

#ycr-resize-handle:hover {
  background: #E5E7EB;
}

#ycr-panel-header {
  height: 40px;
  min-height: 40px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: #F3F4F6;
  border-bottom: 1px solid #E5E7EB;
}

#ycr-panel-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  color: #111827;
}

#ycr-panel-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: #6B7280;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

#ycr-panel-close:hover {
  background: #E5E7EB;
}

#ycr-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.ycr-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.ycr-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #E5E7EB;
  border-top: 2px solid #2563EB;
  border-radius: 50%;
  animation: ycr-spin 0.8s linear infinite;
  margin-bottom: 12px;
}

@keyframes ycr-spin {
  to { transform: rotate(360deg); }
}

.ycr-state-heading {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
  color: #6B7280;
}

.ycr-state-body {
  font-size: 13px;
  color: #6B7280;
  margin-top: 8px;
}

.ycr-ocr-output {
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  color: #111827;
  white-space: pre-wrap;
  word-break: break-word;
}

#ycr-loop-controls {
  padding: 0 0 12px 0;
  border-bottom: 1px solid #E5E7EB;
  margin-bottom: 12px;
}

.ycr-toggle-btn {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  background: #FFFFFF;
  color: #374151;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: system-ui, -apple-system, sans-serif;
}

.ycr-toggle-btn:hover {
  background: #F9FAFB;
}

.ycr-toggle-btn.ycr-toggle-active {
  background: #EF4444;
  color: #FFFFFF;
  border-color: #EF4444;
}

.ycr-toggle-btn.ycr-toggle-active:hover {
  background: #DC2626;
}

#ycr-entry-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ycr-entry {
  font-size: 14px;
  line-height: 1.5;
  color: #111827;
  word-break: break-word;
}

.ycr-ts {
  color: #6B7280;
  font-size: 12px;
  font-family: monospace;
  margin-right: 6px;
}

.ycr-text {
  white-space: pre-wrap;
}

#ycr-collapse-tab {
  position: fixed;
  right: 0;
  top: 25%;
  transform: translateY(-50%);
  width: 40px;
  height: 120px;
  background: #2563EB;
  color: #FFFFFF;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.05em;
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px 0 0 6px;
  z-index: 9999;
  font-family: system-ui, -apple-system, sans-serif;
  user-select: none;
}

#ycr-collapse-tab.ycr-tab-visible {
  display: flex;
}

#ycr-panel-collapse {
  margin-left: auto;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: #6B7280;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

#ycr-panel-collapse:hover {
  background: #E5E7EB;
}

#ycr-panel-settings {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: #6B7280;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

#ycr-panel-settings:hover {
  background: #E5E7EB;
}

#ycr-panel-settings:focus {
  outline: 2px solid #2563EB;
  outline-offset: 2px;
}
`;
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var DEFAULT_SETTINGS = {
    ycrFontSize: 14,
    ycrFontColor: "#111827",
    ycrBgOpacity: 1
  };
  var SidePanel = class {
    constructor() {
      this._panel = null;
      this._styleEl = null;
      this._entryStyleEl = null;
      this._onNavigate = null;
      this._listEl = null;
      this._collapsed = false;
      this._tab = null;
      this._onToggle = null;
      this._onStorageChange = null;
      this._init();
    }
    _init() {
      this._styleEl = document.createElement("style");
      this._styleEl.id = "ycr-panel-styles";
      this._styleEl.textContent = PANEL_STYLES;
      document.head.appendChild(this._styleEl);
      const panel = document.createElement("div");
      panel.id = "ycr-side-panel";
      const handle = document.createElement("div");
      handle.id = "ycr-resize-handle";
      panel.appendChild(handle);
      const header = document.createElement("div");
      header.id = "ycr-panel-header";
      const title = document.createElement("span");
      title.id = "ycr-panel-title";
      title.textContent = "YouTube Chinese Reader";
      const collapseBtn = document.createElement("button");
      collapseBtn.id = "ycr-panel-collapse";
      collapseBtn.setAttribute("aria-label", "Collapse Panel");
      collapseBtn.textContent = "\u2013";
      collapseBtn.addEventListener("click", () => this.collapse());
      const settingsBtn = document.createElement("button");
      settingsBtn.id = "ycr-panel-settings";
      settingsBtn.setAttribute("aria-label", "Open Settings");
      settingsBtn.textContent = "\u2699";
      settingsBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "OPEN_SETTINGS" });
      });
      const closeBtn = document.createElement("button");
      closeBtn.id = "ycr-panel-close";
      closeBtn.setAttribute("aria-label", "Hide Panel");
      closeBtn.textContent = "x";
      closeBtn.addEventListener("click", () => this.hide());
      header.appendChild(title);
      header.appendChild(collapseBtn);
      header.appendChild(settingsBtn);
      header.appendChild(closeBtn);
      const content = document.createElement("div");
      content.id = "ycr-panel-content";
      content.setAttribute("aria-live", "polite");
      panel.appendChild(header);
      panel.appendChild(content);
      const tab = document.createElement("div");
      tab.id = "ycr-collapse-tab";
      tab.textContent = "YCR";
      tab.addEventListener("click", () => this.expand());
      document.body.appendChild(tab);
      this._tab = tab;
      document.body.appendChild(panel);
      this._panel = panel;
      this._content = content;
      this._initResize(handle, panel);
      this._onNavigate = () => this.destroy();
      window.addEventListener("yt-navigate-finish", this._onNavigate);
      this.loadSettings();
      this._onStorageChange = (changes) => {
        const keys = ["ycrFontSize", "ycrFontColor", "ycrBgOpacity"];
        if (keys.some((k) => k in changes)) {
          const updated = {};
          for (const k of keys) {
            if (changes[k]) {
              updated[k] = changes[k].newValue;
            }
          }
          chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
            this._applySettings(settings);
          });
        }
      };
      chrome.storage.onChanged.addListener(this._onStorageChange);
    }
    _initResize(handle, panel) {
      let isResizing = false;
      let startX, startWidth;
      handle.addEventListener("mousedown", (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = parseInt(panel.style.width, 10) || 300;
        e.preventDefault();
        const onMouseMove = (e2) => {
          if (!isResizing) return;
          const delta = startX - e2.clientX;
          const newWidth = Math.min(600, Math.max(200, startWidth + delta));
          panel.style.width = newWidth + "px";
        };
        const onMouseUp = () => {
          isResizing = false;
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    }
    show() {
      if (this._panel) {
        this._panel.classList.add("ycr-visible");
      }
    }
    hide() {
      if (this._panel) {
        this._panel.classList.remove("ycr-visible");
      }
      if (this._tab) {
        this._tab.classList.remove("ycr-tab-visible");
      }
      this._collapsed = false;
    }
    collapse() {
      if (this._panel) {
        this._panel.classList.remove("ycr-visible");
      }
      if (this._tab) {
        this._tab.classList.add("ycr-tab-visible");
      }
      this._collapsed = true;
    }
    expand() {
      if (this._panel) {
        this._panel.classList.add("ycr-visible");
      }
      if (this._tab) {
        this._tab.classList.remove("ycr-tab-visible");
      }
      this._collapsed = false;
    }
    isVisible() {
      return this._panel ? this._panel.classList.contains("ycr-visible") : false;
    }
    appendEntry(timestamp, text) {
      if (!this._content) return;
      if (!this._listEl) {
        this._content.innerHTML = "";
        const controls = document.createElement("div");
        controls.id = "ycr-loop-controls";
        const toggleBtn = document.createElement("button");
        toggleBtn.id = "ycr-panel-toggle";
        toggleBtn.className = "ycr-toggle-btn ycr-toggle-active";
        toggleBtn.textContent = "Stop Recognition";
        toggleBtn.addEventListener("click", () => {
          if (this._onToggle) {
            this._onToggle();
          }
        });
        controls.appendChild(toggleBtn);
        this._content.appendChild(controls);
        const list = document.createElement("div");
        list.id = "ycr-entry-list";
        this._content.appendChild(list);
        this._listEl = list;
      }
      const entry = document.createElement("div");
      entry.className = "ycr-entry";
      entry.innerHTML = `<span class="ycr-ts">[${escapeHtml(timestamp)}]</span> <span class="ycr-text">${escapeHtml(text)}</span>`;
      this._listEl.appendChild(entry);
      entry.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    clearEntries() {
      this._listEl = null;
      if (this._content) {
        this._content.innerHTML = "";
      }
    }
    setOnToggle(callback) {
      this._onToggle = callback;
    }
    updateToggleButton(isLooping2) {
      if (!this._content) return;
      const btn = this._content.querySelector("#ycr-panel-toggle");
      if (!btn) return;
      if (isLooping2) {
        btn.textContent = "Stop Recognition";
        btn.classList.add("ycr-toggle-active");
      } else {
        btn.textContent = "Start Recognition";
        btn.classList.remove("ycr-toggle-active");
      }
    }
    /**
     * Apply settings to the panel immediately (called from content.js storage listener).
     * @param {{ fontSize: string|number, fontColor: string, bgOpacity: string|number }} settings
     */
    applySettings({ fontSize, fontColor, bgOpacity }) {
      if (!this._panel) return;
      this._applySettings({
        ycrFontSize: typeof fontSize === "string" ? parseFloat(fontSize) : fontSize,
        ycrFontColor: fontColor,
        ycrBgOpacity: typeof bgOpacity === "string" ? parseFloat(bgOpacity) : bgOpacity
      });
    }
    /**
     * Load settings from chrome.storage.sync and apply them to the panel.
     */
    loadSettings() {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
        this._applySettings(settings);
      });
    }
    /**
     * Inject a <style> element with per-settings CSS overrides into document.head.
     * Creates #ycr-entry-styles if absent; replaces its content on each call.
     * @param {{ ycrFontSize: number, ycrFontColor: string, ycrBgOpacity: number }} settings
     */
    _applySettings(settings) {
      const fontSize = settings.ycrFontSize || DEFAULT_SETTINGS.ycrFontSize;
      const fontColor = settings.ycrFontColor || DEFAULT_SETTINGS.ycrFontColor;
      const bgOpacity = settings.ycrBgOpacity != null ? settings.ycrBgOpacity : DEFAULT_SETTINGS.ycrBgOpacity;
      const css = `
.ycr-entry .ycr-text { font-size: ${fontSize}px; color: ${fontColor}; }
#ycr-side-panel { background: rgba(255, 255, 255, ${bgOpacity}); }
`;
      if (!this._entryStyleEl) {
        this._entryStyleEl = document.createElement("style");
        this._entryStyleEl.id = "ycr-entry-styles";
        document.head.appendChild(this._entryStyleEl);
      }
      this._entryStyleEl.textContent = css;
    }
    showLoading() {
      if (!this._content) return;
      if (this._listEl) return;
      this._content.innerHTML = `
      <div class="ycr-state" aria-busy="true">
        <div class="ycr-spinner"></div>
        <div class="ycr-state-heading">Recognizing...</div>
        <div class="ycr-state-body">Reading text from the selected area.</div>
      </div>
    `;
    }
    showText(text) {
      if (!this._content) return;
      if (this._listEl) return;
      this._content.innerHTML = `<div class="ycr-ocr-output">${escapeHtml(text)}</div>`;
    }
    showEmpty() {
      if (!this._content) return;
      if (this._listEl) return;
      this._content.innerHTML = `
      <div class="ycr-state">
        <div class="ycr-state-heading" style="font-size: 13px; font-weight: 400; line-height: 1.4; color: #6B7280;">No text recognized</div>
        <div class="ycr-state-body" style="font-size: 13px; color: #6B7280; margin-top: 8px;">The selected area may not contain readable text. Reposition the box and try again.</div>
      </div>
    `;
    }
    showNoSelection() {
      if (!this._content) return;
      if (this._listEl) return;
      this._content.innerHTML = `
      <div class="ycr-state">
        <div class="ycr-state-heading" style="font-size: 13px; font-weight: 400; line-height: 1.4; color: #6B7280;">No area selected</div>
        <div class="ycr-state-body" style="font-size: 13px; color: #6B7280; margin-top: 8px;">Use 'Draw Subtitle Area' to mark the subtitle region on the video.</div>
      </div>
    `;
    }
    showError(message) {
      if (!this._content) return;
      if (this._listEl) return;
      this._content.innerHTML = `
      <div class="ycr-state">
        <div class="ycr-state-heading" style="font-size: 13px; font-weight: 400; line-height: 1.4; color: #6B7280;">Recognition failed</div>
        <div class="ycr-state-body" style="font-size: 13px; color: #6B7280; margin-top: 8px;">An error occurred while reading the image. Check the selection area and try again.</div>
      </div>
    `;
      void message;
    }
    destroy() {
      if (this._onNavigate) {
        window.removeEventListener("yt-navigate-finish", this._onNavigate);
        this._onNavigate = null;
      }
      if (this._onStorageChange) {
        chrome.storage.onChanged.removeListener(this._onStorageChange);
        this._onStorageChange = null;
      }
      if (this._tab && this._tab.parentNode) {
        this._tab.parentNode.removeChild(this._tab);
      }
      this._tab = null;
      if (this._panel && this._panel.parentNode) {
        this._panel.parentNode.removeChild(this._panel);
      }
      if (this._styleEl && this._styleEl.parentNode) {
        this._styleEl.parentNode.removeChild(this._styleEl);
      }
      if (this._entryStyleEl && this._entryStyleEl.parentNode) {
        this._entryStyleEl.parentNode.removeChild(this._entryStyleEl);
      }
      this._panel = null;
      this._content = null;
      this._styleEl = null;
      this._entryStyleEl = null;
      this._listEl = null;
      this._collapsed = false;
      this._onToggle = null;
    }
  };

  // extension/content/ocr.js
  var OCREngine = class {
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
      const workerPath = chrome.runtime.getURL("libs/tesseract/worker.min.js");
      const corePath = chrome.runtime.getURL("libs/tesseract-core/");
      const langPath = chrome.runtime.getURL("tessdata/");
      this.worker = await Tesseract.createWorker("chi_sim", 1, {
        workerPath,
        corePath,
        langPath,
        // workerBlobURL defaults to true: Tesseract fetches the worker script from
        // the chrome-extension:// URL (content scripts can do this), then constructs
        // a blob: Worker from the fetched content. Direct new Worker(chrome-extension://)
        // is blocked by Chrome even for web_accessible_resources entries — only the
        // blob: approach works from a web page origin context.
        gzip: false,
        // traineddata is pre-decompressed in extension bundle
        logger: (m) => console.log("[YCR:Tesseract]", m.status, Math.round((m.progress || 0) * 100) + "%")
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
      const canvas = document.createElement("canvas");
      canvas.width = intrinsicRect.width;
      canvas.height = intrinsicRect.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        videoEl,
        intrinsicRect.x,
        intrinsicRect.y,
        intrinsicRect.width,
        intrinsicRect.height,
        0,
        0,
        intrinsicRect.width,
        intrinsicRect.height
      );
      const dataURL = canvas.toDataURL("image/png");
      const result = await this.worker.recognize(dataURL, {}, { text: true });
      return {
        text: (result.data.text || "").trim(),
        confidence: result.data.confidence || 0
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
  };

  // extension/content/content.js
  var overlay = null;
  var sidePanel = null;
  var ocrEngine = null;
  var loopIntervalId = null;
  var isLooping = false;
  var isTicking = false;
  var lastRecognizedText = "";
  var SETTINGS_DEFAULTS = { ycrFontSize: 14, ycrFontColor: "#111827", ycrBgOpacity: 1 };
  var SETTING_KEYS = ["ycrFontSize", "ycrFontColor", "ycrBgOpacity"];
  function loadAndApplySettings() {
    chrome.storage.sync.get(SETTINGS_DEFAULTS, (settings) => {
      if (sidePanel) {
        sidePanel.applySettings({
          fontSize: settings.ycrFontSize,
          fontColor: settings.ycrFontColor,
          bgOpacity: settings.ycrBgOpacity
        });
      }
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (!SETTING_KEYS.some((k) => k in changes)) return;
    loadAndApplySettings();
  });
  function ensureOverlay() {
    if (!overlay) overlay = new SelectionOverlay();
    return overlay;
  }
  function ensureSidePanel() {
    if (!sidePanel) sidePanel = new SidePanel();
    return sidePanel;
  }
  function ensureOCR() {
    if (!ocrEngine) ocrEngine = new OCREngine();
    return ocrEngine;
  }
  function getVideoTimestamp(videoEl) {
    const t = Math.floor(videoEl.currentTime);
    const duration = videoEl.duration || 0;
    const h = Math.floor(t / 3600);
    const m = Math.floor(t % 3600 / 60);
    const s = t % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return duration >= 3600 || h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function startLiveLoop() {
    if (isLooping) return;
    isLooping = true;
    ensureSidePanel().show();
    loadAndApplySettings();
    ensureSidePanel().setOnToggle(() => {
      if (isLooping) {
        stopLiveLoop();
        ensureSidePanel().updateToggleButton(false);
      } else {
        startLiveLoop();
        ensureSidePanel().updateToggleButton(true);
      }
    });
    loopIntervalId = setInterval(async () => {
      if (isTicking) return;
      const videoEl = document.querySelector("#movie_player video");
      if (!videoEl || videoEl.paused) return;
      if (videoEl.readyState < 3) return;
      if (!overlay || !overlay.hasSelection()) return;
      isTicking = true;
      try {
        const engine = ensureOCR();
        const intrinsicRect = overlay.getVideoIntrinsicRect();
        const result = await engine.recognize(videoEl, intrinsicRect);
        const text = result.text;
        if (text && text !== lastRecognizedText) {
          lastRecognizedText = text;
          const ts = getVideoTimestamp(videoEl);
          ensureSidePanel().appendEntry(ts, text);
        }
      } catch (err) {
        console.error("[YCR] Loop OCR error:", err);
        try {
          const videoEl2 = document.querySelector("#movie_player video");
          if (videoEl2) {
            ensureSidePanel().appendEntry(getVideoTimestamp(videoEl2), "[Error: " + err.message + "]");
          }
        } catch {
        }
      } finally {
        isTicking = false;
      }
    }, 1e3);
  }
  function stopLiveLoop() {
    if (loopIntervalId !== null) {
      clearInterval(loopIntervalId);
      loopIntervalId = null;
    }
    isLooping = false;
    isTicking = false;
    lastRecognizedText = "";
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ACTIVATE_DRAW_MODE") {
      ensureOverlay().activateDrawMode();
      sendResponse({ ok: true });
      return;
    }
    if (message.action === "GET_STATUS") {
      sendResponse({ boxDrawn: overlay ? overlay.hasSelection() : false, isLooping });
      return;
    }
    if (message.action === "START_LIVE") {
      startLiveLoop();
      sendResponse({ ok: true, isLooping: true });
      return;
    }
    if (message.action === "STOP_LIVE") {
      stopLiveLoop();
      sendResponse({ ok: true, isLooping: false });
      return;
    }
    if (message.action === "SHOW_PANEL") {
      const panel = ensureSidePanel();
      panel.show();
      loadAndApplySettings();
      if (!overlay || !overlay.hasSelection()) {
        panel.showNoSelection();
      }
      sendResponse({ ok: true });
      return;
    }
    if (message.action === "RECOGNIZE") {
      (async () => {
        const panel = ensureSidePanel();
        panel.show();
        if (!overlay || !overlay.hasSelection()) {
          panel.showNoSelection();
          sendResponse({ ok: false, error: "No selection" });
          return;
        }
        panel.showLoading();
        try {
          const engine = ensureOCR();
          const videoEl = document.querySelector("#movie_player video");
          if (!videoEl) {
            panel.showError("Video element not found");
            sendResponse({ ok: false, error: "No video element" });
            return;
          }
          const intrinsicRect = overlay.getVideoIntrinsicRect();
          const result = await engine.recognize(videoEl, intrinsicRect);
          if (result.text && result.text.length > 0) {
            panel.showText(result.text);
            sendResponse({ ok: true, text: result.text });
          } else {
            panel.showEmpty();
            sendResponse({ ok: true, text: "" });
          }
        } catch (err) {
          console.error("[YCR] OCR error:", err);
          panel.showError(err.message || "Unknown error");
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }
  });
  document.addEventListener("yt-navigate-finish", () => {
    stopLiveLoop();
    if (overlay) {
      overlay.destroy();
      overlay = null;
    }
    if (sidePanel) {
      sidePanel.destroy();
      sidePanel = null;
    }
    if (ocrEngine) {
      ocrEngine.terminate();
      ocrEngine = null;
    }
  });
  console.log("[YCR] YouTube Chinese Reader content script loaded");
})();
//# sourceMappingURL=content.bundle.js.map
