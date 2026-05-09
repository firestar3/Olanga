// Olanga v2.0 Content Script — Vision-based interaction
// Clicks at exact pixel coordinates and types text at positions
// Does NOT interfere with v1's content.js

(function() {
  // Prevent double-injection
  if (window.__olangaV2BridgeActive) return;
  window.__olangaV2BridgeActive = true;

  // ── Click at exact pixel coordinates ─────────────────────────────────────
  function clickAtCoords(x, y) {
    try {
      var el = document.elementFromPoint(x, y);
      if (!el) return { ok: false, err: 'No element found at (' + x + ', ' + y + ')' };

      // Scroll element into center if needed
      var rect = el.getBoundingClientRect();

      // Create and dispatch realistic mouse events
      var eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x + window.screenX,
        screenY: y + window.screenY,
        button: 0,
        buttons: 1
      };

      el.dispatchEvent(new MouseEvent('mouseover', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
      el.dispatchEvent(new MouseEvent('mousemove', eventOptions));
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));

      // Focus the element if focusable
      if (el.focus && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || 
          el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.tagName === 'A' ||
          el.getAttribute('tabindex') !== null || el.contentEditable === 'true')) {
        el.focus();
      }

      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      el.dispatchEvent(new MouseEvent('click', eventOptions));

      var tagInfo = el.tagName.toLowerCase();
      if (el.id) tagInfo += '#' + el.id;
      if (el.className && typeof el.className === 'string') tagInfo += '.' + el.className.split(' ')[0];
      var text = (el.innerText || el.value || '').trim().slice(0, 40);

      return { 
        ok: true, 
        element: tagInfo,
        text: text,
        clickedAt: { x: x, y: y }
      };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }

  // ── Double click at coordinates ──────────────────────────────────────────
  function dblClickAtCoords(x, y) {
    try {
      var el = document.elementFromPoint(x, y);
      if (!el) return { ok: false, err: 'No element found at (' + x + ', ' + y + ')' };

      var eventOptions = {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0, buttons: 1
      };

      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      el.dispatchEvent(new MouseEvent('click', eventOptions));
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      el.dispatchEvent(new MouseEvent('click', eventOptions));
      el.dispatchEvent(new MouseEvent('dblclick', eventOptions));

      return { ok: true, element: el.tagName.toLowerCase() };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }

  // ── Type text at current focus or at coordinates ─────────────────────────
  function typeText(text, x, y) {
    try {
      var el;
      if (x !== undefined && y !== undefined) {
        // Click first to focus
        clickAtCoords(x, y);
        // Small delay is handled by the caller
        el = document.elementFromPoint(x, y);
      } else {
        el = document.activeElement;
      }

      if (!el) return { ok: false, err: 'No element to type into' };

      // Get native setter once for reuse (bypasses React/Vue/Angular controlled components)
      var nativeSetter = null;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        nativeSetter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        );
      }

      // Clear existing value first
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(el, '');
        } else {
          el.value = '';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Type each character with realistic key events
      for (var i = 0; i < text.length; i++) {
        var char = text[i];
        var keyOpts = {
          bubbles: true, cancelable: true, key: char,
          code: 'Key' + char.toUpperCase(), charCode: char.charCodeAt(0),
          keyCode: char.charCodeAt(0), which: char.charCodeAt(0)
        };

        el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        el.dispatchEvent(new KeyboardEvent('keypress', keyOpts));

        // Actually insert the character
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          var currentVal = el.value || '';
          var start = el.selectionStart || currentVal.length;
          var end = el.selectionEnd || currentVal.length;
          var newVal = currentVal.slice(0, start) + char + currentVal.slice(end);

          if (nativeSetter && nativeSetter.set) {
            nativeSetter.set.call(el, newVal);
          } else {
            el.value = newVal;
          }
          el.selectionStart = el.selectionEnd = start + 1;
        } else if (el.contentEditable === 'true') {
          document.execCommand('insertText', false, char);
        }

        el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }

      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      return { ok: true, typed: text, element: el.tagName.toLowerCase() };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }

  // ── Press special keys (Enter, Tab, Escape, etc.) ────────────────────────
  function pressKey(key) {
    try {
      var el = document.activeElement || document.body;
      var keyMap = {
        'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
        'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
        'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
        'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        'Space': { key: ' ', code: 'Space', keyCode: 32 },
      };
      var kd = keyMap[key] || { key: key, code: key, keyCode: 0 };
      var opts = { bubbles: true, cancelable: true, key: kd.key, code: kd.code, keyCode: kd.keyCode, which: kd.keyCode };

      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      if (key === 'Enter' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        // Trigger form submit if inside form
        var form = el.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }
      el.dispatchEvent(new KeyboardEvent('keypress', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));

      return { ok: true, key: key };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }

  // ── Scroll the page ──────────────────────────────────────────────────────
  function scrollPage(direction, amount) {
    try {
      var px = amount || 400;
      if (direction === 'up') px = -px;
      window.scrollBy({ top: px, behavior: 'smooth' });
      return { ok: true, scrolled: px, newScrollY: window.scrollY + px };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }

  // ── Get page dimensions for coordinate mapping ───────────────────────────
  function getPageInfo() {
    return {
      ok: true,
      url: location.href,
      title: document.title,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    };
  }

  // ── Show click indicator (visual feedback) ───────────────────────────────
  function showClickIndicator(x, y) {
    var dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;left:' + (x - 12) + 'px;top:' + (y - 12) + 'px;' +
      'width:24px;height:24px;border-radius:50%;background:rgba(0, 0, 0, 0.5);' +
      'border:2px solid rgba(255, 255, 255, 0.9);pointer-events:none;z-index:2147483647;' +
      'animation:olanga-click-pulse 0.6s ease-out forwards;';

    var style = document.createElement('style');
    style.textContent = '@keyframes olanga-click-pulse{0%{transform:scale(0.5);opacity:1}100%{transform:scale(2);opacity:0}}';
    document.head.appendChild(style);
    document.body.appendChild(dot);
    setTimeout(function() { dot.remove(); style.remove(); }, 700);
  }

  // ── Coordinate Grid Overlay ──────────────────────────────────────────────
  var gridEl = null;
  function drawGrid() {
    if (gridEl) return;
    var dpr = window.devicePixelRatio || 1;
    gridEl = document.createElement('div');
    gridEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';
    
    // Grid spacing: every 100 image-pixels = every (100/dpr) CSS-pixels
    var cssStep = 100 / dpr;

    // Draw vertical lines and X labels (in image-pixel coords)
    for (var imgX = 100; imgX < window.innerWidth * dpr; imgX += 100) {
      var cssX = imgX / dpr;
      var vl = document.createElement('div');
      vl.style.cssText = 'position:absolute;left:'+cssX+'px;top:0;height:100vh;border-left:1px dashed rgba(255,0,0,0.4);';
      var lbl = document.createElement('div');
      lbl.style.cssText = 'position:absolute;left:'+(cssX+2)+'px;top:2px;color:red;font-size:12px;font-family:monospace;font-weight:bold;text-shadow:1px 1px 0 #fff,-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff;';
      lbl.textContent = imgX;
      gridEl.appendChild(vl);
      gridEl.appendChild(lbl);
    }
    // Draw horizontal lines and Y labels (in image-pixel coords)
    for (var imgY = 100; imgY < window.innerHeight * dpr; imgY += 100) {
      var cssY = imgY / dpr;
      var hl = document.createElement('div');
      hl.style.cssText = 'position:absolute;top:'+cssY+'px;left:0;width:100vw;border-top:1px dashed rgba(255,0,0,0.4);';
      var lbl2 = document.createElement('div');
      lbl2.style.cssText = 'position:absolute;top:'+(cssY+2)+'px;left:2px;color:red;font-size:12px;font-family:monospace;font-weight:bold;text-shadow:1px 1px 0 #fff,-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff;';
      lbl2.textContent = imgY;
      gridEl.appendChild(hl);
      gridEl.appendChild(lbl2);
    }
    document.body.appendChild(gridEl);
  }

  function clearGrid() {
    if (gridEl) { gridEl.remove(); gridEl = null; }
  }

  // ── Listen for messages from background ──────────────────────────────────
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'OLANGA_V2_CLICK') {
      showClickIndicator(msg.x, msg.y);
      sendResponse(clickAtCoords(msg.x, msg.y));
      return true;
    }
    if (msg.type === 'OLANGA_V2_DBLCLICK') {
      showClickIndicator(msg.x, msg.y);
      sendResponse(dblClickAtCoords(msg.x, msg.y));
      return true;
    }
    if (msg.type === 'OLANGA_V2_TYPE') {
      sendResponse(typeText(msg.text, msg.x, msg.y));
      return true;
    }
    if (msg.type === 'OLANGA_V2_KEY') {
      sendResponse(pressKey(msg.key));
      return true;
    }
    if (msg.type === 'OLANGA_V2_SCROLL') {
      sendResponse(scrollPage(msg.direction, msg.amount));
      return true;
    }
    if (msg.type === 'OLANGA_V2_PAGEINFO') {
      sendResponse(getPageInfo());
      return true;
    }
    if (msg.type === 'OLANGA_V2_PING') {
      sendResponse({ ok: true, url: location.href, title: document.title });
      return true;
    }
    if (msg.type === 'OLANGA_V2_DRAW_GRID') {
      drawGrid();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'OLANGA_V2_CLEAR_GRID') {
      clearGrid();
      sendResponse({ ok: true });
      return true;
    }
  });

  console.log('[Olanga v2] Vision bridge active on', location.href);
})();
