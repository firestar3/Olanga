// Olanga Content Script — Bridge injected into every page
// Provides snap() and exec() capabilities via chrome.runtime messaging

(function() {
  // Prevent double-injection
  if (window.__olangaBridgeActive) return;
  window.__olangaBridgeActive = true;

  function snap() {
    var inp = [];
    document.querySelectorAll('input,textarea,select').forEach(function(el, i) {
      var lbl = null;
      if (el.id) { var l = document.querySelector('label[for="' + el.id + '"]'); if (l) lbl = l.innerText.trim(); }
      if (!lbl) { var p = el.closest('label'); if (p) lbl = p.innerText.trim(); }
      if (!lbl) { var pv = el.previousElementSibling; if (pv) lbl = pv.innerText.trim().slice(0, 80); }
      if (!lbl) { var nx = el.nextElementSibling; if (nx) lbl = nx.innerText.trim().slice(0, 80); }
      var opts;
      if (el.tagName === 'SELECT') opts = Array.from(el.options).map(function(o) { return { v: o.value, t: o.text }; });
      inp.push({
        i: i, tag: el.tagName.toLowerCase(), type: el.type || null,
        name: el.name || null, id: el.id || null, ph: el.placeholder || null, val: el.value || null,
        chk: (el.type === 'checkbox' || el.type === 'radio') ? el.checked : undefined,
        opts: opts, lbl: lbl
      });
    });
    var btns = [];
    document.querySelectorAll('button,input[type=submit],input[type=button],[role=button]').forEach(function(b, i) {
      btns.push({ i: i, txt: (b.innerText || b.value || '').trim().slice(0, 60), id: b.id || null });
    });
    var links = [];
    document.querySelectorAll('a').forEach(function(l, i) {
      var t = (l.innerText || l.title || '').trim().slice(0, 60);
      if (t) links.push({ i: i, txt: t, href: (l.getAttribute('href') || '').slice(0, 60) });
    });
    return {
      title: document.title,
      url: location.href,
      scrollY: window.scrollY,
      sh: document.body ? document.body.scrollHeight : 0,
      inp: inp,
      btns: btns,
      links: links,
      txt: document.body ? document.body.innerText.slice(0, 5000) : ''
    };
  }

  function fi(a) {
    var all = document.querySelectorAll('input,textarea,select');
    if (a.idx !== undefined && a.idx !== null && all[a.idx]) return all[a.idx];
    if (a.id && a.id !== 'undefined') return document.getElementById(a.id);
    if (a.name && a.name !== 'undefined') return document.querySelector('[name="' + a.name + '"]');
    return null;
  }

  function exec(a) {
    try {
      if (a.type === 'scroll') { window.scrollBy({ top: a.amount || 300, behavior: 'smooth' }); return { ok: true }; }
      if (a.type === 'scrollTo') { window.scrollTo({ top: a.y || 0, behavior: 'smooth' }); return { ok: true }; }
      if (a.type === 'fill') {
        var el = fi(a);
        if (!el) return { ok: false, err: 'not found' };
        if (el.tagName === 'SELECT') {
          var op = Array.from(el.options).find(function(o) { return o.value === a.value || o.text.trim() === a.value; });
          if (op) el.value = op.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.type === 'radio' || el.type === 'checkbox') {
          el.checked = a.checked !== undefined ? a.checked : true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
          var nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
          if (el.tagName === 'TEXTAREA' && nativeTextAreaValueSetter && nativeTextAreaValueSetter.set) {
            nativeTextAreaValueSetter.set.call(el, a.value || '');
          } else if (el.tagName === 'INPUT' && nativeInputValueSetter && nativeInputValueSetter.set) {
            nativeInputValueSetter.set.call(el, a.value || '');
          } else {
            el.value = a.value || '';
          }
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }
        return { ok: true };
      }
      if (a.type === 'click') {
        var bs = document.querySelectorAll('button,input[type=submit],input[type=button],[role=button]'), b = null;
        if (a.idx !== undefined && a.idx !== null) b = bs[a.idx];
        if (!b && a.text) b = Array.from(bs).find(function(x) { return (x.innerText || x.value || '').toLowerCase().includes(a.text.toLowerCase()); });
        if (!b && a.id) b = document.getElementById(a.id);
        if (!b) return { ok: false, err: 'button not found' };
        b.click(); return { ok: true };
      }
      if (a.type === 'clickLink') {
        var links = document.querySelectorAll('a');
        var link = null;
        if (a.idx !== undefined && a.idx !== null) link = links[a.idx];
        if (!link && a.text) link = Array.from(links).find(function(x) { return (x.innerText || '').toLowerCase().includes(a.text.toLowerCase()); });
        if (!link) return { ok: false, err: 'link not found' };
        link.click(); return { ok: true };
      }
      if (a.type === 'highlight') {
        var el2 = fi(a);
        if (el2) { el2.style.outline = '3px solid #a78bfa'; setTimeout(function() { el2.style.outline = ''; }, 2500); }
        return { ok: true };
      }
      return { ok: false, err: 'unknown: ' + a.type };
    } catch (e) { return { ok: false, err: e.message }; }
  }

  // Listen for messages from the background service worker
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'OLANGA_SNAP') {
      sendResponse(snap());
      return true;
    }
    if (msg.type === 'OLANGA_EXEC') {
      sendResponse(exec(msg.action));
      return true;
    }
    if (msg.type === 'OLANGA_PING') {
      sendResponse({ ok: true, url: location.href, title: document.title });
      return true;
    }
  });

  // Signal ready
  console.log('[Olanga] Bridge active on', location.href);
})();
