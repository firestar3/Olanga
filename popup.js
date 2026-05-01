// Olanga Bridge Popup Script v0.11.3
let activeTabId = null;

function setStatus(text, type) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = 'status' + (type ? ' ' + type : '');
}
function setDot(live) {
  document.getElementById('dot').className = 'dot' + (live ? ' live' : '');
}

chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
  if (!tabs || !tabs[0]) {
    document.getElementById('tab-url').textContent = 'No tab found';
    setStatus('Could not detect tab', 'err');
    return;
  }
  const tab = tabs[0];
  activeTabId = tab.id;
  const url = tab.url || '';
  document.getElementById('tab-url').textContent = url.length > 45 ? url.slice(0,45)+'…' : url;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
    document.getElementById('inject-btn').disabled = true;
    setStatus('Cannot inject on browser system pages', 'err');
    return;
  }
  setStatus('Ready to activate');
});

document.getElementById('inject-btn').addEventListener('click', function() {
  if (!activeTabId) { setStatus('No tab ID — try reopening', 'err'); return; }
  setStatus('Activating…', 'busy');
  document.getElementById('inject-btn').disabled = true;

  chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    files: ['bridge.js']
  }, function() {
    document.getElementById('inject-btn').disabled = false;
    if (chrome.runtime.lastError) {
      setStatus('✗ ' + chrome.runtime.lastError.message, 'err');
      setDot(false);
      return;
    }

    // Save to extension storage
    chrome.storage.local.set({
      olanga_active_tab: activeTabId,
      olanga_active_url: document.getElementById('tab-url').textContent
    });

    // Tell the Olanga page directly via script injection
    chrome.tabs.query({}, function(allTabs) {
      const olangaTab = allTabs.find(function(t) {
        return t.url && (t.url.includes('localhost:8080') || t.url.includes('127.0.0.1:8080'));
      });
      if (olangaTab) {
        chrome.scripting.executeScript({
          target: { tabId: olangaTab.id },
          func: function(tabId, tabUrl) {
            window.__olangaActiveTabId = tabId;
            window.__olangaActiveUrl = tabUrl;
            window.dispatchEvent(new CustomEvent('olanga-tab-connected', {
              detail: { tabId: tabId, url: tabUrl }
            }));
          },
          args: [activeTabId, document.getElementById('tab-url').textContent]
        });
      }
    });

    setDot(true);
    setStatus('✓ Active — Olanga is connected', 'ok');
    document.getElementById('inject-btn').textContent = '↺ Re-activate';
  });
});

document.getElementById('open-btn').addEventListener('click', function() {
  chrome.tabs.create({ url: 'http://localhost:8080/ollama-quiz-controller.html' });
});
