// YouTube Chinese Reader - Popup Script

const btnDraw = document.getElementById('btn-draw');
const btnRecognize = document.getElementById('btn-recognize');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

/**
 * Send a message to the content script in the active YouTube tab.
 * @param {Object} message
 * @returns {Promise<any>} response from content script, or undefined on error
 */
async function sendToContentScript(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    console.warn('Content script not ready:', err);
  }
}

/**
 * Update the status indicator in the popup.
 * @param {'inactive'|'ready'|'processing'} state
 */
function setStatus(state) {
  statusDot.className = 'status-dot';
  if (state === 'ready') {
    statusDot.classList.add('active');
    statusLabel.textContent = 'Ready';
  } else if (state === 'processing') {
    statusDot.classList.add('processing');
    statusLabel.textContent = 'Recognizing...';
  } else {
    statusLabel.textContent = 'Inactive';
  }
}

// Draw Subtitle Area button
btnDraw.addEventListener('click', async () => {
  const response = await sendToContentScript({ action: 'ACTIVATE_DRAW_MODE' });
  if (response?.ok) {
    setStatus('ready');
    btnRecognize.disabled = false;
  }
});

// Recognize Text / Stop Recognition toggle button (D-10)
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

// On popup open, check if a box is already drawn and sync loop state (D-12)
(async () => {
  const response = await sendToContentScript({ action: 'GET_STATUS' });
  if (response?.boxDrawn) {
    setStatus('ready');
    btnRecognize.disabled = false;
  }
  if (response?.isLooping) {
    btnRecognize.textContent = 'Stop Recognition';
    btnRecognize.dataset.looping = 'true';
    setStatus('processing');
  }
})();
