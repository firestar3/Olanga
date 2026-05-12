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

    // ── v2.0 Commands ──────────────────────────────────────────────────────
    if (msg.cmd === 'v2_screenshot') {
      try {
        const tabId = msg.tabId;

        // Get the devicePixelRatio BEFORE capturing so we can report it
        let dpr = 1;
        if (tabId) {
          try {
            const [dprResult] = await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: () => window.devicePixelRatio || 1
            });
            if (dprResult && dprResult.result) dpr = dprResult.result;
          } catch (e) { /* default to 1 */ }
        }

        // Capture a CLEAN screenshot — no overlays, no grid, no tags.
        // The AI will pick click targets purely by visual coordinate estimation.
        let dataUrl;
        try {
          dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        } catch (e) {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (!tab) throw new Error('No active tab for screenshot');
          dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        }

        sendResponse({ ok: true, dataUrl: dataUrl, devicePixelRatio: dpr });
      } catch (e) {
        sendResponse({ ok: false, err: 'Screenshot failed: ' + e.message });
      }
      return;
    }

    if (msg.cmd === 'v2_inject') {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ ok: false, err: 'No tabId' }); return; }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content_v2.js']
        });
        await new Promise(r => setTimeout(r, 80));
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, err: e.message });
      }
      return;
    }

    if (msg.cmd === 'v2_pageinfo') {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ ok: false, err: 'No tabId' }); return; }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content_v2.js']
        });
        await new Promise(r => setTimeout(r, 80));
        let response;
        try {
          response = await chrome.tabs.sendMessage(tabId, { type: 'OLANGA_V2_PAGEINFO' });
        } catch (e) {
          await new Promise(r => setTimeout(r, 200));
          response = await chrome.tabs.sendMessage(tabId, { type: 'OLANGA_V2_PAGEINFO' });
        }
        sendResponse(response);
      } catch (e) {
        sendResponse({ ok: false, err: e.message });
      }
      return;
    }

    if (msg.cmd === 'v2_get_tag') {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ ok: false, err: 'No tabId' }); return; }
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'OLANGA_V2_GET_TAG', id: msg.id });
        sendResponse(response || { ok: false, err: 'No response from page' });
      } catch (e) {
        sendResponse({ ok: false, err: e.message });
      }
      return;
    }

    if (msg.cmd === 'v2_exec') {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ ok: false, err: 'No tabId' }); return; }
      const action = msg.action;
      if (!action || !action.type) { sendResponse({ ok: false, err: 'No action' }); return; }

      // Use Debugger API for native, trusted interactions (works in Google Docs, Canvas, etc)
      try {
        const target = { tabId: tabId };
        
        // Ensure debugger is attached (keep attached for session duration)
        await ensureDebuggerAttached(tabId);

        if (action.type === 'OLANGA_V2_CLICK') {
          // Snap to nearest interactive element for precision correction
          let clickX = action.x;
          let clickY = action.y;
          let snappedInfo = '';
          try {
            const snapResult = await chrome.tabs.sendMessage(tabId, {
              type: 'OLANGA_V2_SNAP', x: action.x, y: action.y
            });
            if (snapResult && snapResult.ok && snapResult.x !== undefined) {
              clickX = snapResult.x;
              clickY = snapResult.y;
              if (snapResult.snapped) {
                snappedInfo = ' (snapped ' + snapResult.distance + 'px to ' + (snapResult.element || 'element') + ')';
              }
            }
          } catch (e) { /* use original coordinates if snap fails */ }

          // Send mouseMoved FIRST — required for correct hit-testing in many UIs
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseMoved", x: clickX, y: clickY
          });
          await new Promise(r => setTimeout(r, 30));
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1
          });
          await new Promise(r => setTimeout(r, 50));
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1
          });
          
          // Show visual indicator at the actual click location
          chrome.tabs.sendMessage(tabId, { type: 'OLANGA_V2_CLICK', x: clickX, y: clickY }).catch(() => {});
          sendResponse({ ok: true, snapped: snappedInfo });
        } 
        else if (action.type === 'OLANGA_V2_HIGHLIGHT') {
          // Send mouseMoved to start coordinates
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseMoved", x: action.startX, y: action.startY
          });
          await new Promise(r => setTimeout(r, 30));
          // Press mouse button
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed", x: action.startX, y: action.startY, button: "left", buttons: 1, clickCount: 1
          });
          await new Promise(r => setTimeout(r, 100));
          
          // Drag to end coordinates in steps for realism
          const steps = 5;
          for (let i = 1; i <= steps; i++) {
            const curX = action.startX + (action.endX - action.startX) * (i / steps);
            const curY = action.startY + (action.endY - action.startY) * (i / steps);
            await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
              type: "mouseMoved", x: curX, y: curY, button: "left", buttons: 1
            });
            await new Promise(r => setTimeout(r, 20));
          }
          await new Promise(r => setTimeout(r, 50));
          
          // Release mouse button
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased", x: action.endX, y: action.endY, button: "left", clickCount: 1
          });
          
          // Still show visual indicator via content script if possible
          chrome.tabs.sendMessage(tabId, { type: 'OLANGA_V2_HIGHLIGHT', startX: action.startX, startY: action.startY, endX: action.endX, endY: action.endY }).catch(() => {});
          sendResponse({ ok: true });
        }
        else if (action.type === 'OLANGA_V2_TYPE') {
          if (action.x !== undefined && action.y !== undefined) {
            await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
              type: "mouseMoved", x: action.x, y: action.y
            });
            await new Promise(r => setTimeout(r, 30));
            await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
              type: "mousePressed", x: action.x, y: action.y, button: "left", clickCount: 1
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
              type: "mouseReleased", x: action.x, y: action.y, button: "left", clickCount: 1
            });
            await new Promise(r => setTimeout(r, 100));
          }
          
          const text = action.text || '';
          for (let i = 0; i < text.length; i++) {
            const char = text[i];
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyDown", text: char, unmodifiedText: char, key: char
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyUp", key: char
            });
            await new Promise(r => setTimeout(r, 15)); // tiny delay between chars
          }
          sendResponse({ ok: true, typed: text });
        }
        else if (action.type === 'OLANGA_V2_KEY') {
          // Map simple key names to CDP key codes where needed
          let keyText = action.key;
          let code = action.key;
          let vCode = undefined;
          if (action.key === 'Enter') { keyText = '\r'; code = 'Enter'; vCode = 13; }
          if (action.key === 'Backspace') { keyText = ''; code = 'Backspace'; vCode = 8; }
          if (action.key === 'Escape') { keyText = ''; code = 'Escape'; vCode = 27; }
          if (action.key === 'Tab') { keyText = ''; code = 'Tab'; vCode = 9; }
          if (action.key === 'ArrowDown') { keyText = ''; code = 'ArrowDown'; vCode = 40; }
          if (action.key === 'ArrowUp') { keyText = ''; code = 'ArrowUp'; vCode = 38; }
          if (action.key === 'Space') { keyText = ' '; code = 'Space'; vCode = 32; }

          let modifiers = 0;
          if (Array.isArray(action.modifiers)) {
            if (action.modifiers.includes('Alt')) modifiers |= 1;
            if (action.modifiers.includes('Control') || action.modifiers.includes('Ctrl')) modifiers |= 2;
            if (action.modifiers.includes('Meta') || action.modifiers.includes('Command')) modifiers |= 4;
            if (action.modifiers.includes('Shift')) modifiers |= 8;
          }
          
          const downParams = {
            type: "keyDown", key: action.key, code: code, modifiers: modifiers
          };
          if (vCode) downParams.windowsVirtualKeyCode = vCode;
          if (keyText && keyText !== action.key) downParams.text = keyText;

          await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", downParams);
          
          const upParams = { type: "keyUp", key: action.key, code: code, modifiers: modifiers };
          if (vCode) upParams.windowsVirtualKeyCode = vCode;
          
          await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", upParams);
          sendResponse({ ok: true });
        }
        else if (action.type === 'OLANGA_V2_SCROLL') {
          // Use CDP mouse wheel for scrolling — works everywhere
          const deltaY = (action.direction === 'up' ? -(action.amount || 400) : (action.amount || 400));
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseWheel", x: Math.round((pageInfo?.viewportWidth || 640) / 2), y: Math.round((pageInfo?.viewportHeight || 360) / 2),
            deltaX: 0, deltaY: deltaY
          });
          sendResponse({ ok: true, scrolled: deltaY });
        }
        else {
          sendResponse({ ok: false, err: 'Unknown v2 action type' });
        }
      } catch (e) {
        sendResponse({ ok: false, err: 'Debugger interaction failed: ' + e.message });
      }
      return;
    }

    // ── Detach debugger on demand ──────────────────────────────────────────
    if (msg.cmd === 'v2_detach') {
      const tabId = msg.tabId;
      if (tabId) {
        try { await chrome.debugger.detach({ tabId: tabId }); } catch (e) {}
        _attachedTabs.delete(tabId);
      }
      sendResponse({ ok: true });
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

// ── Debugger session management ─────────────────────────────────────────
// Keep track of which tabs have the debugger attached to avoid repeated attach/detach
const _attachedTabs = new Set();

async function ensureDebuggerAttached(tabId) {
  if (_attachedTabs.has(tabId)) {
    // Verify it's actually still attached
    try {
      const targets = await chrome.debugger.getTargets();
      const still = targets.some(t => t.tabId === tabId && t.attached);
      if (still) return;
    } catch (e) {}
    _attachedTabs.delete(tabId);
  }
  await chrome.debugger.attach({ tabId: tabId }, "1.3");
  _attachedTabs.add(tabId);
}

// Auto-detach when tab is closed or navigated away
chrome.tabs.onRemoved.addListener(function(tabId) {
  _attachedTabs.delete(tabId);
});

chrome.debugger.onDetach.addListener(function(source) {
  if (source.tabId) _attachedTabs.delete(source.tabId);
});
