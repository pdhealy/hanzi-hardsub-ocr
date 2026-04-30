import { SidePanel } from '../extension/content/sidepanel.js';

// Setup chrome mock
window.chrome = {
  storage: {
    sync: {
      get: (keys, cb) => cb({ ycrFontSize: 14, ycrFontColor: '#000', ycrBgOpacity: 1, ycrPinyinToggle: false, ycrZhuyinToggle: false, ycrActiveToggles: [] }),
      set: () => {}
    },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    sendMessage: (msg, cb) => {
      if (msg.action === 'TRANSLATE_TEXT') {
        setTimeout(() => cb({ ok: true, translation: 'Mocked English Translation for: ' + msg.text }), 10);
      }
      return true;
    }
  }
};

const panel = new SidePanel();
panel.show();
panel.appendEntry('0:05', '你好世界');
window._testPanel = panel;
