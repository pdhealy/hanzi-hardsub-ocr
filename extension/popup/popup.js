// Hanzi Hardsub Reader - Popup Script

const btnDraw = document.getElementById('btn-draw');
const btnRecognize = document.getElementById('btn-recognize');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

const presetList = document.getElementById('preset-list');
const savePresetContainer = document.getElementById('save-preset-container');
const btnSavePreset = document.getElementById('btn-save-preset');
const presetNameInput = document.getElementById('preset-name');


let presets = [];
let dragStartIndex = null;

/**
 * Return the active tab only if it is a YouTube page.
 * The content script is injected exclusively on https://www.youtube.com/*,
 * so messaging any other tab always throws "Receiving end does not exist".
 */
async function getActiveYouTubeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  if (!/^https:\/\/www\.youtube\.com\//.test(tab.url ?? '')) return null;
  return tab;
}

/**
 * Send a message to the content script in the active YouTube tab.
 */
async function sendToContentScript(message) {
  const tab = await getActiveYouTubeTab();
  if (!tab) return;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    if (!err?.message?.includes('Receiving end does not exist')) {
      console.debug('[YCR:Popup] Unexpected messaging error:', err);
    }
  }
}

function setStatus(state) {
  statusDot.className = 'status-dot';
  if (state === 'ready') {
    statusDot.classList.add('active');
    statusLabel.textContent = 'Ready';
  } else if (state === 'processing') {
    statusDot.classList.add('processing');
    statusLabel.textContent = 'Recognizing...';
  } else if (state === 'not-youtube') {
    statusLabel.textContent = 'Open YouTube to use';
  } else {
    statusLabel.textContent = 'Inactive';
  }
}

function updateDrawButtonState(hasBox) {
  if (hasBox) {
    btnDraw.textContent = 'Remove Subtitle Area';
    savePresetContainer.style.display = 'flex';
  } else {
    btnDraw.textContent = 'Draw New Subtitle Area';
    savePresetContainer.style.display = 'none';
  }
}

// Draw / Remove Subtitle Area button
btnDraw.addEventListener('click', async () => {
  const isRemoving = btnDraw.textContent === 'Remove Subtitle Area';
  
  if (isRemoving) {
    const response = await sendToContentScript({ action: 'REMOVE_BOX' });
    if (response?.ok) {
      updateDrawButtonState(false);
      setStatus('inactive');
      btnRecognize.disabled = true;

    }
  } else {
    const response = await sendToContentScript({ action: 'DRAW_CENTERED_BOX' });
    if (response?.ok) {
      updateDrawButtonState(true);
      setStatus('ready');
      btnRecognize.disabled = false;

    }
  }
});

// Recognize Text / Stop Recognition toggle button
btnRecognize.addEventListener('click', async () => {
  const looping = btnRecognize.dataset.looping === 'true';
  if (looping) {
    await sendToContentScript({ action: 'STOP_LIVE' });
    btnRecognize.textContent = 'Recognize Text';
    btnRecognize.dataset.looping = 'false';
    setStatus('ready');
  } else {
    await sendToContentScript({ action: 'START_LIVE' });
    btnRecognize.textContent = 'Stop Recognition';
    btnRecognize.dataset.looping = 'true';
    setStatus('processing');
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'STATE_CHANGED') {
    if (message.isLooping) {
      btnRecognize.textContent = 'Stop Recognition';
      btnRecognize.dataset.looping = 'true';
      setStatus('processing');
    } else {
      btnRecognize.textContent = 'Recognize Text';
      btnRecognize.dataset.looping = 'false';
      setStatus('ready');
    }
  }
});

// --- Presets Logic ---

async function loadPresets() {
  const data = await chrome.storage.local.get('ycr_presets');
  presets = data.ycr_presets || [];
  renderPresets();
}

async function savePresetsToStorage() {
  await chrome.storage.local.set({ ycr_presets: presets });
  renderPresets();
}

