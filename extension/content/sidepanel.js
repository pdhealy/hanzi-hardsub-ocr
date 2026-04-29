// SidePanel module — injects a resizable side panel into the YouTube page.
// Displays OCR output, loading state, empty states, and error states.

import { pinyin } from 'pinyin-pro';
import { pinyinToZhuyin } from 'pinyin-zhuyin';

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
  width: 16px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9CA3AF;
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
  padding: 16px 16px 12px 16px;
  border-bottom: 1px solid #E5E7EB;
  background: #FFFFFF;
  z-index: 2;
}

#ycr-bottom-controls {
  padding: 12px 16px 16px 16px;
  border-top: 1px solid #E5E7EB;
  background: #FFFFFF;
  z-index: 2;
  display: none;
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
  line-height: 2.2; /* Extra space for ruby */
}

/* Ruby translations width constraint */
.ycr-text ruby {
  ruby-align: center;
}

.ycr-text rt {
  font-size: 0.5em; /* Scales perfectly with main character size */
  display: inline-block;
  max-width: 100%; /* Ensure translations are NO WIDER than their base characters */
  overflow: visible; /* Show content visually without taking more flow space */
  white-space: nowrap;
  text-align: center;
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

#ycr-settings-menu {
  display: none;
  flex-direction: column;
  padding: 16px;
  background: #F9FAFB;
  border-bottom: 1px solid #E5E7EB;
  font-size: 13px;
  color: #374151;
}

#ycr-settings-menu.ycr-visible {
  display: flex;
}

.ycr-settings-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 12px;
}

.ycr-settings-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-weight: 500;
}

.ycr-settings-input {
  width: 100%;
  cursor: pointer;
}

.ycr-settings-color-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ycr-settings-color {
  cursor: pointer;
  padding: 0;
  border: 1px solid #D1D5DB;
  border-radius: 4px;
  width: 32px;
  height: 24px;
}

.ycr-settings-section-header {
  display: flex;
  justify-content: space-between;
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 8px;
}

.ycr-settings-section-icon {
  font-family: monospace;
  font-size: 16px;
  line-height: 1;
}

.ycr-switch {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 20px;
}

.ycr-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.ycr-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: #ccc;
  transition: .4s;
  border-radius: 20px;
}

.ycr-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}

input:checked + .ycr-slider {
  background-color: #2563EB;
}

