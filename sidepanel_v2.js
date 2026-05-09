// Olanga v2.0 — Vision-Based Agent Logic
// Uses real screenshots + vision AI to see what the user sees
// Clicks and types at exact pixel coordinates
// This file is loaded alongside sidepanel.js but only activates when v2 mode is selected

(function() {

  // ── State ────────────────────────────────────────────────────────────────
  var v2Busy = false;
  var v2Cancelled = false;
  var v2ActiveTabId = null;

  // ── Expose v2 interface to the main sidepanel ────────────────────────────
  window.OlangaV2 = {
    runContext: v2RunContext,
    runAgent: v2RunAgent,
    cancel: function() { v2Cancelled = true; },
    setBusy: function(b) { v2Busy = b; },
    setTabId: function(id) { v2ActiveTabId = id; }
  };

  // ── Screenshot Capture ───────────────────────────────────────────────────
  async function captureScreenshot() {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        { target: 'background', cmd: 'v2_screenshot', tabId: v2ActiveTabId },
        function(response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.ok) {
            resolve({ dataUrl: response.dataUrl, devicePixelRatio: response.devicePixelRatio || 1 });
          } else {
            reject(new Error(response ? response.err : 'Screenshot failed'));
          }
        }
      );
    });
  }

  // ── Get Page Info ────────────────────────────────────────────────────────
  async function getPageInfo() {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        { target: 'background', cmd: 'v2_pageinfo', tabId: v2ActiveTabId },
        function(response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response || {});
          }
        }
      );
    });
  }

  // ── Inject v2 content script ─────────────────────────────────────────────
  async function ensureV2Script() {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        { target: 'background', cmd: 'v2_inject', tabId: v2ActiveTabId },
        function(response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  // ── Execute v2 actions on the page ───────────────────────────────────────
  async function v2Exec(action) {
    await ensureV2Script();
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        { target: 'background', cmd: 'v2_exec', tabId: v2ActiveTabId, action: action },
        function(response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response || { ok: false, err: 'no response' });
          }
        }
      );
    });
  }

  // ── Vision AI Call (with key rotation support) ──────────────────────────
  async function callVisionAI(systemPrompt, userPrompt, screenshotDataUrl) {
    var provider = document.getElementById('providerSel').value;
    var model = document.getElementById('modelSel').value;
    var apiKey = window.getActiveApiKey ? window.getActiveApiKey() : '';

    if (!apiKey) throw new Error('No API key configured');

    // Build the messages with image
    var imageData = screenshotDataUrl.split(',')[1]; // base64 part
    var mimeType = 'image/png';

    var contents = [{
      role: 'user',
      parts: [
        { text: systemPrompt + '\n\n' + userPrompt },
        { inline_data: { mime_type: mimeType, data: imageData } }
      ]
    }];

    var body = {
      contents: contents,
      generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
    };

    var keysTriedThisCall = 0;
    var rotationEnabled = window.isKeyRotationEnabled ? window.isKeyRotationEnabled() : false;
    var maxKeyAttempts = rotationEnabled ? (window.getSavedKeys ? window.getSavedKeys().length : 1) : 1;

    for (var attempt = 0; attempt < 3; attempt++) {
      // Refresh key in case it was rotated
      apiKey = window.getActiveApiKey ? window.getActiveApiKey() : apiKey;
      var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

      var resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (resp.status === 429) {
        // Try rotating to next key before waiting
        if (rotationEnabled && window.rotateKey && keysTriedThisCall < maxKeyAttempts - 1) {
          window.rotateKey();
          keysTriedThisCall++;
          continue; // retry immediately with new key
        }
        var wait = (attempt + 1) * 15;
        addMsg('sys', '\u23f3 Rate limited' + (rotationEnabled ? ' (all keys exhausted)' : '') + '. Waiting ' + wait + 's\u2026');
        await delay(wait * 1000);
        keysTriedThisCall = 0; // reset for next round
        continue;
      }

      if (!resp.ok) {
        var errText = await resp.text();
        throw new Error('Gemini ' + resp.status + ': ' + errText.slice(0, 200));
      }

      var data = await resp.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        var parts = data.candidates[0].content.parts;
        var text = parts.map(function(p) { return p.text || ''; }).join('');
        return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      }
      throw new Error('Unexpected Gemini response format');
    }
    throw new Error('Rate limited. Wait 60s and try again.');
  }

  // ── Parse v2 action from AI response ─────────────────────────────────────
  function parseV2Action(raw) {
    // Try fenced JSON
    var fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { var r = JSON.parse(fenced[1].trim()); return Array.isArray(r) ? r[0] : r; } catch (e) {}
    }
    // Try raw JSON object
    var m = raw.match(/\{[^{}]*"type"[^{}]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (e) {}
    }
    // Try more relaxed match
    var m2 = raw.match(/\{[\s\S]*?"type"\s*:\s*"[^"]+?"[\s\S]*?\}/);
    if (m2) {
      try { return JSON.parse(m2[0]); } catch (e) {}
    }
    return null;
  }

  // ── Context Mode (v2) ───────────────────────────────────────────────────
  async function v2RunContext(userMsg) {
    v2Cancelled = false;
    addThk();

    // Capture screenshot
    var screenshot;
    try {
      screenshot = await captureScreenshot();
    } catch (e) {
      rmThk();
      addMsg('sys', '\u26a0 Screenshot failed: ' + e.message);
      return;
    }

    var pageInfo;
    try { pageInfo = await getPageInfo(); } catch (e) { pageInfo = {}; }

    // Build conversation history
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

    var CTX_SYS = 'You are Olanga v2.0 in Context mode. You are looking at an actual screenshot of the user\'s browser. ' +
      'Use the screenshot to understand exactly what is on the page. ' +
      'Use the conversation history to understand what has already been discussed. ' +
      'Answer the user concisely and helpfully based on what you can actually see in the screenshot.';

    var ctxUser =
      'CONVERSATION HISTORY:\n' + (chatHistory || '(none yet)') + '\n\n' +
      'PAGE URL: ' + (pageInfo.url || 'unknown') + '\n' +
      'PAGE TITLE: ' + (pageInfo.title || 'unknown') + '\n' +
      'VIEWPORT: ' + (pageInfo.viewportWidth || '?') + 'x' + (pageInfo.viewportHeight || '?') + '\n\n' +
      'I am attaching a screenshot of the current browser page.\n\n' +
      'USER: "' + userMsg + '"';

    var raw = '';
    try {
      raw = await callVisionAI(CTX_SYS, ctxUser, screenshot.dataUrl);
    } catch (e) {
      rmThk();
      addMsg('sys', '\u274c ' + e.message);
      return;
    }

    var elapsed = rmThk();
    addMsg('ai', raw.trim() + '\n\u23f1 ' + elapsed);
  }

  // ── Full Agent Mode (v2) \u2014 Vision + Coordinate Actions ──────────────────
  async function v2RunAgent(userMsg) {
    v2Cancelled = false;
    var MAX_STEPS = 20;
    var startTime = Date.now();
    var stepN = 0;
    var callCount = 0;
    var lastActionStr = '';
    var repeatCount = 0;
    var currentDpr = 1;

    // Get initial page info
    var pageInfo;
    try { pageInfo = await getPageInfo(); } catch (e) { pageInfo = { viewportWidth: 1280, viewportHeight: 720 }; }

    while (stepN < MAX_STEPS) {
      if (v2Cancelled) { addMsg('sys', '\u23f9 Terminated by user.'); break; }
      stepN++;

      // Capture fresh screenshot
      var screenshot;
      try {
        screenshot = await captureScreenshot();
        currentDpr = screenshot.devicePixelRatio || 1;
      } catch (e) {
        addMsg('sys', '\u26a0 Screenshot failed: ' + e.message);
        break;
      }

      // Refresh page info
      try { pageInfo = await getPageInfo(); } catch (e) {}

      if (v2Cancelled) { addMsg('sys', '\u23f9 Terminated by user.'); break; }

      // Build system prompt with current DPR and viewport dimensions
      var EXEC_SYS =
        'You are Olanga v2.0, a vision-based browser automation agent.\n' +
        'You receive the user\'s goal and a REAL SCREENSHOT of the current browser page.\n' +
        'You MUST look at the screenshot image carefully to understand what is on screen.\n\n' +
        'COORDINATE SYSTEM \u2014 READ CAREFULLY:\n' +
        '- The screenshot image is ' + Math.round((pageInfo.viewportWidth || 1280) * currentDpr) + ' \u00d7 ' + Math.round((pageInfo.viewportHeight || 720) * currentDpr) + ' pixels.\n' +
        '- Your coordinates MUST be in IMAGE PIXEL space (i.e. relative to the screenshot image dimensions above).\n' +
        '- A faint red dashed coordinate grid with labels every 100px is overlaid on the screenshot to help you pinpoint locations.\n' +
        '- Coordinates (0, 0) is the top-left corner of the image.\n\n' +
        'ABSOLUTE RULES \u2014 VIOLATION MEANS FAILURE:\n' +
        '1. You MUST perform real actions. NEVER say "done" unless you have ALREADY performed all required actions in previous steps and can visually confirm the result in the screenshot.\n' +
        '2. You can ONLY see what is in the screenshot image. Do NOT reference DOM indices, element IDs, or any internal page structure \u2014 you cannot see those.\n' +
        '3. Provide EXACT pixel coordinates (x, y) in image-pixel space. Use the red grid overlay for precision.\n' +
        '4. Output exactly ONE action per response.\n' +
        '5. To type text into a field or document: first click on it with {"type":"click"}, then in the NEXT step use {"type":"type"} to enter the text.\n' +
        '6. NEVER hallucinate or assume actions have been taken. If the screenshot does not show your action\'s result, the action has NOT happened yet.\n' +
        '7. NEVER claim text is already typed or a button already clicked unless you can VISUALLY SEE the evidence in the current screenshot.\n' +
        '8. CRITICAL: If you clicked on a text field or document in the previous step, ASSUME it is now focused even if you do not see a blinking cursor (cursors blink and may not appear in the screenshot). Proceed to type immediately in the next step without clicking again.\n\n' +
        'OUTPUT FORMAT:\n' +
        'First, describe what you ACTUALLY SEE in the screenshot in 1-2 sentences wrapped in <reason> tags.\n' +
        'Then output ONE JSON action:\n\n' +
        'Available actions:\n' +
        '{"type":"click","x":N,"y":N} \u2014 Click at exact pixel coordinates (in image-pixel space)\n' +
        '{"type":"type","text":"..."} \u2014 Type text into the currently focused/clicked element\n' +
        '{"type":"key","key":"Enter"} \u2014 Press a key (Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, Space)\n' +
        '{"type":"scroll","direction":"down","amount":400} \u2014 Scroll the page\n' +
        '{"type":"done"} \u2014 ONLY when you can visually confirm in the screenshot that the goal is fully achieved\n\n' +
        'WORKFLOW EXAMPLE \u2014 typing "hello" into a search box:\n' +
        'Step 1: <reason>I see a search box at approximately (500, 300). I will click on it to focus it.</reason>\n{"type":"click","x":500,"y":300}\n' +
        'Step 2: <reason>I clicked the search box previously. I will assume it is focused and type the text.</reason>\n{"type":"type","text":"hello"}\n' +
        'Step 3: <reason>I can see "hello" is now typed in the search box. The goal is complete.</reason>\n{"type":"done"}';

      addThk();

      var execPrompt =
        'GOAL: "' + userMsg + '"\n\n' +
        'STEP: ' + stepN + ' of ' + MAX_STEPS + '\n' +
        'PAGE URL: ' + (pageInfo.url || 'unknown') + '\n' +
        'PAGE TITLE: ' + (pageInfo.title || 'unknown') + '\n' +
        'VIEWPORT: ' + (pageInfo.viewportWidth || '?') + 'x' + (pageInfo.viewportHeight || '?') + '\n' +
        'SCROLL POSITION: ' + (pageInfo.scrollY || 0) + 'px from top\n\n' +
        'IMPORTANT: The attached screenshot shows EXACTLY what is on screen right now. ' +
        (stepN === 1 ? 'This is the FIRST step \u2014 NO actions have been taken yet. You must start working toward the goal.' : 'Look at the screenshot to verify the result of previous actions before deciding next steps.\n\nPREVIOUS ACTION YOU TOOK: ' + (lastActionStr || 'None')) +
        '\n\nDescribe what you see, then give your ONE action.';

      var raw = '';
      try {
        raw = await callVisionAI(EXEC_SYS, execPrompt, screenshot.dataUrl);
        callCount++;
      } catch (e) {
        rmThk();
        addMsg('sys', '\u274c ' + e.message);
        break;
      }

      var elapsed = rmThk();
      await delay(800);

      // Parse action
      var action = parseV2Action(raw);
      var reasoningMatch = raw.match(/<reason>([\s\S]*?)<\/reason>/i);
      var reasoning = reasoningMatch ? reasoningMatch[1].trim() :
        raw.replace(/```[\s\S]*?```/g, '').replace(/\{[^{}]*\}/g, '').trim().split('\n')[0];
      if (!reasoning) reasoning = 'Taking action...';

      if (!action) {
        addMsg('sys', '\u26a0 No action parsed:\n' + raw.slice(0, 300));
        break;
      }

      // Repeat detection
      var actionStr = JSON.stringify(action);
      if (actionStr === lastActionStr) {
        repeatCount++;
      } else {
        repeatCount = 0;
      }
      lastActionStr = actionStr;

      if (repeatCount >= 3) {
        addMsg('sys', '\u26a0 Breaking loop: same action repeated 3 times.');
        break;
      }

      if (v2Cancelled) { addMsg('sys', '\u23f9 Terminated by user.'); break; }

      // Handle done
      if (action.type === 'done') {
        addMsg('ai', '\u2705 Done. (' + reasoning + ') \u23f1' + elapsed);
        break;
      }

      // Show step
      var actionLabel = action.type;
      if (action.type === 'click') actionLabel = 'click (' + action.x + ',' + action.y + ')';
      else if (action.type === 'type') actionLabel = 'type "' + (action.text || '').slice(0, 30) + '"' + (action.x ? ' at (' + action.x + ',' + action.y + ')' : '');
      else if (action.type === 'key') actionLabel = 'press ' + action.key;
      else if (action.type === 'scroll') actionLabel = 'scroll ' + (action.direction || 'down');

      addMsg('ai', 'Step ' + stepN + ': ' + reasoning + '\n\u2192 ' + actionLabel + '\n\u23f1' + elapsed);

      // Execute action \u2014 scale coordinates from image-pixel space to CSS-pixel space
      var result;
      try {
        if (action.type === 'click') {
          var cssX = Math.round(action.x / currentDpr);
          var cssY = Math.round(action.y / currentDpr);
          result = await v2Exec({ type: 'OLANGA_V2_CLICK', x: cssX, y: cssY });
        } else if (action.type === 'type') {
          var typeX = action.x !== undefined ? Math.round(action.x / currentDpr) : undefined;
          var typeY = action.y !== undefined ? Math.round(action.y / currentDpr) : undefined;
          result = await v2Exec({ type: 'OLANGA_V2_TYPE', text: action.text, x: typeX, y: typeY });
        } else if (action.type === 'key') {
          result = await v2Exec({ type: 'OLANGA_V2_KEY', key: action.key });
        } else if (action.type === 'scroll') {
          result = await v2Exec({ type: 'OLANGA_V2_SCROLL', direction: action.direction || 'down', amount: action.amount || 400 });
        } else {
          addMsg('sys', '\u26a0 Unknown action type: ' + action.type);
          continue;
        }

        if (result && result.ok) {
          var detail = '';
          if (result.element) detail = ' \u2192 ' + result.element;
          if (result.text) detail += ' "' + result.text.slice(0, 30) + '"';
          addMsg('sys', '\u2713 ' + actionLabel + detail);
        } else {
          addMsg('sys', '\u26a0 ' + actionLabel + ' \u2014 ' + (result ? result.err : 'failed'));
        }
      } catch (e) {
        addMsg('sys', '\u26a0 ' + e.message);
      }

      // Wait for page to settle after actions
      if (action.type === 'click') {
        await delay(2000);
      } else if (action.type === 'type') {
        await delay(1000);
      } else {
        await delay(500);
      }
    }

    if (stepN >= MAX_STEPS) addMsg('sys', '\u26a0 Hit ' + MAX_STEPS + '-step limit.');

    // Detach debugger at end of agent run
    try {
      chrome.runtime.sendMessage({ target: 'background', cmd: 'v2_detach', tabId: v2ActiveTabId });
    } catch (e) {}

    var secs = (((Date.now() - startTime) / 1000) | 0) + 's';
    addMsg('sys', '\u23f1 Finished: ' + secs + ' \u00b7 ' + stepN + ' actions \u00b7 ' + callCount + ' AI calls');
  }

  // ── Helpers (use shared functions from sidepanel.js) ─────────────────────
  var delay = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

})();
