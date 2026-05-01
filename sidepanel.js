// Olanga Chrome Extension — Side Panel Logic v1.1.8
// EXACT port of the working web version's agent logic.
// Only the communication layer is changed (chrome.runtime instead of iframe postMessage).

var busy = false;
var isCancelled = false;
var ollamaOk = false;
var groqKey = '';
var timerInterval = null;
var agentMode = 'ctx'; // 'ctx' or 'full'
var activeTabId = null;
var activeTabUrl = '';

// ── Key Management ───────────────────────────────────────────────────────────
var savedKeys = [];

chrome.storage.local.get(['olanga_keys'], function(result) {
  savedKeys = result.olanga_keys || [];
  renderKeySel();
  if (savedKeys.length) {
    groqKey = savedKeys[0];
    checkGroq();
  }
});

function renderKeySel() {
  var sel = document.getElementById('keySel');
  sel.innerHTML = '';
  if (!savedKeys.length) {
    sel.innerHTML = '<option value="">no keys</option>';
    return;
  }
  savedKeys.forEach(function(k, i) {
    var opt = document.createElement('option');
    opt.value = k;
    opt.textContent = 'key ' + (i + 1) + ': ...' + k.slice(-6);
    sel.appendChild(opt);
  });
  sel.value = savedKeys[0];
  groqKey = savedKeys[0];
}

function addKey() {
  var inp = document.getElementById('groqKeyInput');
  var val = inp.value.trim().replace(/[^ -~]/g, '');
  if (!val) { addMsg('sys', '⚠ Please enter an API key.'); return; }
  if (savedKeys.includes(val)) { addMsg('sys', '⚠ Key already saved.'); return; }
  savedKeys.push(val);
  chrome.storage.local.set({ olanga_keys: savedKeys });
  inp.value = '';
  renderKeySel();
  document.getElementById('keySel').value = val;
  groqKey = val;
  addMsg('sys', '🔑 Key added (' + savedKeys.length + ' total). Click Connect to verify.');
}

function removeKey() {
  var sel = document.getElementById('keySel');
  var val = sel.value;
  if (!val) return;
  savedKeys = savedKeys.filter(function(k) { return k !== val; });
  chrome.storage.local.set({ olanga_keys: savedKeys });
  groqKey = savedKeys[0] || '';
  renderKeySel();
  addMsg('sys', '🗑 Key removed.');
}

function switchKey() {
  var val = document.getElementById('keySel').value;
  if (val) { groqKey = val; addMsg('sys', '🔑 Switched to …' + val.slice(-6)); }
}

// ── Settings Toggle ──────────────────────────────────────────────────────────
function toggleSettings() {
  document.getElementById('settingsPanel').classList.toggle('open');
}

// ── Provider & Model ─────────────────────────────────────────────────────────
function updateModelList() {
  var provider = document.getElementById('providerSel').value;
  var sel = document.getElementById('modelSel');
  sel.innerHTML = '';
  var models = provider === 'openrouter' ? [
    ['openrouter/free', 'Auto (best free model)'],
    ['deepseek/deepseek-r1:free', 'DeepSeek R1 (free)'],
    ['deepseek/deepseek-r1-distill-llama-70b:free', 'DeepSeek R1 Llama 70B (free)'],
    ['meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B (free)'],
    ['google/gemini-2.0-flash-exp:free', 'Gemini 2.0 Flash (free)'],
    ['google/gemma-3-27b-it:free', 'Gemma 3 27B (free)'],
  ] : (provider === 'cerebras' ? [
    ['qwen-3-235b-a22b-instruct-2507', 'Qwen 3 235B'],
    ['llama3.1-8b', 'Llama 3.1 8B'],
    ['llama3.3-70b', 'Llama 3.3 70B'],
  ] : (provider === 'gemini' ? [
    ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ['gemini-2.0-flash', 'Gemini 2.0 Flash'],
    ['gemini-2.0-pro-exp-02-05', 'Gemini 2.0 Pro Exp'],
  ] : [
    ['llama-3.3-70b-versatile', 'Llama 3.3 70B'],
    ['llama-3.1-8b-instant', 'Llama 3.1 8B (fast)'],
    ['mixtral-8x7b-32768', 'Mixtral 8x7B'],
    ['gemma2-9b-it', 'Gemma2 9B'],
  ]));
  models.forEach(function(m) {
    var o = document.createElement('option');
    o.value = m[0]; o.textContent = m[1]; sel.appendChild(o);
  });
  addMsg('sys', 'Switched to ' + provider + '. Select a model and click Connect.');
}

