// SidePanel module — injects a resizable side panel into the YouTube page.
// Displays OCR output, loading state, empty states, and error states.

const PANEL_STYLES = `
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
`;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class SidePanel {
  constructor() {
    this._panel = null;
    this._styleEl = null;
    this._onNavigate = null;
    this._init();
  }

  _init() {
    // Inject CSS
    this._styleEl = document.createElement('style');
    this._styleEl.id = 'ycr-panel-styles';
    this._styleEl.textContent = PANEL_STYLES;
    document.head.appendChild(this._styleEl);

    // Build panel DOM
    const panel = document.createElement('div');
    panel.id = 'ycr-side-panel';

    // Resize handle
    const handle = document.createElement('div');
    handle.id = 'ycr-resize-handle';
    panel.appendChild(handle);

    // Header
    const header = document.createElement('div');
    header.id = 'ycr-panel-header';

    const title = document.createElement('span');
    title.id = 'ycr-panel-title';
    title.textContent = 'YouTube Chinese Reader';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'ycr-panel-close';
    closeBtn.setAttribute('aria-label', 'Hide Panel');
    closeBtn.textContent = 'x';
    closeBtn.addEventListener('click', () => this.hide());

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Content area
    const content = document.createElement('div');
    content.id = 'ycr-panel-content';
    content.setAttribute('aria-live', 'polite');

    panel.appendChild(header);
    panel.appendChild(content);

    document.body.appendChild(panel);
    this._panel = panel;
    this._content = content;

    // Wire resize interaction
    this._initResize(handle, panel);

    // SPA navigation cleanup
    this._onNavigate = () => this.destroy();
    window.addEventListener('yt-navigate-finish', this._onNavigate);
  }

  _initResize(handle, panel) {
    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = parseInt(panel.style.width, 10) || 300;
      e.preventDefault();

      const onMouseMove = (e) => {
        if (!isResizing) return;
        const delta = startX - e.clientX; // panel grows leftward
        const newWidth = Math.min(600, Math.max(200, startWidth + delta));
        panel.style.width = newWidth + 'px';
      };

      const onMouseUp = () => {
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  show() {
    if (this._panel) {
      this._panel.classList.add('ycr-visible');
    }
  }

  hide() {
    if (this._panel) {
      this._panel.classList.remove('ycr-visible');
    }
  }

  isVisible() {
    return this._panel ? this._panel.classList.contains('ycr-visible') : false;
  }

  showLoading() {
    if (!this._content) return;
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
    this._content.innerHTML = `<div class="ycr-ocr-output">${escapeHtml(text)}</div>`;
  }

  showEmpty() {
    if (!this._content) return;
    this._content.innerHTML = `
      <div class="ycr-state">
        <div class="ycr-state-heading" style="font-size: 13px; font-weight: 400; line-height: 1.4; color: #6B7280;">No text recognized</div>
        <div class="ycr-state-body" style="font-size: 13px; color: #6B7280; margin-top: 8px;">The selected area may not contain readable text. Reposition the box and try again.</div>
      </div>
    `;
  }

  showNoSelection() {
    if (!this._content) return;
    this._content.innerHTML = `
      <div class="ycr-state">
        <div class="ycr-state-heading" style="font-size: 13px; font-weight: 400; line-height: 1.4; color: #6B7280;">No area selected</div>
        <div class="ycr-state-body" style="font-size: 13px; color: #6B7280; margin-top: 8px;">Use 'Draw Subtitle Area' to mark the subtitle region on the video.</div>
      </div>
    `;
  }

  showError(message) {
    if (!this._content) return;
    this._content.innerHTML = `
      <div class="ycr-state">
        <div class="ycr-state-heading" style="font-size: 13px; font-weight: 400; line-height: 1.4; color: #6B7280;">Recognition failed</div>
        <div class="ycr-state-body" style="font-size: 13px; color: #6B7280; margin-top: 8px;">An error occurred while reading the image. Check the selection area and try again.</div>
      </div>
    `;
    void message; // reserved for future use
  }

  destroy() {
    if (this._onNavigate) {
      window.removeEventListener('yt-navigate-finish', this._onNavigate);
      this._onNavigate = null;
    }
    if (this._panel && this._panel.parentNode) {
      this._panel.parentNode.removeChild(this._panel);
    }
    if (this._styleEl && this._styleEl.parentNode) {
      this._styleEl.parentNode.removeChild(this._styleEl);
    }
    this._panel = null;
    this._content = null;
    this._styleEl = null;
  }
}
