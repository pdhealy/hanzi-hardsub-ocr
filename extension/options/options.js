// YouTube Chinese Reader — Settings Page Script

const DEFAULT_SETTINGS = {
  ycrFontSize: 14,
  ycrFontColor: '#111827',
  ycrBgOpacity: 1.0,
};

const fontSizeInput = document.getElementById('font-size');
const fontSizeVal = document.getElementById('font-size-val');
const fontColorInput = document.getElementById('font-color');
const fontColorHint = document.getElementById('font-color-hint');
const bgOpacityInput = document.getElementById('bg-opacity');
const bgOpacityVal = document.getElementById('bg-opacity-val');
const btnSave = document.getElementById('btn-save');
const saveStatus = document.getElementById('save-status');

let saveStatusTimer = null;

/** Populate all controls from a settings object. */
function applyToUI(settings) {
  fontSizeInput.value = settings.ycrFontSize;
  fontSizeVal.textContent = settings.ycrFontSize + 'px';

  fontColorInput.value = settings.ycrFontColor;
  fontColorHint.textContent = settings.ycrFontColor;

  bgOpacityInput.value = settings.ycrBgOpacity;
  bgOpacityVal.textContent = parseFloat(settings.ycrBgOpacity).toFixed(2);
}

/** Show a brief "Saved!" confirmation. */
function showSaved() {
  saveStatus.textContent = 'Saved!';
  saveStatus.classList.add('visible');
  if (saveStatusTimer) {
    clearTimeout(saveStatusTimer);
  }
  saveStatusTimer = setTimeout(() => {
    saveStatus.classList.remove('visible');
    saveStatusTimer = null;
  }, 2000);
}

// Load saved settings on page open
chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
  applyToUI(settings);
});

// Live readout for font size range
fontSizeInput.addEventListener('input', () => {
  fontSizeVal.textContent = fontSizeInput.value + 'px';
});

// Live readout for font color picker
fontColorInput.addEventListener('input', () => {
  fontColorHint.textContent = fontColorInput.value;
});

// Live readout for background opacity range
bgOpacityInput.addEventListener('input', () => {
  bgOpacityVal.textContent = parseFloat(bgOpacityInput.value).toFixed(2);
});

// Save button
btnSave.addEventListener('click', () => {
  const newSettings = {
    ycrFontSize: parseInt(fontSizeInput.value, 10),
    ycrFontColor: fontColorInput.value,
    ycrBgOpacity: parseFloat(bgOpacityInput.value),
  };
  chrome.storage.sync.set(newSettings, () => {
    showSaved();
  });
});
