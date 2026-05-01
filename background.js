// Olanga Background Service Worker v0.11.3
// Opens side panel on toolbar click, relays commands to active tab

chrome.action.onClicked.addListener(function(tab) {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Re-inject bridge then run command
async function runOnTab(tabId, cmd, action) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['bridge.js']
    });
  } catch(e) {
    return { ok: false, err: 'inject failed: ' + e.message };
  }
  return new Promise(function(resolve) {
    setTimeout(function() {
      chrome.tabs.sendMessage(tabId, { type: 'OLANGA_CMD', cmd, action }, function(resp) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, err: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, err: 'no response' });
        }
      });
    }, 120);
  });
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'EXEC') {
    runOnTab(msg.tabId, msg.cmd, msg.action).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      sendResponse(tabs && tabs[0] ? { id: tabs[0].id, url: tabs[0].url, title: tabs[0].title } : null);
    });
    return true;
  }
  if (msg.type === 'PING') {
    chrome.tabs.get(msg.tabId, function(tab) {
      if (chrome.runtime.lastError) sendResponse({ ok: false });
      else sendResponse({ ok: true, url: tab.url, title: tab.title });
    });
    return true;
  }
});
