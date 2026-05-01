// Olanga Bridge Content Script v0.11.3
(function() {
  if (window.__olangaBridge) return;
  window.__olangaBridge = true;

  function snap() {
    const inp = [];
    document.querySelectorAll('input,textarea,select').forEach(function(el, i) {
      let lbl = null;
      if (el.id) { const l = document.querySelector('label[for="'+el.id+'"]'); if (l) lbl = l.innerText.trim(); }
      if (!lbl) { const p = el.closest('label'); if (p) lbl = p.innerText.trim(); }
      if (!lbl) { const pv = el.previousElementSibling; if (pv) lbl = pv.innerText.trim().slice(0,80); }
      if (!lbl) { const nx = el.nextElementSibling; if (nx) lbl = nx.innerText.trim().slice(0,80); }
      if (!lbl) lbl = el.getAttribute('aria-label') || el.getAttribute('title') || el.placeholder || null;
      let opts;
      if (el.tagName==='SELECT') opts = Array.from(el.options).map(function(o){return{v:o.value,t:o.text};});
      inp.push({ i, tag:el.tagName.toLowerCase(), type:el.type||null, name:el.name||null,
        id:el.id||null, ph:el.placeholder||null, val:el.value||null,
        chk:(el.type==='checkbox'||el.type==='radio')?el.checked:undefined, opts, lbl });
    });
    const btns = [];
    document.querySelectorAll('button,input[type=submit],input[type=button],[role=button],a[href]').forEach(function(b,i){
      const txt = (b.innerText||b.value||b.getAttribute('aria-label')||'').trim().slice(0,80);
      if (txt) btns.push({ i, txt, id:b.id||null });
    });
    return { title:document.title, url:window.location.href,
      scrollY:window.scrollY, sh:document.body?document.body.scrollHeight:0,
      inp, btns, txt:document.body?document.body.innerText.slice(0,5000):'' };
  }

  function findInput(a) {
    const all = document.querySelectorAll('input,textarea,select');
    if (a.idx!=null && all[a.idx]) return all[a.idx];
    if (a.id) return document.getElementById(a.id);
    if (a.name) return document.querySelector('[name="'+a.name+'"]');
    return null;
  }

  function exec(action) {
    try {
      if (action.type==='scroll') { window.scrollBy({top:action.amount||300,behavior:'smooth'}); return {ok:true}; }
      if (action.type==='scrollTo') { window.scrollTo({top:action.y||0,behavior:'smooth'}); return {ok:true}; }
      if (action.type==='fill') {
        const el = findInput(action);
        if (!el) return {ok:false,err:'input not found idx='+action.idx};
        if (el.tagName==='SELECT') {
          const op = Array.from(el.options).find(function(o){return o.value===action.value||o.text.trim()===action.value;});
          if (op) el.value = op.value;
        } else if (el.type==='radio'||el.type==='checkbox') {
          el.checked = action.checked!==undefined ? action.checked : true;
        } else {
          const proto = el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto,'value');
          if (setter&&setter.set) setter.set.call(el, action.value||'');
          else el.value = action.value||'';
        }
        ['input','change','keydown','keyup'].forEach(function(e){ el.dispatchEvent(new Event(e,{bubbles:true})); });
        return {ok:true};
      }
      if (action.type==='click') {
        const btns = Array.from(document.querySelectorAll('button,input[type=submit],input[type=button],[role=button]'));
        let el = null;
        if (action.idx!=null) el = btns[action.idx];
        if (!el&&action.text) el = btns.find(function(b){return (b.innerText||b.value||b.getAttribute('aria-label')||'').toLowerCase().includes(action.text.toLowerCase());});
        if (!el&&action.text) el = Array.from(document.querySelectorAll('a')).find(function(a){return (a.innerText||'').toLowerCase().includes(action.text.toLowerCase());});
        if (!el&&action.id) el = document.getElementById(action.id);
        if (!el) return {ok:false,err:'not found: '+(action.text||action.idx)};
        el.click(); return {ok:true};
      }
      if (action.type==='highlight') {
        const el = findInput(action);
        if (el) { el.style.outline='3px solid #60a5fa'; setTimeout(function(){el.style.outline='';},2500); }
        return {ok:true};
      }
      if (action.type==='navigate') { window.location.href=action.url; return {ok:true}; }
      return {ok:false,err:'unknown: '+action.type};
    } catch(e) { return {ok:false,err:e.message}; }
  }

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (!msg||msg.type!=='OLANGA_CMD') return false;
    if (msg.cmd==='snap') sendResponse(snap());
    else if (msg.cmd==='exec') sendResponse(exec(msg.action));
    else sendResponse({err:'unknown cmd'});
    return true;
  });
})();