// ── Connect ──────────────────────────────────────────────────────────────────
function saveAndCheck() {
  var inp = document.getElementById('groqKeyInput');
  if (inp && inp.value.trim().startsWith('gsk_')) addKey();
  var sel = document.getElementById('keySel');
  if (sel && sel.value) groqKey = sel.value;
  checkGroq();
}

async function checkGroq() {
  if (!groqKey) { setSt('err', 'no key'); addMsg('sys', '⚠ Enter an API key and click Connect.\nGroq: console.groq.com\nOpenRouter: openrouter.ai'); return; }
  setSt('', 'connecting…');
  var provider = document.getElementById('providerSel').value;
  var testUrl = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/models'
    : (provider === 'cerebras' ? 'https://api.cerebras.ai/v1/models' 
    : (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/models?key=' + groqKey
    : 'https://api.groq.com/openai/v1/models'));
  try {
    var headers = provider === 'gemini' ? {} : { 'Authorization': 'Bearer ' + groqKey };
    var r = await fetch(testUrl, { headers: headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    ollamaOk = true;
    var model = document.getElementById('modelSel').value;
    setSt('live', provider + ' connected');
    addMsg('sys', '✓ Connected via ' + provider + '! Model: ' + model + '\nHi, I am Olanga. Navigate to any page and tell me what to do.');
    var welcome = document.getElementById('welcome');
    if (welcome) welcome.style.display = 'none';
    connectToTab();
    if (provider === 'openrouter') {
      fetch('https://openrouter.ai/api/v1/models?supported_parameters=temperature', {
        headers: { 'Authorization': 'Bearer ' + groqKey }
      }).then(function(r) { return r.json(); }).then(function(d) {
        var free = (d.data || []).filter(function(m) {
          return m.pricing && (m.pricing.prompt === 0 || m.pricing.prompt === '0');
        }).sort(function(a, b) { return a.name.localeCompare(b.name); });
        if (!free.length) return;
        var sel = document.getElementById('modelSel');
        sel.innerHTML = '';
        var auto = document.createElement('option');
        auto.value = 'openrouter/free'; auto.textContent = 'Auto (best free model)';
        sel.appendChild(auto);
        free.forEach(function(m) {
          var o = document.createElement('option');
          o.value = m.id;
          o.textContent = m.name + (m.context_length ? ' (' + Math.round(m.context_length / 1000) + 'k ctx)' : '');
          sel.appendChild(o);
        });
        addMsg('sys', 'Loaded ' + free.length + ' free models from OpenRouter.');
      }).catch(function() {});
    }
  } catch (e) {
    ollamaOk = false;
    setSt('err', 'connection failed');
    addMsg('sys', '❌ Could not connect: ' + e.message);
  }
}

// ── Tab Connection ───────────────────────────────────────────────────────────
async function connectToTab() {
  try {
    var resp = await sendToBg({ cmd: 'getActiveTab' });
    if (resp && resp.ok) {
      activeTabId = resp.tabId;
      activeTabUrl = resp.url || '';
      document.getElementById('tabUrl').textContent = activeTabUrl || 'Tab ' + activeTabId;
      if (ollamaOk) setSt('live', 'ready');
    } else {
      document.getElementById('tabUrl').textContent = 'could not detect tab';
    }
  } catch (e) {
    document.getElementById('tabUrl').textContent = 'error: ' + e.message;
  }
}

setInterval(function() {
  if (!activeTabId) return;
  sendToBg({ cmd: 'ping', tabId: activeTabId }).then(function(r) {
    if (r && r.ok) {
      activeTabUrl = r.url || activeTabUrl;
      document.getElementById('tabUrl').textContent = activeTabUrl;
    }
  }).catch(function() {});
}, 5000);

connectToTab();

// ── Background Messaging ─────────────────────────────────────────────────────
function sendToBg(msg) {
  return new Promise(function(resolve, reject) {
    msg.target = 'background';
    chrome.runtime.sendMessage(msg, function(response) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ── Snap & Exec — EXACT same logic as original web version ───────────────────
async function getSnap() {
  // Refresh active tab
  var tabResp = await sendToBg({ cmd: 'getActiveTab' });
  if (tabResp && tabResp.ok) {
    activeTabId = tabResp.tabId;
    activeTabUrl = tabResp.url || '';
    document.getElementById('tabUrl').textContent = activeTabUrl;
  }
  if (!activeTabId) throw new Error('No active tab');

  // Stability check — same as original
  var snap1 = await sendToBg({ cmd: 'snap', tabId: activeTabId });
  await delay(600);
  var snap2 = await sendToBg({ cmd: 'snap', tabId: activeTabId });
  if ((snap1.txt || '').slice(0, 200) !== (snap2.txt || '').slice(0, 200)) {
    await delay(1000);
    return await sendToBg({ cmd: 'snap', tabId: activeTabId });
  }
  return snap2;
}

async function execAction(a, snap) {
  if (!validateAction(a, snap)) return { ok: false, err: 'invalid' };
  try {
    var r = await sendToBg({ cmd: 'exec', tabId: activeTabId, action: a });
    var lbl = a.type === 'fill' ? 'fill[' + a.idx + ']=' + (a.value !== undefined ? '"' + a.value + '"' : 'checked') :
              a.type === 'click' ? 'click:"' + (a.text || '#' + a.idx) + '"' :
              a.type;
    addMsg('sys', (r && r.ok ? '✓ ' : '⚠ ') + lbl + (r && r.ok ? '' : ' — ' + (r && r.err || 'failed')));
    return r || { ok: false };
  } catch (e) { addMsg('sys', '⚠ ' + e.message); return { ok: false, err: e.message }; }
}

// ── Agent Mode ───────────────────────────────────────────────────────────────
function setAgentMode(m) {
  agentMode = m;
  document.querySelectorAll('.mode-tab').forEach(function(btn) { btn.classList.remove('active'); });
  document.getElementById('btn-' + m).classList.add('active');
  var hint = document.getElementById('mode-hint');
  hint.textContent = m === 'ctx' ? 'read + reply' : 'edit mode';
}

// ── UI Helpers ───────────────────────────────────────────────────────────────
function setSt(s, t) {
  document.getElementById('sd').className = 'sdot' + (s ? ' ' + s : '');
  document.getElementById('stxt').textContent = t || '';
}

function clrChat() {
  document.getElementById('chat').innerHTML = '';
  addMsg('sys', 'Chat cleared.');
}

function addMsg(role, text, chips) {
  var welcome = document.getElementById('welcome');
  if (welcome) welcome.style.display = 'none';
  var area = document.getElementById('chat');
  var d = document.createElement('div'); d.className = 'msg ' + role;
  var hdr = document.createElement('div');
  var rl = document.createElement('span'); rl.className = 'mrole ' + role;
  rl.textContent = role === 'sys' ? 'SYSTEM' : role === 'ai' ? 'OLANGA' : 'YOU';
  hdr.appendChild(rl); d.appendChild(hdr);
  var b = document.createElement('div'); b.className = 'mbody'; b.textContent = text; d.appendChild(b);
  if (chips && chips.length) {
    var row = document.createElement('div'); row.className = 'chips';
    chips.forEach(function(c) { var ch = document.createElement('span'); ch.className = 'chip'; ch.textContent = c; row.appendChild(ch); });
    d.appendChild(row);
  }
  area.appendChild(d); area.scrollTop = area.scrollHeight;
  return b;
}

var thkStart = null;
function addThk() {
  var area = document.getElementById('chat');
  var d = document.createElement('div'); d.className = 'thk'; d.id = 'thk';
  d.innerHTML = '<div class="thkd"><span></span><span></span><span></span></div><span style="margin-left:2px">thinking</span><span class="timer" id="thktimer"> 0s</span>';
  area.appendChild(d); area.scrollTop = area.scrollHeight;
  thkStart = Date.now();
  timerInterval = setInterval(function() {
    var el = document.getElementById('thktimer');
    if (el) el.textContent = ' ' + (((Date.now() - thkStart) / 1000) | 0) + 's';
  }, 500);
}
function rmThk() {
  clearInterval(timerInterval);
  var t = document.getElementById('thk');
  if (t) {
    var elapsed = (((Date.now() - thkStart) / 1000) | 0) + 's';
    t.remove();
    return elapsed;
  }
  return '';
}

// ── Formatters — EXACT copy from original ────────────────────────────────────
function buildInputList(inp) {
  if (!inp || !inp.length) return '(none)';
  return inp.map(function(x) {
    var d = '[' + x.i + '] ' + x.tag + (x.type ? '/' + x.type : '');
    if (x.lbl) d += ' label:"' + x.lbl + '"';
    if (x.name) d += ' name=' + x.name;
    if (x.id) d += ' id=' + x.id;
    if (x.val && x.val !== x.ph) d += ' FILLED:"' + x.val + '"';
    if (x.chk === true) d += ' CHECKED';
    if (x.opts) d += ' opts:[' + x.opts.map(function(o) { return o.t + '=' + o.v; }).join(', ') + ']';
    return d;
  }).join('\n');
}

function buildBtnList(btns) {
  if (!btns || !btns.length) return '(none)';
  return btns.map(function(b) { return '[' + b.i + '] "' + b.txt + '"'; }).join('\n');
}

function buildLinkList(links) {
  if (!links || !links.length) return '(none)';
  return links.map(function(l) { return '[' + l.i + '] "' + l.txt + '"' + (l.href ? ' href="' + l.href + '"' : ''); }).join('\n');
}

// ── JSON parsing — EXACT copy from original ──────────────────────────────────
function tryParse(str) {
  str = str.trim().replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(str);
}

function parseAction(raw) {
  var fenced = raw.match(/```[a-z]*\s*([\s\S]*?)```/i);
  if (fenced) { try { var r = tryParse(fenced[1]); return Array.isArray(r) ? r[0] : r; } catch (e) {} }
  var m = raw.match(/\{[^{}]*"type"[^{}]*\}/);
  if (m) { try { return tryParse(m[0]); } catch (e) {} }
  return null;
}

function validateAction(a, snap) {
  if (!a) return false;
  var maxInp = Math.max(0, (snap.inp.length || 1) - 1);
  var maxBtn = Math.max(0, (snap.btns.length || 1) - 1);
  var maxLink = snap.links && snap.links.length ? snap.links.length - 1 : 0;
  if ((a.type === 'fill' || a.type === 'highlight') && a.idx !== undefined) {
    if (a.idx < 0 || a.idx > maxInp) { addMsg('sys', '⚠ invalid idx=' + a.idx + ' (max=' + maxInp + ')'); return false; }
  }
  if (a.type === 'click' && a.idx !== undefined && !a.text) {
    if (a.idx < 0 || a.idx > maxBtn) { addMsg('sys', '⚠ invalid btn=' + a.idx + ' (max=' + maxBtn + ')'); return false; }
  }
  if (a.type === 'clickLink' && a.idx !== undefined && !a.text) {
    if (a.idx < 0 || a.idx > maxLink) { addMsg('sys', '⚠ invalid link=' + a.idx + ' (max=' + maxLink + ')'); return false; }
  }
  return true;
}

// ── AI Call — with 429 retry ─────────────────────────────────────────────────
async function callAI(system, user) {
  var model = document.getElementById('modelSel').value;
  var provider = document.getElementById('providerSel').value;
  var endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : (provider === 'cerebras' ? 'https://api.cerebras.ai/v1/chat/completions'
    : (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions'));
  var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'chrome-extension://olanga';
    headers['X-Title'] = 'Olanga';
  }
  var messages = model.includes('deepseek-r1')
    ? [{ role: 'user', content: system + '\n\n' + user }]
    : [{ role: 'system', content: system }, { role: 'user', content: user }];
  var body = { model: model, messages: messages, temperature: 0.1, max_tokens: 2000 };

  for (var attempt = 0; attempt < 3; attempt++) {
    var resp = await fetch(endpoint, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    if (resp.status === 429) {
      var wait = (attempt + 1) * 15;
      addMsg('sys', '⏳ Rate limited. Waiting ' + wait + 's…');
      await delay(wait * 1000);
      continue;
    }
    if (!resp.ok) { var t = await resp.text(); throw new Error(provider + ' ' + resp.status + ': ' + t.slice(0, 200)); }
    var data = await resp.json();
    var out = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return out;
  }
  throw new Error('Rate limited. Wait 60s and try again.');
}

// ── Send Message ─────────────────────────────────────────────────────────────
async function doSend() {
  if (busy) return;
  var ui = document.getElementById('ui');
  var txt = ui.value.trim();
  if (!txt) return;
  if (!ollamaOk) { addMsg('sys', '⚠ Not connected. Click ⚙ → add key → Connect.'); return; }
  ui.value = ''; ui.style.height = 'auto';
  addMsg('user', txt);
  isCancelled = false;
  busy = true; 
  document.getElementById('sb').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'flex';
  setSt('busy', 'working…');
  try {
    var snap;
    try { snap = await getSnap(); }
    catch (e) { addMsg('sys', '⚠ Could not read page: ' + e.message); return; }
    if (agentMode === 'ctx') {
      await runContext(txt, snap);
    } else {
      await runAgent(txt, snap);
    }
  } catch (e) {
    addMsg('sys', '❌ ' + e.message);
  } finally {
    busy = false; 
    document.getElementById('sb').style.display = 'flex';
    document.getElementById('stopBtn').style.display = 'none';
    setSt('live', 'ready');
  }
}

// ── CONTEXT MODE — EXACT copy from original ──────────────────────────────────
async function runContext(userMsg, snap) {
  addThk();
  var msgs = Array.from(document.querySelectorAll('#chat .msg'));
  var chatHistory = msgs.map(function(m) {
    var role = m.querySelector('.mrole');
    var body = m.querySelector('.mbody');
    if (!role || !body) return null;
    var r = role.textContent.trim();
    var t = body.textContent.trim();
    if (!t || t.length < 2) return null;
    return (r === 'YOU' ? 'User: ' : r === 'OLANGA' ? 'Olanga: ' : '[' + r + ']: ') + t;
  }).filter(Boolean).join('\n---\n');

  var CTX_SYS = 'You are Olanga in Context mode. You can see the current page AND the full conversation history. ' +
    'Use the history to understand what has already happened and what the user knows. ' +
    'Answer the user concisely and helpfully. You cannot interact with the page.';

  var ctxUser =
    'CONVERSATION HISTORY:\n' + (chatHistory || '(none yet)') + '\n\n' +
    '--- CURRENT PAGE ---\n' + (snap.txt || '').slice(0, 3000) + '\n\n' +
    'INPUTS:\n' + buildInputList(snap.inp) + '\n\n' +
    'BUTTONS:\n' + buildBtnList(snap.btns) + '\n\n' +
    'LINKS:\n' + buildLinkList(snap.links) + '\n\n' +
    'USER: "' + userMsg + '"';

  var raw = '';
  try { raw = await callAI(CTX_SYS, ctxUser); } catch (e) { rmThk(); addMsg('sys', '❌ ' + e.message); return; }
  var elapsed = rmThk();
  addMsg('ai', raw.trim() + '\n⏱ ' + elapsed);
}

// ── FULL AGENT MODE ──────────────────────────────────────────────────────────
async function runAgent(userMsg, firstSnap) {
  var MAX_STEPS = 20;
  var startTime = Date.now();
  var stepN = 0;
  var callCount = 0;
  var lastActionStr = '';
  var repeatCount = 0;

  var EXEC_SYS =
    'You are a browser automation agent executing a user goal.\n' +
    'You receive the goal and the LIVE current page state. ' +
    'Your job is to move closer to the goal with each action, using only the available elements.\n\n' +
    'You MUST:\n' +
    '- Output exactly ONE action per response\n' +
    '- Only use idx numbers that appear in the current INPUTS, BUTTONS, or LINKS list\n' +
    '- VERY IMPORTANT: Output {"type":"done"} the moment the primary goal is achieved. DO NOT invent extra steps (like "submit" or "next") unless they are required to achieve the goal.\n\n' +
    'You MUST NOT:\n' +
    '- Invent idx numbers not in the INPUTS, BUTTONS, or LINKS list\n' +
    '- Repeat an action you just did on the same input if it is already FILLED/CHECKED\n\n' +
    'Output format: Start with a brief 1-2 sentence explanation wrapped in <reason> tags, then output ONE JSON action.\n' +
    'Actions: {"type":"fill","idx":N,"value":"text"} | {"type":"fill","idx":N,"checked":true} | ' +
    '{"type":"click","text":"label"} | {"type":"click","idx":N} | {"type":"clickLink","idx":N} | ' +
    '{"type":"scroll","amount":300} | {"type":"done"}';

  while (stepN < MAX_STEPS) {
    if (isCancelled) { addMsg('sys', '⏹ Terminated by user.'); break; }
    stepN++;
    var snap;
    try { snap = await getSnap(); } catch (e) { addMsg('sys', '⚠ Cannot read page: ' + e.message); break; }
    if (isCancelled) { addMsg('sys', '⏹ Terminated by user.'); break; }

    addThk();
    var execPrompt =
      'GOAL: "' + userMsg + '"\n\n' +
      'LIVE PAGE STATE (step ' + stepN + '):\n' +
      'PAGE TEXT:\n' + (snap.txt || '').slice(0, 3000) + '\n\n' +
      'INPUTS:\n' + buildInputList(snap.inp) + '\n\n' +
      'BUTTONS:\n' + buildBtnList(snap.btns) + '\n\n' +
      'LINKS:\n' + buildLinkList(snap.links) + '\n\n' +
      'What is your reasoning, and what is your ONE action to take next?';

    var raw = '';
    try { raw = await callAI(EXEC_SYS, execPrompt); callCount++; } catch (e) { rmThk(); addMsg('sys', '❌ ' + e.message); break; }
    var elapsed = rmThk();
    await delay(1500);

    var action = parseAction(raw);
    var reasoningMatch = raw.match(/<reason>([\s\S]*?)<\/reason>/i);
    var reasoning = reasoningMatch ? reasoningMatch[1].trim() : raw.replace(/```[\s\S]*?```/g, '').replace(/\{[^{}]*\}/g, '').trim().split('\n')[0];
    if (!reasoning) reasoning = 'Taking action...';

    if (!action) { addMsg('sys', '⚠ No action parsed:\n' + raw.slice(0, 200)); break; }

    var actionStr = JSON.stringify(action);
    if (actionStr === lastActionStr) {
      repeatCount++;
    } else {
      repeatCount = 0;
    }
    lastActionStr = actionStr;

    if (repeatCount >= 3) {
      addMsg('sys', '⚠ Breaking loop: AI has repeated the exact same action 3 times.');
      break;
    }

    if (isCancelled) { addMsg('sys', '⏹ Terminated by user.'); break; }

    if (action.type === 'done') {
      addMsg('ai', '✅ Done. (' + reasoning + ') ⏱' + elapsed);
      break;
    }

    addMsg('ai', 'Step ' + stepN + ': ' + reasoning + '\n⏱' + elapsed);
    var result = await execAction(action, snap);

    // After action, delay to allow page load settling
    if (action.type === 'click' || action.type === 'clickLink') {
      await delay(2000);
    } else if (action.type === 'fill') {
      await delay(1000);
    } else {
      await delay(500);
    }
  }

  if (stepN >= MAX_STEPS) addMsg('sys', '⚠ Hit ' + MAX_STEPS + '-step limit.');

  var secs = (((Date.now() - startTime) / 1000) | 0) + 's';
  addMsg('sys', '⏱ Finished: ' + secs + ' · ' + stepN + ' actions taken · ' + callCount + ' AI calls total');
}

var delay = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

// ── Event Listener Bindings ──────────────────────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', toggleSettings);
document.getElementById('addKeyBtn').addEventListener('click', addKey);
document.getElementById('removeKeyBtn').addEventListener('click', removeKey);
document.getElementById('keySel').addEventListener('change', switchKey);
document.getElementById('providerSel').addEventListener('change', updateModelList);
document.getElementById('connectBtn').addEventListener('click', saveAndCheck);
document.getElementById('clearBtn').addEventListener('click', clrChat);
document.getElementById('refreshTabBtn').addEventListener('click', connectToTab);
document.getElementById('sb').addEventListener('click', doSend);
document.getElementById('stopBtn').addEventListener('click', function() { isCancelled = true; setSt('busy', 'stopping…'); });

document.querySelectorAll('.mode-tab').forEach(function(btn) {
  btn.addEventListener('click', function() {
    setAgentMode(btn.dataset.mode);
  });
});

document.getElementById('ui').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
});
document.getElementById('ui').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 110) + 'px';
});
