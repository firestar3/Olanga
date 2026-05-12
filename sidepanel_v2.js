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

  // ── Get actual image dimensions (for coordinate scaling) ─────────────────
  // captureVisibleTab returns images at native device resolution (e.g. 2x on HiDPI).
  // Instead of resizing, we measure the real image dimensions and scale coordinates.
  async function getImageDimensions(dataUrl) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function() {
        resolve(null);
      };
      img.src = dataUrl;
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
    var mimeType = screenshotDataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';

    var contents = [{
      role: 'user',
      parts: [
        { text: systemPrompt + '\n\n' + userPrompt },
        { inline_data: { mime_type: mimeType, data: imageData } }
      ]
    }];

    var body = {
      contents: contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
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

    var vw = pageInfo.viewportWidth || 1280;
    var vh = pageInfo.viewportHeight || 720;
    var imageForAI = screenshot.dataUrl; // Send original screenshot

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
      'VIEWPORT: ' + vw + 'x' + vh + '\n\n' +
      'I am attaching a screenshot of the current browser page.\n\n' +
      'USER: "' + userMsg + '"';

    var raw = '';
    try {
      raw = await callVisionAI(CTX_SYS, ctxUser, imageForAI);
    } catch (e) {
      rmThk();
      addMsg('sys', '\u274c ' + e.message);
      return;
    }

    var elapsed = rmThk();
    addMsg('ai', raw.trim() + '\n\u23f1 ' + elapsed);
  }

  // ── Full Agent Mode (v2) — Vision + Coordinate Actions ──────────────────
  async function v2RunAgent(userMsg) {
    v2Cancelled = false;
    var MAX_STEPS = 30;
    var startTime = Date.now();
    var stepN = 0;
    var callCount = 0;
    var lastActionStr = '';
    var repeatCount = 0;
    var actionHistory = []; // Cumulative history of all steps taken

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
      } catch (e) {
        addMsg('sys', '\u26a0 Screenshot failed: ' + e.message);
        break;
      }

      // Refresh page info
      try { pageInfo = await getPageInfo(); } catch (e) {}

      // Get viewport CSS dimensions and actual image dimensions for coordinate scaling
      var vw = pageInfo.viewportWidth || 1280;
      var vh = pageInfo.viewportHeight || 720;
      var imageForAI = screenshot.dataUrl; // Send original hi-res screenshot
      var imgDims = await getImageDimensions(screenshot.dataUrl);
      var imgW = imgDims ? imgDims.width : vw;
      var imgH = imgDims ? imgDims.height : vh;
      var scaleX = vw / imgW; // Will be ~0.5 on 2x DPR displays, 1.0 on 1x
      var scaleY = vh / imgH;

      if (v2Cancelled) { addMsg('sys', '\u23f9 Terminated by user.'); break; }

      // Build system prompt — image dimensions now exactly match CSS coordinate space
      var EXEC_SYS =
        'You are Olanga v2.0, an expert vision-based browser automation agent. You control a real browser by examining screenshots and issuing precise actions.\n' +
        'You receive the user\'s goal, a REAL SCREENSHOT of the current page, and a full history of actions you have already taken.\n' +
        'You MUST examine the screenshot carefully before every action.\n\n' +
        'COORDINATE SYSTEM:\n' +
        '- The screenshot image is EXACTLY ' + imgW + ' \u00d7 ' + imgH + ' pixels. Pixel (0,0)=top-left, (' + (imgW-1) + ',' + (imgH-1) + ')=bottom-right.\n' +
        '- Image pixel coordinates map 1:1 to where clicks land on the page.\n' +
        '- PRECISION: mentally divide the image into quadrants, then narrow down. A button 1/4 from the left = x\u2248' + Math.round(imgW/4) + '.\n\n' +
        'MULTI-STEP WORKFLOW STRATEGY (CRITICAL FOR COMPLEX TASKS):\n' +
        '- PLAN AHEAD: Before acting, think about ALL the steps needed to complete the goal from the current state. State your plan in the <reason> tags.\n' +
        '- TRACK PROGRESS: Review the ACTION HISTORY to understand what has already been done. Do NOT repeat completed steps.\n' +
        '- VERIFY BEFORE PROCEEDING: After each action, the next screenshot will show the result. Check if your action succeeded before moving on.\n' +
        '- HANDLE LOADING STATES: If a dialog, dropdown, or page is still loading (spinner visible, content not yet appeared), use {"type":"wait"} to pause and check again.\n' +
        '- HANDLE DIALOGS/MODALS: When a modal or dialog appears, interact with elements INSIDE the dialog. The background page is not clickable.\n' +
        '- HANDLE DROPDOWNS: After clicking a dropdown, wait for the menu to appear, then click the desired option. Dropdown options may appear as a floating list.\n' +
        '- IF AN ACTION FAILED: If the screenshot shows your action had no effect, try a different approach (different coordinates, different element, or try scrolling to reveal the target).\n' +
        '- NEVER GIVE UP: If one approach doesn\'t work, try an alternative. Use keyboard shortcuts when clicking is unreliable.\n\n' +
        'RULES:\n' +
        '1. Output exactly ONE action per response.\n' +
        '2. NEVER say "done" unless you can VISUALLY CONFIRM the goal is fully achieved in the current screenshot.\n' +
        '3. Do NOT reference DOM, element IDs, or page internals \u2014 you can only see the screenshot.\n' +
        '4. After clicking a text field, it is FOCUSED. Next step: use {"type":"type","text":"..."} WITHOUT coordinates.\n' +
        '5. For complex apps (Google Docs, Sheets, etc.), prefer keyboard shortcuts over tiny toolbar buttons.\n' +
        '6. ALWAYS CLICK VISIBLE BUTTONS: When you see a button on screen (Send, Share, Done, OK, Submit), you MUST click it with click action. Do NOT press Enter as a substitute. Enter often does nothing or triggers the wrong action.\n' +
        '7. After typing in a field, look at the screen: if a suggestion dropdown appeared, CLICK it. If a button appeared, CLICK it. Do NOT just press Enter.\n' +
        '8. If you see a confirmation dialog, CLICK the confirm button. Do not press Enter.\n\n' +
        'OUTPUT FORMAT:\n' +
        '<reason>\n1. What I see in the screenshot right now.\n2. What has been done so far (from action history).\n3. What still needs to be done to achieve the goal.\n4. What specific action I will take next and why.\n</reason>\n' +
        'Then ONE JSON action:\n\n' +
        'Available actions:\n' +
        '{"type":"click","x":N,"y":N} \u2014 Click the exact center of an element (PREFERRED for all buttons!)\n' +
        '{"type":"type","text":"..."} \u2014 Type text (field must already be focused from a prior click)\n' +
        '{"type":"key","key":"a","modifiers":["Control"]} \u2014 Press a key (ONLY for keyboard shortcuts like Ctrl+A, NOT for clicking buttons!)\n' +
        '{"type":"highlight","startX":N,"startY":N,"endX":N,"endY":N} \u2014 Click-drag to select text\n' +
        '{"type":"scroll","direction":"down","amount":400} \u2014 Scroll the page\n' +
        '{"type":"wait"} \u2014 Wait 2 seconds for loading/animations, then re-examine\n' +
        '{"type":"done"} \u2014 Goal is fully achieved (MUST be visually confirmed)\n\n' +
        'COMPLEX TASK EXAMPLE \u2014 sharing a Google Doc with user@gmail.com:\n' +
        'Step 1: <reason>I see a Google Doc. To share it, I need to click the blue "Share" button in the top-right area. I see it at approximately (' + Math.round(vw * 0.88) + ', 25). Remaining: click Share \u2192 type email \u2192 set permissions \u2192 click Send.</reason>\n{"type":"click","x":' + Math.round(vw * 0.88) + ',"y":25}\n' +
        'Step 2: <reason>The Share dialog has appeared. I can see a text field that says "Add people, groups, and calendar events". I will click on it to focus it. Remaining: type email \u2192 set permissions \u2192 click Send.</reason>\n{"type":"click","x":' + Math.round(vw * 0.5) + ',"y":' + Math.round(vh * 0.4) + '}\n' +
        'Step 3: <reason>The email input field is now focused (I can see a cursor/highlight). I will type the email address. Remaining: confirm email \u2192 set permissions \u2192 click Send.</reason>\n{"type":"type","text":"user@gmail.com"}\n' +
        'Step 4: <reason>I typed the email. A suggestion dropdown appeared showing the email. I will CLICK the suggestion to confirm (NOT press Enter). Remaining: click Send.</reason>\n{"type":"click","x":' + Math.round(vw * 0.5) + ',"y":' + Math.round(vh * 0.48) + '}\n' +
        'Step 5: <reason>The email has been added as a recipient. I can see the user listed. Now I need to click the "Send" or "Share" button to complete sharing. I see it at the bottom-right of the dialog.</reason>\n{"type":"click","x":' + Math.round(vw * 0.62) + ',"y":' + Math.round(vh * 0.65) + '}\n' +
        'Step 6: <reason>I can see a confirmation or the dialog has closed. The document has been shared successfully. The goal is complete.</reason>\n{"type":"done"}';

      addThk();

      // Build action history string
      var historyStr = actionHistory.length > 0
        ? actionHistory.map(function(h, i) { return 'Step ' + (i + 1) + ': ' + h; }).join('\n')
        : '(none yet \u2014 this is the first step)';

      var execPrompt =
        'GOAL: "' + userMsg + '"\n\n' +
        'STEP: ' + stepN + ' of ' + MAX_STEPS + '\n' +
        'PAGE URL: ' + (pageInfo.url || 'unknown') + '\n' +
        'PAGE TITLE: ' + (pageInfo.title || 'unknown') + '\n' +
        'IMAGE SIZE: ' + imgW + 'x' + imgH + ' pixels (coordinates must be within 0 to ' + (imgW-1) + ' for x, 0 to ' + (imgH-1) + ' for y)\n' +
        'SCROLL POSITION: ' + (pageInfo.scrollY || 0) + 'px from top\n\n' +
        'ACTION HISTORY (what you have done so far):\n' + historyStr + '\n\n' +
        'CURRENT SCREENSHOT: The attached image shows EXACTLY what the browser looks like RIGHT NOW, AFTER all previous actions.\n' +
        (stepN === 1
          ? 'This is the FIRST step. No actions have been taken yet. Plan the full workflow, then take the first action.'
          : 'Examine the screenshot to verify if your last action (Step ' + (stepN - 1) + ') succeeded. Then decide what to do next.') +
        '\n\nThink step-by-step in <reason> tags, then output your ONE action.';

      var raw = '';
      try {
        raw = await callVisionAI(EXEC_SYS, execPrompt, imageForAI);
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

      // Block bare Enter key — AI must click buttons instead
      if (action.type === 'key' && action.key === 'Enter' && (!action.modifiers || action.modifiers.length === 0)) {
        addMsg('sys', '\u26a0 Blocked bare Enter. You must CLICK buttons, not press Enter. Retrying...');
        actionHistory.push('BLOCKED: tried to press Enter (must click buttons instead)');
        continue;
      }

      // Scale coordinates from image pixel space to CSS space
      if (action.x !== undefined) { action.x = Math.round(action.x * scaleX); }
      if (action.y !== undefined) { action.y = Math.round(action.y * scaleY); }
      if (action.startX !== undefined) { action.startX = Math.round(action.startX * scaleX); }
      if (action.startY !== undefined) { action.startY = Math.round(action.startY * scaleY); }
      if (action.endX !== undefined) { action.endX = Math.round(action.endX * scaleX); }
      if (action.endY !== undefined) { action.endY = Math.round(action.endY * scaleY); }

      // Handle done
      if (action.type === 'done') {
        addMsg('ai', '\u2705 Done. (' + reasoning + ') \u23f1' + elapsed);
        break;
      }

      // Show step
      var actionLabel = action.type;
      if (action.type === 'click') actionLabel = 'click (' + action.x + ',' + action.y + ')';
      else if (action.type === 'highlight') actionLabel = 'highlight (' + action.startX + ',' + action.startY + ') to (' + action.endX + ',' + action.endY + ')';
      else if (action.type === 'type') actionLabel = 'type "' + (action.text || '').slice(0, 30) + '"' + (action.x !== undefined ? ' at (' + action.x + ',' + action.y + ')' : '');
      else if (action.type === 'key') actionLabel = 'press ' + (action.modifiers ? action.modifiers.join('+') + '+' : '') + action.key;
      else if (action.type === 'scroll') actionLabel = 'scroll ' + (action.direction || 'down');

      addMsg('ai', 'Step ' + stepN + ': ' + reasoning + '\n\u2192 ' + actionLabel + '\n\u23f1' + elapsed);

      // Accumulate action history for next iteration
      actionHistory.push(actionLabel + (reasoning !== 'Taking action...' ? ' — ' + reasoning.slice(0, 80) : ''));

      // Coordinates come directly from the AI — no tag ID resolution needed

      // Handle wait action (no execution needed, just pause)
      if (action.type === 'wait') {
        addMsg('sys', '\u23f3 Waiting 2s for page to settle...');
        await delay(2000);
        continue;
      }

      // Execute action — coordinates are already in CSS space
      var result;
      try {
        if (action.type === 'click') {
          result = await v2Exec({ type: 'OLANGA_V2_CLICK', x: action.x, y: action.y });
        } else if (action.type === 'highlight') {
          result = await v2Exec({ type: 'OLANGA_V2_HIGHLIGHT', startX: action.startX, startY: action.startY, endX: action.endX, endY: action.endY });
        } else if (action.type === 'type') {
          result = await v2Exec({ type: 'OLANGA_V2_TYPE', text: action.text, x: action.x, y: action.y });
        } else if (action.type === 'key') {
          result = await v2Exec({ type: 'OLANGA_V2_KEY', key: action.key, modifiers: action.modifiers });
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
        await delay(1500);
      } else if (action.type === 'type') {
        await delay(800);
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
