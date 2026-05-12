// Olanga v2.0 Content Script — Vision-based interaction
// Clicks at exact pixel coordinates and types text at positions
// Does NOT interfere with v1's content.js

(function() {
  // Prevent double-injection
  if (window.__olangaV2BridgeActive) return;
  window.__olangaV2BridgeActive = true;

  // ── Find element at exact pixel coordinates (for logging) ────────────────
  function clickAtCoords(x, y) {
    try {
      var el = document.elementFromPoint(x, y);
      if (!el) return { ok: true, element: 'unknown (no element at coords)', clickedAt: { x: x, y: y } };

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



  // ── Find element at coordinates for typing (for logging) ─────────────────
  function typeText(text, x, y) {
    try {
      var el = document.activeElement;
      if (x !== undefined && y !== undefined) {
        el = document.elementFromPoint(x, y);
      }
      if (!el) return { ok: true, element: 'unknown', typed: text };

      var tagInfo = el.tagName.toLowerCase();
      if (el.id) tagInfo += '#' + el.id;

      return { ok: true, typed: text, element: tagInfo };
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

  // ── Show highlight indicator (visual feedback) ───────────────────────────
  function showHighlightIndicator(sx, sy, ex, ey) {
    var overlay = document.createElement('div');
    var left = Math.min(sx, ex);
    var top = Math.min(sy, ey);
    var width = Math.abs(ex - sx) || 2;
    var height = Math.abs(ey - sy) || 16;
    
    overlay.style.cssText = 'position:fixed;left:' + left + 'px;top:' + top + 'px;' +
      'width:' + width + 'px;height:' + height + 'px;background:rgba(255, 255, 0, 0.4);' +
      'border:1px dashed rgba(255, 200, 0, 0.8);pointer-events:none;z-index:2147483647;' +
      'animation:olanga-highlight-fade 1s ease-out forwards;';

    var style = document.createElement('style');
    style.textContent = '@keyframes olanga-highlight-fade{0%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    setTimeout(function() { overlay.remove(); style.remove(); }, 1200);
  }

  // ── Snap-to-Element: find nearest interactive element to coordinates ─────
  function isInteractive(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    var tag = el.tagName.toLowerCase();
    // Direct interactive elements
    if (['a', 'button', 'input', 'textarea', 'select', 'summary', 'option'].indexOf(tag) !== -1) return true;
    // ARIA roles
    var role = el.getAttribute('role');
    if (role && ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'option', 'combobox', 'menuitemcheckbox', 'menuitemradio', 'switch'].indexOf(role) !== -1) return true;
    // Event listeners / tabindex
    if (el.hasAttribute('onclick') || el.hasAttribute('data-action')) return true;
    if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return true;
    // Cursor pointer (computed)
    try {
      if (window.getComputedStyle(el).cursor === 'pointer') return true;
    } catch (e) {}
    return false;
  }

  function findInteractiveAncestor(el, maxDepth) {
    var current = el;
    var depth = 0;
    while (current && depth < (maxDepth || 4)) {
      if (isInteractive(current)) return current;
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  function snapToNearestInteractive(x, y) {
    // 1. Check exact coordinates first
    var el = document.elementFromPoint(x, y);
    if (el) {
      var interactive = findInteractiveAncestor(el, 4);
      if (interactive) {
        var rect = interactive.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          element: interactive.tagName.toLowerCase() + (interactive.textContent || '').trim().slice(0, 20),
          snapped: false // was already on target
        };
      }
    }

    // 2. Search in expanding radius for nearest interactive element
    var radii = [8, 16, 25, 40, 60, 80];
    var bestEl = null;
    var bestDist = Infinity;
    var bestRect = null;

    for (var ri = 0; ri < radii.length; ri++) {
      var r = radii[ri];
      // Check 8 points around the circle + 4 cardinal midpoints
      var offsets = [
        [0, -r], [0, r], [-r, 0], [r, 0],
        [-r, -r], [r, -r], [-r, r], [r, r],
        [Math.round(r*0.7), Math.round(-r*0.7)], [Math.round(-r*0.7), Math.round(r*0.7)],
        [Math.round(r*0.7), Math.round(r*0.7)], [Math.round(-r*0.7), Math.round(-r*0.7)]
      ];

      for (var oi = 0; oi < offsets.length; oi++) {
        var px = x + offsets[oi][0];
        var py = y + offsets[oi][1];
        if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) continue;

        var candidate = document.elementFromPoint(px, py);
        if (!candidate) continue;

        var interactiveCandidate = findInteractiveAncestor(candidate, 4);
        if (interactiveCandidate && interactiveCandidate !== bestEl) {
          var cRect = interactiveCandidate.getBoundingClientRect();
          var cx = cRect.left + cRect.width / 2;
          var cy = cRect.top + cRect.height / 2;
          var dist = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y));
          if (dist < bestDist) {
            bestDist = dist;
            bestEl = interactiveCandidate;
            bestRect = cRect;
          }
        }
      }

      // If we found something within this radius, use it
      if (bestEl) break;
    }

    if (bestEl && bestRect) {
      return {
        x: Math.round(bestRect.left + bestRect.width / 2),
        y: Math.round(bestRect.top + bestRect.height / 2),
        element: bestEl.tagName.toLowerCase() + ' "' + (bestEl.textContent || '').trim().slice(0, 20) + '"',
        snapped: true,
        distance: Math.round(bestDist)
      };
    }

    // 3. No interactive element found nearby — return null (use original coords)
    return null;
  }

  // ── Coordinate Grid & Interactive Tags (Set-of-Mark) ───────────────────
  var overlayEl = null;
  window.__olangaTags = {}; // Stores { id: {x, y} }

  function drawGridAndTags() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';
    
    // 1. Draw Grid
    var step = 100;
    for (var x = step; x < window.innerWidth; x += step) {
      var vl = document.createElement('div');
      vl.style.cssText = 'position:absolute;left:'+x+'px;top:0;height:100vh;border-left:1px dashed rgba(255,0,0,0.4);';
      var lbl = document.createElement('div');
      lbl.style.cssText = 'position:absolute;left:'+(x+2)+'px;top:2px;color:red;font-size:12px;font-family:monospace;font-weight:bold;text-shadow:1px 1px 0 #fff,-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff;';
      lbl.textContent = x;
      overlayEl.appendChild(vl);
      overlayEl.appendChild(lbl);
    }
    for (var y = step; y < window.innerHeight; y += step) {
      var hl = document.createElement('div');
      hl.style.cssText = 'position:absolute;top:'+y+'px;left:0;width:100vw;border-top:1px dashed rgba(255,0,0,0.4);';
      var lbl2 = document.createElement('div');
      lbl2.style.cssText = 'position:absolute;top:'+(y+2)+'px;left:2px;color:red;font-size:12px;font-family:monospace;font-weight:bold;text-shadow:1px 1px 0 #fff,-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff;';
      lbl2.textContent = y;
      overlayEl.appendChild(hl);
      overlayEl.appendChild(lbl2);
    }

    // 2. Draw Interactive Tags (100% precision targeting)
    window.__olangaTags = {};
    var interactives = document.querySelectorAll('a, button, input, textarea, select, details, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [tabindex]:not([tabindex="-1"]), [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
    var idCounter = 1;

    for (var i = 0; i < interactives.length; i++) {
      var el = interactives[i];
      var rect = el.getBoundingClientRect();
      
      // Only tag visible elements
      if (rect.width > 5 && rect.height > 5 && rect.top >= 0 && rect.left >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth) {
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

        var cx = Math.round(rect.left + rect.width / 2);
        var cy = Math.round(rect.top + rect.height / 2);
        
        window.__olangaTags[idCounter] = { x: cx, y: cy };

        // Draw badge near top-left of the element
        var badge = document.createElement('div');
        badge.style.cssText = 'position:absolute;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
          'background:#ffeb3b;color:#000;font-size:11px;font-weight:bold;font-family:sans-serif;' +
          'border:1px solid #000;border-radius:3px;padding:0 2px;z-index:2147483647;' +
          'box-shadow: 1px 1px 2px rgba(0,0,0,0.5);';
        badge.textContent = idCounter;
        overlayEl.appendChild(badge);

        idCounter++;
      }
    }

    document.body.appendChild(overlayEl);
  }

  function clearGridAndTags() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    window.__olangaTags = {};
  }

  // ── Listen for messages from background ──────────────────────────────────
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'OLANGA_V2_CLICK') {
      showClickIndicator(msg.x, msg.y);
      sendResponse(clickAtCoords(msg.x, msg.y));
      return true;
    }
    if (msg.type === 'OLANGA_V2_HIGHLIGHT') {
      showHighlightIndicator(msg.startX, msg.startY, msg.endX, msg.endY);
      sendResponse({ ok: true });
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
    if (msg.type === 'OLANGA_V2_SNAP') {
      var result = snapToNearestInteractive(msg.x, msg.y);
      if (result) {
        sendResponse({ ok: true, x: result.x, y: result.y, snapped: result.snapped, element: result.element, distance: result.distance || 0 });
      } else {
        sendResponse({ ok: true, x: msg.x, y: msg.y, snapped: false });
      }
      return true;
    }
  });

  console.log('[Olanga v2] Vision bridge active on', location.href);
})();
