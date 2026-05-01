// Olanga Background Service Worker
// Routes messages between side panel and content scripts

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.target === 'background') {
    handleMessage(msg, sender, sendResponse);
    return true;
  }
});

async function handleMessage(msg, sender, sendResponse) {
  try {
    if (msg.cmd === 'getActiveTab') {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) {
        sendResponse({ ok: true, tabId: tab.id, url: tab.url, title: tab.title });
      } else {
        sendResponse({ ok: false, err: 'No active tab' });
      }
      return;
    }

    if (msg.cmd === 'snap' || msg.cmd === 'exec' || msg.cmd === 'ping') {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ ok: false, err: 'No tabId' }); return; }

      // Wait for tab to finish loading before injecting
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'loading') {
          await waitForTabLoad(tabId, 5000);
        }
      } catch (e) {
        // Tab might not exist
      }

      // Inject content script (idempotent — script has double-init guard)
      await injectContentScript(tabId);

      const msgType = msg.cmd === 'snap' ? 'OLANGA_SNAP' :
                      msg.cmd === 'exec' ? 'OLANGA_EXEC' :
                      'OLANGA_PING';

      const payload = { type: msgType };
      if (msg.action) payload.action = msg.action;

      // Try sending with one retry
      let response;
      try {
        response = await chrome.tabs.sendMessage(tabId, payload);
      } catch (e) {
        // First attempt failed — re-inject and retry
        await injectContentScript(tabId);
        await new Promise(r => setTimeout(r, 200));
        try {
          response = await chrome.tabs.sendMessage(tabId, payload);
        } catch (e2) {
          sendResponse({ ok: false, err: 'Cannot reach page. Make sure you are on a regular webpage.' });
          return;
        }
      }

      sendResponse(response);
      return;
    }

    sendResponse({ ok: false, err: 'unknown command' });
  } catch (e) {
    sendResponse({ ok: false, err: e.message });
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
  } catch (e) {
    // Fails on chrome://, edge://, etc. — expected
  }
  await new Promise(r => setTimeout(r, 80));
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise(function(resolve) {
    const timeout = setTimeout(function() {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
