(() => {
  // extension/content/content.js
  var selectionBox = null;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ACTIVATE_DRAW_MODE") {
      console.log("[YCR] Draw mode activated (stub)");
      sendResponse({ ok: true });
    }
    if (message.action === "RECOGNIZE") {
      console.log("[YCR] Recognize triggered (stub)");
      sendResponse({ text: "OCR not yet implemented" });
      return true;
    }
    if (message.action === "GET_STATUS") {
      sendResponse({ boxDrawn: !!selectionBox });
    }
    if (message.action === "SHOW_PANEL") {
      console.log("[YCR] Show panel (stub)");
      sendResponse({ ok: true });
    }
  });
  console.log("[YCR] YouTube Chinese Reader content script loaded");
})();
//# sourceMappingURL=content.bundle.js.map