input:checked + .ycr-slider:before {
  transform: translateX(14px);
}
`;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const DEFAULT_SETTINGS = {
  ycrFontSize: 14,
  ycrFontColor: '#111827',
  ycrBgOpacity: 1.0,
  ycrPinyinToggle: false,
  ycrZhuyinToggle: false,
  ycrActiveToggles: []
};

export class SidePanel {
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
    this._entries = [];
    this.activeToggles = [];
    this.pinyinEnabled = false;
    this.zhuyinEnabled = false;
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
    handle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;
    panel.appendChild(handle);

    // Header
    const header = document.createElement('div');
    header.id = 'ycr-panel-header';

    const title = document.createElement('span');
    title.id = 'ycr-panel-title';
    title.textContent = 'YouTube Chinese Reader';

    const collapseBtn = document.createElement('button');
    collapseBtn.id = 'ycr-panel-collapse';
    collapseBtn.setAttribute('aria-label', 'Collapse Panel');
    collapseBtn.textContent = '\u2013'; // en-dash as minimize icon
    collapseBtn.addEventListener('click', () => this.collapse());

    const settingsMenu = document.createElement('div');
    settingsMenu.id = 'ycr-settings-menu';
    settingsMenu.innerHTML = `
      <div class="ycr-settings-section">
        <div class="ycr-settings-section-header">
          <span>Appearance Settings</span>
          <span class="ycr-settings-section-icon">-</span>
        </div>
        <div class="ycr-settings-section-content" style="display: block;">
          <div class="ycr-settings-group">
            <div class="ycr-settings-label">
              <span>Font Size</span>
              <span id="ycr-font-size-val">14px</span>
            </div>
            <input type="range" id="ycr-font-size-input" class="ycr-settings-input" min="12" max="40" step="1" value="14">
          </div>
          <div class="ycr-settings-group">
            <div class="ycr-settings-label">
              <span>Font Color</span>
              <span id="ycr-font-color-hint">#111827</span>
            </div>
            <div class="ycr-settings-color-row">
              <input type="color" id="ycr-font-color-input" class="ycr-settings-color" value="#111827">
            </div>
          </div>
          <div class="ycr-settings-group" style="margin-bottom: 0;">
            <div class="ycr-settings-label">
              <span>Background Opacity</span>
              <span id="ycr-bg-opacity-val">1.0</span>
            </div>
            <input type="range" id="ycr-bg-opacity-input" class="ycr-settings-input" min="0.1" max="1" step="0.05" value="1">
          </div>
        </div>
      </div>
      <div class="ycr-settings-section" style="margin-top: 16px;">
        <div class="ycr-settings-section-header">
          <span>Language Settings</span>
          <span class="ycr-settings-section-icon">+</span>
        </div>
        <div class="ycr-settings-section-content" style="display: none;">
          <div class="ycr-settings-group" style="flex-direction: row; align-items: center; justify-content: space-between;">
            <span style="font-weight: 500;">Pinyin</span>
            <label class="ycr-switch">
              <input type="checkbox" id="ycr-pinyin-toggle">
              <span class="ycr-slider"></span>
            </label>
          </div>
          <div class="ycr-settings-group" style="flex-direction: row; align-items: center; justify-content: space-between; margin-bottom: 0;">
            <span style="font-weight: 500;">Bopofomo (Zhuyin)</span>
            <label class="ycr-switch">
              <input type="checkbox" id="ycr-zhuyin-toggle">
              <span class="ycr-slider"></span>
            </label>
          </div>
        </div>
      </div>
    `;

    settingsMenu.querySelectorAll('.ycr-settings-section-header').forEach(header => {
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        const icon = header.querySelector('.ycr-settings-section-icon');
        if (content.style.display === 'none') {
          content.style.display = 'block';
          icon.textContent = '-';
        } else {
          content.style.display = 'none';
          icon.textContent = '+';
        }
      });
    });

    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'ycr-panel-settings';
    settingsBtn.setAttribute('aria-label', 'Open Settings');
    settingsBtn.textContent = '\u2699'; // gear icon
    settingsBtn.addEventListener('click', () => {
      settingsMenu.classList.toggle('ycr-visible');
    });

    const closeBtn = document.createElement('button');
    closeBtn.id = 'ycr-panel-close';
    closeBtn.setAttribute('aria-label', 'Hide Panel');
    closeBtn.textContent = 'x';
    closeBtn.addEventListener('click', () => this.hide());

    header.appendChild(title);
    header.appendChild(collapseBtn);
    header.appendChild(settingsBtn);
    header.appendChild(closeBtn);

    const fontSizeInput = settingsMenu.querySelector('#ycr-font-size-input');
    const fontSizeVal = settingsMenu.querySelector('#ycr-font-size-val');
    const fontColorInput = settingsMenu.querySelector('#ycr-font-color-input');
    const fontColorHint = settingsMenu.querySelector('#ycr-font-color-hint');
    const bgOpacityInput = settingsMenu.querySelector('#ycr-bg-opacity-input');
    const bgOpacityVal = settingsMenu.querySelector('#ycr-bg-opacity-val');
    const pinyinToggle = settingsMenu.querySelector('#ycr-pinyin-toggle');
    const zhuyinToggle = settingsMenu.querySelector('#ycr-zhuyin-toggle');

    const updateSettingsStorage = () => {
      const newSettings = {
        ycrFontSize: parseInt(fontSizeInput.value, 10),
        ycrFontColor: fontColorInput.value,
        ycrBgOpacity: parseFloat(bgOpacityInput.value),
        ycrPinyinToggle: pinyinToggle.checked,
        ycrZhuyinToggle: zhuyinToggle.checked,
        ycrActiveToggles: this.activeToggles
      };
      chrome.storage.sync.set(newSettings);
    };

    fontSizeInput.addEventListener('input', () => {
      fontSizeVal.textContent = fontSizeInput.value + 'px';
      updateSettingsStorage();
    });

    fontColorInput.addEventListener('input', () => {
      fontColorHint.textContent = fontColorInput.value;
      updateSettingsStorage();
    });

    bgOpacityInput.addEventListener('input', () => {
      bgOpacityVal.textContent = parseFloat(bgOpacityInput.value).toFixed(2);
      updateSettingsStorage();
    });

    pinyinToggle.addEventListener('change', (e) => {
      this._updateToggles('pinyin', e.target.checked);
      updateSettingsStorage();
    });

    zhuyinToggle.addEventListener('change', (e) => {
      this._updateToggles('zhuyin', e.target.checked);
      updateSettingsStorage();
    });

    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      fontSizeInput.value = settings.ycrFontSize;
      fontSizeVal.textContent = settings.ycrFontSize + 'px';
      fontColorInput.value = settings.ycrFontColor;
      fontColorHint.textContent = settings.ycrFontColor;
      bgOpacityInput.value = settings.ycrBgOpacity;
      bgOpacityVal.textContent = parseFloat(settings.ycrBgOpacity).toFixed(2);
      
      pinyinToggle.checked = settings.ycrPinyinToggle;
      zhuyinToggle.checked = settings.ycrZhuyinToggle;
      this.pinyinEnabled = settings.ycrPinyinToggle;
      this.zhuyinEnabled = settings.ycrZhuyinToggle;
      this.activeToggles = settings.ycrActiveToggles || [];
      this._reRenderAllEntries();
    });

    // Controls area
    const controls = document.createElement('div');
    controls.id = 'ycr-loop-controls';
    controls.style.display = 'none';

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'ycr-panel-toggle';
    toggleBtn.className = 'ycr-toggle-btn ycr-toggle-active';
    toggleBtn.textContent = 'Stop Recognition';
    toggleBtn.addEventListener('click', () => {
      if (this._onToggle) {
        this._onToggle();
      }
    });

    const jumpBtn = document.createElement('button');
    jumpBtn.id = 'ycr-jump-bottom';
    jumpBtn.className = 'ycr-toggle-btn';
    jumpBtn.style.marginTop = '8px';
    jumpBtn.style.display = 'none'; // Hidden by default
    jumpBtn.textContent = 'Jump to Bottom';
    jumpBtn.addEventListener('click', () => {
      if (this._content) {
        this._content.scrollTop = this._content.scrollHeight;
      }
    });

    controls.appendChild(toggleBtn);
    controls.appendChild(jumpBtn);
    this._controls = controls;
    this._jumpBottomBtn = jumpBtn;

    // Content area
    const content = document.createElement('div');
    content.id = 'ycr-panel-content';
    content.setAttribute('aria-live', 'polite');
    
    // Bottom Controls area
    const bottomControls = document.createElement('div');
    bottomControls.id = 'ycr-bottom-controls';

    const jumpTopBtn = document.createElement('button');
    jumpTopBtn.id = 'ycr-jump-top';
    jumpTopBtn.className = 'ycr-toggle-btn';
    jumpTopBtn.textContent = 'Jump to Top';
    jumpTopBtn.addEventListener('click', () => {
      if (this._content) {
        this._content.scrollTop = 0;
      }
    });

    bottomControls.appendChild(jumpTopBtn);
    this._bottomControls = bottomControls;
    this._jumpTopBtn = jumpTopBtn;

    // Add scroll/resize listeners for scroll buttons
    content.addEventListener('scroll', () => this._updateScrollButtons());
    window.addEventListener('resize', () => this._updateScrollButtons());

    panel.appendChild(header);
    panel.appendChild(settingsMenu);
    panel.appendChild(controls);
    panel.appendChild(content);
    panel.appendChild(bottomControls);

    // Create the floating collapse tab (sibling to panel, not child)
    const tab = document.createElement('div');
    tab.id = 'ycr-collapse-tab';
    tab.textContent = 'YCR';
    tab.addEventListener('click', () => this.expand());
    document.body.appendChild(tab);
    this._tab = tab;

    document.body.appendChild(panel);
    this._panel = panel;
    this._content = content;

    // Wire resize interaction
    this._initResize(handle, panel);

    // SPA navigation cleanup
    this._onNavigate = () => this.destroy();
    window.addEventListener('yt-navigate-finish', this._onNavigate);

    // Load persisted settings and listen for future changes
    this.loadSettings();
    this._onStorageChange = (changes) => {
      const keys = ['ycrFontSize', 'ycrFontColor', 'ycrBgOpacity', 'ycrPinyinToggle', 'ycrZhuyinToggle', 'ycrActiveToggles'];
      if (keys.some((k) => k in changes)) {
        const updated = {};
        for (const k of keys) {
          if (changes[k]) {
            updated[k] = changes[k].newValue;
          }
        }
        // Merge with defaults then apply
        chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
          this._applySettings(settings);
          this.pinyinEnabled = settings.ycrPinyinToggle;
          this.zhuyinEnabled = settings.ycrZhuyinToggle;
          this.activeToggles = settings.ycrActiveToggles || [];
          if (changes.ycrPinyinToggle || changes.ycrZhuyinToggle || changes.ycrActiveToggles) {
            this._reRenderAllEntries();
          }
        });
      }
    };
    chrome.storage.onChanged.addListener(this._onStorageChange);
  }

  _updateToggles(type, isChecked) {
    if (isChecked) {
      if (!this.activeToggles.includes(type)) {
        this.activeToggles.push(type);
      }
    } else {
      this.activeToggles = this.activeToggles.filter(t => t !== type);
    }
    this.pinyinEnabled = this.activeToggles.includes('pinyin');
    this.zhuyinEnabled = this.activeToggles.includes('zhuyin');
    this._reRenderAllEntries();
  }

  _generateEntryHTML(timestamp, text) {
    if (!this.pinyinEnabled && !this.zhuyinEnabled) {
      return `<span class="ycr-ts">[${escapeHtml(timestamp)}]</span> <span class="ycr-text">${escapeHtml(text)}</span>`;
    }

    const pinyinArr = pinyin(text, { type: 'array', toneType: 'symbol' });
    const zhuyinArr = pinyinArr.map(p => {
      if (!p.trim() || !/[a-zA-Z]/.test(p)) return null;
      try {
        return pinyinToZhuyin(p) || null;
      } catch {
        return null;
      }
    });
    
    // Determine layers: top and middle annotations based on activation order
    const activeLength = this.activeToggles.length;
    let topType = null, middleType = null;
    
    if (activeLength === 1) {
      middleType = this.activeToggles[0];
    } else if (activeLength === 2) {
      // The toggle activated SECOND appears BELOW the one activated FIRST.
      // So first toggle = topType, second toggle = middleType.
      topType = this.activeToggles[0];
      middleType = this.activeToggles[1];
    }

    let annotatedText = '';
    for (let i = 0; i < text.length; i++) {
      const char = escapeHtml(text[i]);
      const pinyinVal = pinyinArr[i] ? escapeHtml(pinyinArr[i]) : '';
      const zhuyinVal = zhuyinArr[i] ? escapeHtml(zhuyinArr[i]) : '';

      const getVal = (type) => type === 'pinyin' ? pinyinVal : (type === 'zhuyin' ? zhuyinVal : '');
      const middleVal = getVal(middleType);
      const topVal = getVal(topType);

      if (!middleVal && !topVal) {
        annotatedText += char;
        continue;
      }

      if (activeLength === 1 || !topVal) {
        if (!middleVal) {
          annotatedText += char;
        } else {
          annotatedText += `<ruby>${char}<rt><span class="ycr-ruby-text">${middleVal}</span></rt></ruby>`;
        }
      } else {
        // activeLength === 2 and both exist
        // Inner ruby puts middleVal above the character
        // Outer ruby puts topVal above the inner ruby (which is middleVal + char)
        annotatedText += `<ruby><ruby>${char}<rt><span class="ycr-ruby-text">${middleVal}</span></rt></ruby><rt><span class="ycr-ruby-text">${topVal}</span></rt></ruby>`;
      }
    }

    return `<span class="ycr-ts">[${escapeHtml(timestamp)}]</span> <span class="ycr-text">${annotatedText}</span>`;
  }

  _reRenderAllEntries() {
    if (!this._listEl || !this._entries) return;
    this._listEl.innerHTML = '';
    for (const { timestamp, text } of this._entries) {
      const entry = document.createElement('div');
      entry.className = 'ycr-entry';
      entry.innerHTML = this._generateEntryHTML(timestamp, text);
      this._listEl.appendChild(entry);
    }
  }

  _initResize(handle, panel) {
    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = parseInt(panel.style.width, 10) || 450;
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

  _updateScrollButtons() {
    if (!this._content) return;
    const isScrollable = this._content.scrollHeight > this._content.clientHeight;
    if (this._jumpBottomBtn) {
      this._jumpBottomBtn.style.display = isScrollable ? 'block' : 'none';
    }
    if (this._bottomControls) {
      this._bottomControls.style.display = isScrollable ? 'block' : 'none';
    }
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
    if (this._tab) {
      this._tab.classList.remove('ycr-tab-visible');
    }
    this._collapsed = false;
  }

  collapse() {
    if (this._panel) {
      this._panel.classList.remove('ycr-visible');
    }
    if (this._tab) {
      this._tab.classList.add('ycr-tab-visible');
    }
    this._collapsed = true;
  }

  expand() {
    if (this._panel) {
      this._panel.classList.add('ycr-visible');
    }
    if (this._tab) {
      this._tab.classList.remove('ycr-tab-visible');
    }
    this._collapsed = false;
  }

  isVisible() {
    return this._panel ? this._panel.classList.contains('ycr-visible') : false;
  }

  appendEntry(timestamp, text) {
    if (!this._content) return;

    // Initialize list container on first entry
    if (!this._listEl) {
      this._content.innerHTML = '';
      this._controls.style.display = 'block';

      const list = document.createElement('div');
      list.id = 'ycr-entry-list';
      this._content.appendChild(list);
      this._listEl = list;
    }

    this._entries.push({ timestamp, text });

    const entry = document.createElement('div');
    entry.className = 'ycr-entry';
    entry.innerHTML = this._generateEntryHTML(timestamp, text);
    this._listEl.appendChild(entry);

    entry.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  clearEntries() {
    this._listEl = null;
    this._entries = [];
    if (this._content) {
      this._content.innerHTML = '';
    }
  }

  setOnToggle(callback) {
    this._onToggle = callback;
  }

  updateToggleButton(isLooping) {
    if (!this._content) return;
    const btn = this._content.querySelector('#ycr-panel-toggle');
    if (!btn) return;
    if (isLooping) {
      btn.textContent = 'Stop Recognition';
      btn.classList.add('ycr-toggle-active');
    } else {
      btn.textContent = 'Start Recognition';
      btn.classList.remove('ycr-toggle-active');
    }
  }

  /**
   * Apply settings to the panel immediately (called from content.js storage listener).
   * @param {{ fontSize: string|number, fontColor: string, bgOpacity: string|number }} settings
   */
  applySettings({ fontSize, fontColor, bgOpacity }) {
    if (!this._panel) return;
    this._applySettings({
      ycrFontSize: typeof fontSize === 'string' ? parseFloat(fontSize) : fontSize,
      ycrFontColor: fontColor,
      ycrBgOpacity: typeof bgOpacity === 'string' ? parseFloat(bgOpacity) : bgOpacity,
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
      this._entryStyleEl = document.createElement('style');
      this._entryStyleEl.id = 'ycr-entry-styles';
      document.head.appendChild(this._entryStyleEl);
    }
    this._entryStyleEl.textContent = css;
  }

  showLoading() {
    if (!this._content) return;
    if (this._listEl) return;
    if (this._controls) this._controls.style.display = 'none';
    this._content.innerHTML = `
      <div class="ycr-state" aria-busy="true">
        <div class="ycr-spinner"></div>
        <div class="ycr-state-heading">Recognizing...</div>
        <div class="ycr-state-body">Reading text from the selected area.</div>
      </div>
    `;
  }

  updateLoadingStatus(msg) {
    if (!this._content || this._listEl) return;
    const body = this._content.querySelector('.ycr-state-body');
    if (body) body.textContent = msg;
  }

  showText(text) {
    if (!this._content) return;
    if (this._listEl) return;
    if (this._controls) this._controls.style.display = 'none';
    this._content.innerHTML = `<div class="ycr-ocr-output">${escapeHtml(text)}</div>`;
  }

  showEmpty() {
    if (!this._content) return;
    if (this._listEl) return;
    if (this._controls) this._controls.style.display = 'none';
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
    if (this._controls) this._controls.style.display = 'none';
    this._content.innerHTML = `
      <div class="ycr-state">
        <div class="ycr-state-heading" style="font-size: 13px; font-weight: 400; line-height: 1.4; color: #6B7280;">No area selected</div>
        <div class="ycr-state-body" style="font-size: 13px; color: #6B7280; margin-top: 8px;">Use 'Draw New Subtitle Area' to mark the subtitle region on the video.</div>
      </div>
    `;
  }

  showError(message) {
    if (!this._content) return;
    if (this._listEl) return;
    if (this._controls) this._controls.style.display = 'none';
    const detail = message ? escapeHtml(String(message)) : 'An error occurred while reading the image. Check the selection area and try again.';
    this._content.innerHTML = `
      <div class="ycr-state">
        <div class="ycr-state-heading" style="font-size: 13px; font-weight: 400; line-height: 1.4; color: #6B7280;">Recognition failed</div>
        <div class="ycr-state-body" style="font-size: 13px; color: #6B7280; margin-top: 8px;">${detail}</div>
      </div>
    `;
  }

  destroy() {
    if (this._onNavigate) {
      window.removeEventListener('yt-navigate-finish', this._onNavigate);
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
    this._entries = [];
  }
}