function renderPresets() {
  presetList.innerHTML = '';
  presets.forEach((preset, index) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = index;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'preset-name-display';
    nameSpan.textContent = preset.name;
    nameSpan.title = preset.name;
    
    // Click preset to apply
    nameSpan.addEventListener('click', async () => {
      const response = await sendToContentScript({ action: 'SET_BOX', rect: preset.rect });
      if (response?.ok) {
        updateDrawButtonState(true);
        setStatus('ready');
        btnRecognize.disabled = false;

      }
    });

    const actionContainer = document.createElement('div');
    actionContainer.style.display = 'flex';
    actionContainer.style.gap = '4px';

    const saveCoordsBtn = document.createElement('button');
    saveCoordsBtn.className = 'btn-remove-preset'; // Reuse style
    saveCoordsBtn.innerHTML = '&#128190;'; // Floppy disk
    saveCoordsBtn.title = 'Overwrite with current selection';
    saveCoordsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const response = await sendToContentScript({ action: 'GET_STATUS' });
      if (response?.rect) {
        preset.rect = response.rect;
        savePresetsToStorage();
      }
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-remove-preset'; // Reuse style
    editBtn.innerHTML = '&#9998;'; // Pencil mark
    editBtn.title = 'Edit name';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = preset.name;
      input.className = 'preset-input';
      input.style.width = '100px';
      input.style.marginRight = '8px';
      input.style.padding = '2px 4px';
      
      const saveEdit = () => {
        const newName = input.value.trim();
        if (newName) {
          preset.name = newName;
          savePresetsToStorage();
        } else {
          renderPresets();
        }
      };

      input.addEventListener('blur', saveEdit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') renderPresets();
      });
      
      li.insertBefore(input, nameSpan);
      li.removeChild(nameSpan);
      input.focus();
      input.select();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-preset';
    removeBtn.innerHTML = '&#128465;'; // Rubbish bin
    removeBtn.title = 'Delete preset';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      presets.splice(index, 1);
      savePresetsToStorage();
    });

    actionContainer.appendChild(saveCoordsBtn);
    actionContainer.appendChild(editBtn);
    actionContainer.appendChild(removeBtn);

    // Drag and Drop
    li.addEventListener('dragstart', (e) => {
      dragStartIndex = index;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => li.classList.add('dragging'), 0);
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    li.addEventListener('drop', (e) => {
      e.stopPropagation();
      if (dragStartIndex !== null && dragStartIndex !== index) {
        const item = presets.splice(dragStartIndex, 1)[0];
        presets.splice(index, 0, item);
        savePresetsToStorage();
      }
      return false;
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      dragStartIndex = null;
    });

    li.appendChild(nameSpan);
    li.appendChild(actionContainer);
    presetList.appendChild(li);
  });
}

btnSavePreset.addEventListener('click', async () => {
  const name = presetNameInput.value.trim();
  if (!name) return;
  
  // Get latest rect from content script before saving
  const response = await sendToContentScript({ action: 'GET_STATUS' });
  if (response?.rect) {
    presets.push({ name, rect: response.rect });
    presetNameInput.value = '';
    savePresetsToStorage();
  }
});

// On popup open: check current tab and sync state
(async () => {
  const tab = await getActiveYouTubeTab();
  if (!tab) {
    setStatus('not-youtube');
    btnDraw.disabled = true;
    return;
  }

  loadPresets();

  const response = await sendToContentScript({ action: 'GET_STATUS' });
  if (response?.boxDrawn) {
    setStatus('ready');
    btnRecognize.disabled = false;
    updateDrawButtonState(true);

  } else {
    updateDrawButtonState(false);
  }
  
  if (response?.isLooping) {
    btnRecognize.textContent = 'Stop Recognition';
    btnRecognize.dataset.looping = 'true';
    btnRecognize.disabled = false;
    setStatus('processing');
  }
})();
