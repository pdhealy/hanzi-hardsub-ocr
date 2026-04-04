// YouTube Chinese Reader - Popup Script

const btnDraw = document.getElementById('btn-draw');
const btnRecognize = document.getElementById('btn-recognize');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

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
 * Returns undefined (no error) when not on a YouTube page or when the
 * content script is still initialising.
 * @param {Object} message
 * @returns {Promise<any>} response from content script, or undefined
 */
async function sendToContentScript(message) {
  const tab = await getActiveYouTubeTab();
  if (!tab) return; // not a YouTube tab — content script is not present
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    // "Receiving end does not exist" is the expected transient state while the
    // content script is still loading on this YouTube page.  It is recoverable:
    // the popup just shows its default inactive state.  Do NOT use console.warn
    // or console.error here — Chrome's Extensions error panel captures both and
    // surfaces them as reported errors, which is misleading for expected behavior.
    if (!err?.message?.includes('Receiving end does not exist')) {
      // Genuinely unexpected error — log at debug level (not captured by panel)
      console.debug('[YCR:Popup] Unexpected messaging error:', err);
    }
  }
}

/**
 * Update the status indicator in the popup.
 * @param {'inactive'|'not-youtube'|'ready'|'processing'} state
 */
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

// On popup open: check current tab and sync state (D-12)
(async () => {
  const tab = await getActiveYouTubeTab();
  if (!tab) {
    // Not on YouTube — disable buttons and show a helpful message
    setStatus('not-youtube');
    btnDraw.disabled = true;
    return;
  }

  const response = await sendToContentScript({ action: 'GET_STATUS' });
  if (response?.boxDrawn) {
    setStatus('ready');
    btnRecognize.disabled = false;
  }
  if (response?.isLooping) {
    btnRecognize.textContent = 'Stop Recognition';
    btnRecognize.dataset.looping = 'true';
    btnRecognize.disabled = false;
    setStatus('processing');
  }
})();
