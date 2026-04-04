(() => {
  // extension/popup/popup.js
  var btnDraw = document.getElementById("btn-draw");
  var btnRecognize = document.getElementById("btn-recognize");
  var statusDot = document.getElementById("status-dot");
  var statusLabel = document.getElementById("status-label");
  async function getActiveYouTubeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    if (!/^https:\/\/www\.youtube\.com\//.test(tab.url ?? "")) return null;
    return tab;
  }
  async function sendToContentScript(message) {
    const tab = await getActiveYouTubeTab();
    if (!tab) return;
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (err) {
      console.warn("Content script not ready:", err);
    }
  }
  function setStatus(state) {
    statusDot.className = "status-dot";
    if (state === "ready") {
      statusDot.classList.add("active");
      statusLabel.textContent = "Ready";
    } else if (state === "processing") {
      statusDot.classList.add("processing");
      statusLabel.textContent = "Recognizing...";
    } else if (state === "not-youtube") {
      statusLabel.textContent = "Open YouTube to use";
    } else {
      statusLabel.textContent = "Inactive";
    }
  }
  btnDraw.addEventListener("click", async () => {
    const response = await sendToContentScript({ action: "ACTIVATE_DRAW_MODE" });
    if (response?.ok) {
      setStatus("ready");
      btnRecognize.disabled = false;
    }
  });
  btnRecognize.addEventListener("click", async () => {
    const looping = btnRecognize.dataset.looping === "true";
    if (looping) {
      await sendToContentScript({ action: "STOP_LIVE" });
      btnRecognize.textContent = "Recognize Text";
      btnRecognize.dataset.looping = "false";
      setStatus("ready");
    } else {
      await sendToContentScript({ action: "START_LIVE" });
      btnRecognize.textContent = "Stop Recognition";
      btnRecognize.dataset.looping = "true";
      setStatus("processing");
    }
  });
  (async () => {
    const tab = await getActiveYouTubeTab();
    if (!tab) {
      setStatus("not-youtube");
      btnDraw.disabled = true;
      return;
    }
    const response = await sendToContentScript({ action: "GET_STATUS" });
    if (response?.boxDrawn) {
      setStatus("ready");
      btnRecognize.disabled = false;
    }
    if (response?.isLooping) {
      btnRecognize.textContent = "Stop Recognition";
      btnRecognize.dataset.looping = "true";
      btnRecognize.disabled = false;
      setStatus("processing");
    }
  })();
})();
//# sourceMappingURL=popup.bundle.js.map
