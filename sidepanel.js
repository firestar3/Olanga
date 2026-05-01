
let html0=null, fname0=null, busy=false, cbs={}, cbN=0;
let ollamaOk=false;
let groqKey='';
let timerInterval=null;
let agentMode='view'; // 'view', 'ctx', or 'full'
let sourceMode='file'; // 'file' or 'tab'
let activeTabId=null;

// Multi-key management
let savedKeys=JSON.parse(localStorage.getItem('olanga_keys')||'[]');

function renderKeySel(){
  const sel=document.getElementById('keySel');
  sel.innerHTML='';
  if(!savedKeys.length){
    sel.innerHTML='<option value="">no keys saved</option>';
    return;
  }
  savedKeys.forEach(function(k,i){
    const opt=document.createElement('option');
    opt.value=k;
    opt.textContent='key '+(i+1)+': …'+k.slice(-6);
    sel.appendChild(opt);
  });
  // auto-select first
  sel.value=savedKeys[0];
  groqKey=savedKeys[0];
}

function addKey(){
  const inp=document.getElementById('groqKeyInput');
  // Strip non-ASCII chars that break HTTP headers (smart quotes, em-dashes, etc.)
  const val=inp.value.trim().replace(/[^ -~]/g,'');
  if(!val){addMsg('sys','⚠ Please enter an API key.');return;}
  if(savedKeys.includes(val)){addMsg('sys','⚠ Key already saved.');return;}
  savedKeys.push(val);
  localStorage.setItem('olanga_keys',JSON.stringify(savedKeys));
  inp.value='';
  renderKeySel();
  document.getElementById('keySel').value=val;
  groqKey=val;
  addMsg('sys','🔑 Key added ('+savedKeys.length+' total). Click Connect to verify.');
}

function removeKey(){
  const sel=document.getElementById('keySel');
  const val=sel.value;
  if(!val){return;}
  savedKeys=savedKeys.filter(function(k){return k!==val;});
  localStorage.setItem('olanga_keys',JSON.stringify(savedKeys));
  groqKey=savedKeys[0]||'';
  renderKeySel();
  addMsg('sys','🗑 Key removed.');
}

function switchKey(){
  const val=document.getElementById('keySel').value;
  if(val){groqKey=val;addMsg('sys','🔑 Switched to …'+val.slice(-6));}
}

const BRIDGE=`<scr`+`ipt>
(function(){
  function snap(){
    var inp=[];
    document.querySelectorAll('input,textarea,select').forEach(function(el,i){
      var lbl=null;
      if(el.id){var l=document.querySelector('label[for="'+el.id+'"]');if(l)lbl=l.innerText.trim();}
      if(!lbl){var p=el.closest('label');if(p)lbl=p.innerText.trim();}
      if(!lbl){var pv=el.previousElementSibling;if(pv)lbl=pv.innerText.trim().slice(0,80);}
      if(!lbl){var nx=el.nextElementSibling;if(nx)lbl=nx.innerText.trim().slice(0,80);}
      var opts;
      if(el.tagName==='SELECT')opts=Array.from(el.options).map(function(o){return{v:o.value,t:o.text};});
      inp.push({i:i,tag:el.tagName.toLowerCase(),type:el.type||null,
        name:el.name||null,id:el.id||null,ph:el.placeholder||null,val:el.value||null,
        chk:(el.type==='checkbox'||el.type==='radio')?el.checked:undefined,
        opts:opts,lbl:lbl});
    });
    var btns=[];
    document.querySelectorAll('button,input[type=submit],input[type=button],[role=button]').forEach(function(b,i){
      btns.push({i:i,txt:(b.innerText||b.value||'').trim().slice(0,60),id:b.id||null});
    });
    return{title:document.title,scrollY:window.scrollY,sh:document.body?document.body.scrollHeight:0,
      inp:inp,btns:btns,txt:document.body?document.body.innerText.slice(0,5000):''};
  }
  function fi(a){
    var all=document.querySelectorAll('input,textarea,select');
    if(a.idx!==undefined&&a.idx!==null&&all[a.idx])return all[a.idx];
    if(a.id&&a.id!=='undefined')return document.getElementById(a.id);
    if(a.name&&a.name!=='undefined')return document.querySelector('[name="'+a.name+'"]');
    return null;
  }
  function exec(a){
    try{
      if(a.type==='scroll'){window.scrollBy({top:a.amount||300,behavior:'smooth'});return{ok:true};}
      if(a.type==='scrollTo'){window.scrollTo({top:a.y||0,behavior:'smooth'});return{ok:true};}
      if(a.type==='fill'){
        var el=fi(a);
        if(!el)return{ok:false,err:'not found'};
        if(el.tagName==='SELECT'){
          var op=Array.from(el.options).find(function(o){return o.value===a.value||o.text.trim()===a.value;});
          if(op)el.value=op.value;
        }else if(el.type==='radio'||el.type==='checkbox'){
          el.checked=a.checked!==undefined?a.checked:true;
        }else{
          el.value=a.value||'';
        }
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return{ok:true};
      }
      if(a.type==='click'){
        var bs=document.querySelectorAll('button,input[type=submit],input[type=button],[role=button]'),b=null;
        if(a.idx!==undefined&&a.idx!==null)b=bs[a.idx];
        if(!b&&a.text)b=Array.from(bs).find(function(x){return(x.innerText||x.value||'').toLowerCase().includes(a.text.toLowerCase());});
        if(!b&&a.id)b=document.getElementById(a.id);
        if(!b)return{ok:false,err:'button not found'};
        b.click();return{ok:true};
      }
      if(a.type==='highlight'){
        var el2=fi(a);
        if(el2){el2.style.outline='3px solid #a78bfa';setTimeout(function(){el2.style.outline='';},2500);}
        return{ok:true};
      }
      return{ok:false,err:'unknown: '+a.type};
    }catch(e){return{ok:false,err:e.message};}
  }
  window.addEventListener('message',function(e){
    if(!e.data||e.data.oqc!==true)return;
    var r;
    if(e.data.cmd==='snap')r=snap();
    else if(e.data.cmd==='exec')r=exec(e.data.action);
    else r={err:'unknown'};
    window.parent.postMessage({oqc:true,id:e.data.id,result:r},'*');
  });
  window.parent.postMessage({oqc:true,cmd:'ready'},'*');
})();
<\/scr`+`ipt>`;

window.addEventListener('message',function(e){
  if(!e.data||e.data.oqc!==true)return;
  if(e.data.cmd==='ready')setSt('live','bridge active — ready');
  if(e.data.id!==undefined&&cbs[e.data.id]){
    cbs[e.data.id](e.data.result);
    delete cbs[e.data.id];
  }
});

function saveAndCheck(){
  // If there's a key in the input field, add it first
  const inp=document.getElementById('groqKeyInput');
  if(inp&&inp.value.trim().startsWith('gsk_'))addKey();
  // Use currently selected key
  const sel=document.getElementById('keySel');
  if(sel&&sel.value)groqKey=sel.value;
  checkGroq();
}

async function checkGroq(){
  if(!groqKey){ setSt('err','no key'); addMsg('sys','⚠ Enter an API key and click Connect.\nGroq: console.groq.com\nOpenRouter: openrouter.ai'); return; }
  setSt('','connecting…');
  const provider=document.getElementById('providerSel').value;
  const testUrl=provider==='openrouter'
    ?'https://openrouter.ai/api/v1/models'
    :'https://api.groq.com/openai/v1/models';
  try{
    const r=await fetch(testUrl,{headers:{'Authorization':'Bearer '+groqKey}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    ollamaOk=true;
    const model=document.getElementById('modelSel').value;
    setSt('live',provider+' connected');
    addMsg('sys','✓ Connected via '+provider+'! Model: '+model+'\nHi, I am Olanga. Load a file and tell me what to do.');
    // For OpenRouter: fetch live free model list
    if(provider==='openrouter'){
      fetch('https://openrouter.ai/api/v1/models?supported_parameters=temperature',{
        headers:{'Authorization':'Bearer '+groqKey}
      }).then(function(r){return r.json();}).then(function(d){
        const free=(d.data||[]).filter(function(m){
          return m.pricing&&(m.pricing.prompt===0||m.pricing.prompt==='0');
        }).sort(function(a,b){return a.name.localeCompare(b.name);});
        if(!free.length)return;
        const sel=document.getElementById('modelSel');
        sel.innerHTML='';
        // Always keep auto-router first
        const auto=document.createElement('option');
        auto.value='openrouter/free';auto.textContent='Auto (best free model)';
        sel.appendChild(auto);
        free.forEach(function(m){
          const o=document.createElement('option');
          o.value=m.id;
          o.textContent=m.name+(m.context_length?' ('+Math.round(m.context_length/1000)+'k ctx)':'');
          sel.appendChild(o);
        });
        addMsg('sys','Loaded '+free.length+' free models from OpenRouter.');
      }).catch(function(){});
    }
  }catch(e){
    ollamaOk=false;
    setSt('err','connection failed');
    addMsg('sys','❌ Could not connect to Groq: '+e.message+'\n\nMake sure:\n1. Your key starts with gsk_\n2. You got it from console.groq.com\n3. This page is open via localhost:8080');
  }
}

document.getElementById('fi').addEventListener('change',e=>{if(e.target.files[0])loadF(e.target.files[0]);});
const dz=document.getElementById('dz');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over');});
dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('over');if(e.dataTransfer.files[0])loadF(e.dataTransfer.files[0]);});

function loadF(f){
  if(!f.name.match(/\.html?$/i)){addMsg('sys','⚠ Load an .html file.');return;}
  document.getElementById('fn').textContent=f.name;
  const r=new FileReader();
  r.onload=e=>{fname0=f.name;html0=e.target.result;inject(html0,fname0);addMsg('sys','📂 '+f.name+' loaded.');};
  r.readAsText(f);
}

function inject(html,name){
  let doc=html;
  const bc=doc.search(/<\/body>/i);
  doc=bc!==-1?doc.slice(0,bc)+BRIDGE+doc.slice(bc):doc+BRIDGE;
  const fr=document.getElementById('qf');
  fr.srcdoc=doc;
  fr.style.display='block';
  document.getElementById('ph').style.display='none';
  document.getElementById('fbr').textContent=name||'file';
}

function reload(){if(html0){inject(html0,fname0);addMsg('sys','↺ Reloaded.');}}
function setSt(s,t){document.getElementById('sd').className='sdot'+(s?' '+s:'');document.getElementById('stxt').textContent=t||'';}
function clrChat(){document.getElementById('chat').innerHTML='';addMsg('sys','Chat cleared.');}

function setSource(mode){
  sourceMode=mode;
  document.getElementById('src-file').style.cssText='flex:1;font-size:10px;padding:3px 0;border-radius:4px;'+(mode==='file'?'background:var(--accent);color:#0e0e10;border-color:var(--accent);font-weight:500':'');
  document.getElementById('src-tab').style.cssText='flex:1;font-size:10px;padding:3px 0;border-radius:4px;'+(mode==='tab'?'background:var(--accent);color:#0e0e10;border-color:var(--accent);font-weight:500':'');
  document.getElementById('file-panel').style.display=mode==='file'?'':'none';
  document.getElementById('tab-panel').style.display=mode==='tab'?'':'none';
}

// Listen for connection event injected by the extension popup


// Also check if extension already set window.__olangaActiveTabId (page reload case)
function connectTab(){
  bgSend('GET_TAB', {}).then(function(tab) {
    if (!tab) { addMsg('sys','⚠ No active tab found. Click on a webpage tab first.'); return; }
    activeTabId = tab.id;
    document.getElementById('tab-url-display').textContent = (tab.url||'').slice(0,50);
    setSt('live','connected: '+(tab.title||tab.url||'').slice(0,30));
    addMsg('sys','✓ Connected to: '+(tab.title||tab.url||''));
  }).catch(function(e){ addMsg('sys','⚠ '+e.message); });
}

function setAgentMode(m){
  agentMode=m;
  const vb=document.getElementById('btn-view');
  const cb=document.getElementById('btn-ctx');
  const fb=document.getElementById('btn-full');
  const hint=document.getElementById('mode-hint');
  const ON='var(--accent)';const OFF='';
  // reset all
  [vb,cb,fb].forEach(function(b){b.style.background=OFF;b.style.color='';b.style.borderColor='';b.style.fontWeight='';});
  // activate selected
  const active=m==='view'?vb:m==='ctx'?cb:fb;
  active.style.background=ON;active.style.color='#0e0e10';active.style.borderColor=ON;active.style.fontWeight='500';
  hint.textContent=m==='view'?'read-only':m==='ctx'?'context':' edit mode';
}

function updateModelList(){
  const provider=document.getElementById('providerSel').value;
  const sel=document.getElementById('modelSel');
  sel.innerHTML='';
  const models=provider==='openrouter'?[
    ['openrouter/free','Auto (best free model)'],
    ['deepseek/deepseek-r1:free','DeepSeek R1 (free)'],
    ['deepseek/deepseek-r1-distill-llama-70b:free','DeepSeek R1 Llama 70B (free)'],
    ['meta-llama/llama-3.3-70b-instruct:free','Llama 3.3 70B (free)'],
    ['google/gemini-2.0-flash-exp:free','Gemini 2.0 Flash (free)'],
    ['google/gemma-3-27b-it:free','Gemma 3 27B (free)'],
  ]:[
    ['llama-3.3-70b-versatile','Llama 3.3 70B'],
    ['llama-3.1-8b-instant','Llama 3.1 8B (fast)'],
    ['mixtral-8x7b-32768','Mixtral 8x7B'],
    ['gemma2-9b-it','Gemma2 9B'],
  ];
  models.forEach(function(m){
    const o=document.createElement('option');
    o.value=m[0];o.textContent=m[1];sel.appendChild(o);
  });
  addMsg('sys','Switched to '+provider+'. Select a model and click Connect.');
}

// All comms go through the extension background script
function bgSend(type, payload) {
  return new Promise(function(res, rej) {
    const msg = Object.assign({ type }, payload);
    const t = setTimeout(function() { rej(new Error('Extension timeout')); }, 10000);
    chrome.runtime.sendMessage(msg, function(resp) {
      clearTimeout(t);
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res(resp);
    });
  });
}
const execA = function(a) { return bgSend('EXEC', { tabId: activeTabId, cmd: 'exec', action: a }); };

// Route snap/exec to iframe bridge or Chrome extension bridge
// Tab management
async function getActiveTab() {
  return bgSend('GET_TAB', {});
}

async function getSnap(){
  const snap1 = await bgSend('EXEC', { tabId: activeTabId, cmd: 'snap' });
  await delay(500);
  const snap2 = await bgSend('EXEC', { tabId: activeTabId, cmd: 'snap' });
  if ((snap1.txt||'').slice(0,200) !== (snap2.txt||'').slice(0,200)) {
    await delay(800);
    return await bgSend('EXEC', { tabId: activeTabId, cmd: 'snap' });
  }
  return snap2;
}

function addMsg(role,text,chips){
  const area=document.getElementById('chat');
  const d=document.createElement('div');d.className='msg '+role;
  const hdr=document.createElement('div');
  const rl=document.createElement('span');rl.className='mrole '+role;
  rl.textContent=role==='sys'?'SYSTEM':role==='ai'?'OLANGA':'YOU';
  hdr.appendChild(rl);d.appendChild(hdr);
  const b=document.createElement('div');b.className='mbody';b.textContent=text;d.appendChild(b);
  if(chips&&chips.length){
    const row=document.createElement('div');row.className='chips';
    chips.forEach(c=>{const ch=document.createElement('span');ch.className='chip';ch.textContent=c;row.appendChild(ch);});
    d.appendChild(row);
  }
  area.appendChild(d);area.scrollTop=area.scrollHeight;
  return b;
}

let thkEl=null, thkStart=null;
function addThk(){
  const area=document.getElementById('chat');
  const d=document.createElement('div');d.className='thk';d.id='thk';
  d.innerHTML='<div class="thkd"><span></span><span></span><span></span></div><span style="margin-left:2px">thinking</span><span class="timer" id="thktimer"> 0s</span>';
  area.appendChild(d);area.scrollTop=area.scrollHeight;
  thkStart=Date.now();
  timerInterval=setInterval(()=>{
    const el=document.getElementById('thktimer');
    if(el)el.textContent=' '+(((Date.now()-thkStart)/1000)|0)+'s';
  },500);
}
function rmThk(){
  clearInterval(timerInterval);
  const t=document.getElementById('thk');
  if(t){
    const elapsed=(((Date.now()-thkStart)/1000)|0)+'s';
    t.remove();
    return elapsed;
  }
  return '';
}

async function doSend(){
  if(busy)return;
  const ui=document.getElementById('ui');
  const txt=ui.value.trim();
  if(!txt)return;
  if(!ollamaOk){addMsg('sys','⚠ Olanga not connected.');return;}
  if(!html0&&sourceMode==='file'){addMsg('sys','⚠ Load a file first.');return;}
  if(!activeTabId&&sourceMode==='tab'){addMsg('sys','⚠ Connect a tab first (switch to Live Tab mode and click Connect Tab).');return;}
  ui.value='';ui.style.height='auto';
  addMsg('user',txt);
  busy=true;document.getElementById('sb').disabled=true;
  setSt('busy','working…');
  try{
    let snap;
    try{snap=await getSnap();}
    catch(e){addMsg('sys','⚠ Could not read page: '+e.message);return;}
    if(agentMode==='view'){
      await runViewer(txt,snap);
    } else if(agentMode==='ctx'){
      await runContext(txt,snap);
    } else {
      await runAgent(txt,snap);
    }
  }catch(e){
    addMsg('sys','❌ '+e.message);
  }finally{
    busy=false;document.getElementById('sb').disabled=false;
    setSt('live','ready');
  }
}

function buildInputList(inp){
  if(!inp||!inp.length)return'(none)';
  return inp.map(x=>{
    let d='['+x.i+'] '+x.tag+(x.type?'/'+x.type:'');
    if(x.lbl)d+=' label:"'+x.lbl+'"';
    if(x.name)d+=' name='+x.name;
    if(x.id)d+=' id='+x.id;
    if(x.val&&x.val!==x.ph)d+=' FILLED:"'+x.val+'"';
    if(x.chk===true)d+=' CHECKED';
    if(x.opts)d+=' opts:['+x.opts.map(o=>o.t+'='+o.v).join(', ')+']';
    return d;
  }).join('\n');
}

function buildBtnList(btns){
  if(!btns||!btns.length)return'(none)';
  return btns.map(b=>'['+b.i+'] "'+b.txt+'"').join('\n');
}

function tryParse(str){
  str=str.trim().replace(/'/g,'"').replace(/,\s*([}\]])/g,'$1');
  return JSON.parse(str);
}

function parseAction(raw){
  // Try fenced block
  const fenced=raw.match(/```[a-z]*\s*([\s\S]*?)```/i);
  if(fenced){try{const r=tryParse(fenced[1]);return Array.isArray(r)?r[0]:r;}catch(e){}}
  // Try JSON object anywhere in text
  const m=raw.match(/\{[^{}]*"type"[^{}]*\}/);
  if(m){try{return tryParse(m[0]);}catch(e){}}
  return null;
}

function validateAction(a,snap){
  if(!a)return false;
  const maxInp=Math.max(0,(snap.inp.length||1)-1);
  const maxBtn=Math.max(0,(snap.btns.length||1)-1);
  if((a.type==='fill'||a.type==='highlight')&&a.idx!==undefined){
    if(a.idx<0||a.idx>maxInp){addMsg('sys','⚠ invalid idx='+a.idx+' (max='+maxInp+')');return false;}
  }
  if(a.type==='click'&&a.idx!==undefined&&!a.text){
    if(a.idx<0||a.idx>maxBtn){addMsg('sys','⚠ invalid btn='+a.idx+' (max='+maxBtn+')');return false;}
  }
  return true;
}

async function execAction(a,snap){
  if(!validateAction(a,snap))return{ok:false,err:'invalid'};
  try{
    const r=await execA(a);
    const lbl=a.type==='fill'?'fill['+a.idx+']='+(a.value!==undefined?'"'+a.value+'"':'checked'):
              a.type==='click'?'click:"'+(a.text||'#'+a.idx)+'"':
              a.type;
    addMsg('sys',(r?.ok?'✓ ':'⚠ ')+lbl+(r?.ok?'':' — '+(r?.err||'failed')));
    return r||{ok:false};
  }catch(e){addMsg('sys','⚠ '+e.message);return{ok:false,err:e.message};}
}

async function callAI(system,user){
  const model=document.getElementById('modelSel').value;
  const provider=document.getElementById('providerSel').value;
  const endpoint=provider==='openrouter'
    ?'https://openrouter.ai/api/v1/chat/completions'
    :'https://api.groq.com/openai/v1/chat/completions';
  const headers={'Content-Type':'application/json','Authorization':'Bearer '+groqKey};
  if(provider==='openrouter'){
    headers['HTTP-Referer']='http://localhost:8080';
    headers['X-Title']='Olanga';
  }
  // DeepSeek R1 uses a different message format — no system role
  const messages=model.includes('deepseek-r1')
    ?[{role:'user',content:system+'\n\n'+user}]
    :[{role:'system',content:system},{role:'user',content:user}];
  const body={model,messages,temperature:0.1,max_tokens:2000};
  const resp=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});
  if(!resp.ok){const t=await resp.text();throw new Error(provider+' '+resp.status+': '+t.slice(0,200));}
  const data=await resp.json();
  // Strip DeepSeek's <think>...</think> reasoning block from response
  let out=data.choices?.[0]?.message?.content||'';
  out=out.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
  return out;
}

// ── CONTEXT MODE — like View but with full chat history ──────────────────────
async function runContext(userMsg,snap){
  addThk();

  // Build chat history from the DOM
  const msgs=Array.from(document.querySelectorAll('#chat .msg'));
  const chatHistory=msgs.map(function(m){
    const role=m.querySelector('.mrole');
    const body=m.querySelector('.mbody');
    if(!role||!body)return null;
    const r=role.textContent.trim();
    const t=body.textContent.trim();
    if(!t||t.length<2)return null;
    return (r==='YOU'?'User: ':r==='OLANGA'?'Olanga: ':'['+r+']: ')+t;
  }).filter(Boolean).join('\n---\n');

  const CTX_SYS='You are Olanga in Context mode. You can see the current page AND the full conversation history. '+
    'Use the history to understand what has already happened and what the user knows. '+
    'Answer the user concisely and helpfully. You cannot interact with the page.';

  const ctxUser=
    'CONVERSATION HISTORY:\n'+(chatHistory||'(none yet)')+'\n\n'+
    '--- CURRENT PAGE ---\n'+(snap.txt||'').slice(0,3000)+'\n\n'+
    'INPUTS:\n'+buildInputList(snap.inp)+'\n\n'+
    'BUTTONS:\n'+buildBtnList(snap.btns)+'\n\n'+
    'USER: "'+userMsg+'"';

  let raw='';
  try{raw=await callAI(CTX_SYS,ctxUser);}catch(e){rmThk();addMsg('sys','❌ '+e.message);return;}
  const elapsed=rmThk();
  addMsg('ai',raw.trim()+'\n⏱ '+elapsed);
}

// ── VIEW MODE ────────────────────────────────────────────────────────────────
async function runViewer(userMsg,snap){
  addThk();
  let raw='';
  try{
    raw=await callAI(
      'You are Olanga in View mode. You can see the current page but cannot interact with it. Answer the user concisely and accurately based on the page content.',
      'USER: "'+userMsg+'"\n\nPAGE TEXT:\n'+(snap.txt||'').slice(0,4000)+'\n\nINPUTS:\n'+buildInputList(snap.inp)+'\n\nBUTTONS:\n'+buildBtnList(snap.btns)
    );
  }catch(e){rmThk();addMsg('sys','❌ '+e.message);return;}
  const elapsed=rmThk();
  addMsg('ai',raw.trim()+'\n⏱ '+elapsed);
}

// ── FULL AGENT MODE ──────────────────────────────────────────────────────────
async function runAgent(userMsg,firstSnap){
  const MAX_STEPS=50;
  const startTime=Date.now();

  // ── PHASE 1: PLAN ──────────────────────────────────────────────────────────
  // Planner sees the first page and creates a numbered checklist.
  // Each item is a concrete, verifiable step.
  addMsg('sys','🧠 Planning…');
  addThk();

  // ── PHASE 1: STUDY ────────────────────────────────────────────────────────
  // Deeply read the current page and reason about the goal
  addMsg('sys','🔬 Studying page…');
  addThk();

  const studyPrompt=
    'GOAL: "'+userMsg+'"\n\n'+
    'PAGE TEXT:\n'+(firstSnap.txt||'').slice(0,5000)+'\n\n'+
    'INPUTS:\n'+buildInputList(firstSnap.inp)+'\n\n'+
    'BUTTONS:\n'+buildBtnList(firstSnap.btns)+'\n\n'+
    'Carefully study everything visible on this page. '+
    'For each question or field, work out the exact correct answer with reasoning. '+
    'Note what buttons exist. '+
    'Note if this looks like a multi-page flow (e.g. quiz with Next button). '+
    'Do not plan yet — just analyse and compute answers.';

  let pageStudy='';
  try{pageStudy=await callAI(
    'You are carefully studying a webpage to prepare for automation. Read everything. Work out correct answers with full reasoning (show your math). Be thorough.',
    studyPrompt
  );}catch(e){rmThk();throw e;}
  rmThk();
  addMsg('ai','🔬 Analysis:\n'+pageStudy);
  await delay(1500);

  // ── PHASE 2: PLAN ──────────────────────────────────────────────────────────
  // Create a goal-focused checklist using the analysis
  addMsg('sys','🧠 Planning…');
  addThk();

  const planPrompt=
    'GOAL: "'+userMsg+'"\n\n'+
    'PAGE ANALYSIS:\n'+pageStudy+'\n\n'+
    'INPUTS:\n'+buildInputList(firstSnap.inp)+'\n\n'+
    'BUTTONS:\n'+buildBtnList(firstSnap.btns)+'\n\n'+
    'Write a numbered checklist of actions to achieve the goal on the CURRENT PAGE ONLY. '+
    'For future pages: just write "Handle next page toward goal" — you cannot plan those yet. '+
    'Use exact answer values from the analysis. Reference inputs by idx number. '+
    'Numbered list only. One action per step. Max 20 steps.';

  let plan='';
  try{plan=await callAI(
    'You are a browser automation planner. Create a concrete numbered action checklist. One action per step. Use exact values computed in the analysis. For unseen future pages write "Handle next page toward goal". Numbered list only.',
    planPrompt
  );}catch(e){rmThk();throw e;}
  rmThk();
  addMsg('ai','📋 Plan:\n'+plan);
  await delay(1500);

  const planSteps=plan.split('\n')
    .filter(function(l){return /^\d+[.)]\s/.test(l);})
    .map(function(l){return l.replace(/^\d+[.)]\s*/,'').trim();})
    .filter(Boolean);

  if(!planSteps.length){addMsg('sys','⚠ Could not parse plan. Stopping.');return;}

  let completedSteps=[];
  let stepN=0;

  // ── PHASE 3: EXECUTE ───────────────────────────────────────────────────────
  // Goal-driven executor: improvise freely but ONLY toward the goal.
  // Re-reads fresh page every step. Checks if goal met after each navigation.

  const EXEC_SYS=
    'You are a browser automation agent executing a goal. '+
    'You receive the goal, a checklist (as a guide — not a rigid script), and the LIVE current page state. '+
    'Your job is to move closer to the goal with each action.\n\n'+
    'You MUST:\n'+
    '- Output ONE action per response\n'+
    '- Only use idx numbers that appear in the current INPUTS list\n'+
    '- Read the current page text carefully to understand what is visible RIGHT NOW\n'+
    '- Improvise when the page differs from the plan (new page, unexpected content)\n'+
    '- Always ask: "does this action move me toward the goal?"\n'+
    '- Output {"type":"done"} the moment the goal is achieved\n\n'+
    'You MUST NOT:\n'+
    '- Invent idx numbers not in the INPUTS list\n'+
    '- Repeat an action you just did on the same input (check FILLED/CHECKED)\n'+
    '- Take actions unrelated to the goal\n'+
    '- Click buttons just because they exist — only click if it serves the goal\n\n'+
    'Output format: one sentence of reasoning (starting with "Goal requires:"), then ONE JSON action.\n'+
    'Actions: {"type":"fill","idx":N,"value":"text"} | {"type":"fill","idx":N,"checked":true} | '+
    '{"type":"click","text":"label"} | {"type":"click","idx":N} | {"type":"scroll","amount":300} | {"type":"done"}';

  while(stepN<MAX_STEPS){
    stepN++;

    // Fresh stabilised snapshot every single step
    let snap;
    try{snap=await getSnap();}catch(e){addMsg('sys','⚠ Cannot read page: '+e.message);break;}

    // Build checklist display — mark completed items
    const checklistDisplay=planSteps.map(function(s,i){
      return (completedSteps.includes(i)?'✓ ':'○ ')+(i+1)+'. '+s;
    }).join('\n');

    addThk();
    const execPrompt=
      'GOAL: "'+userMsg+'"\n\n'+
      'CHECKLIST (guide only — improvise if page differs from plan):\n'+checklistDisplay+'\n\n'+
      'LIVE PAGE STATE (step '+stepN+' — this is what is on screen RIGHT NOW):\n'+
      'PAGE TEXT:\n'+(snap.txt||'').slice(0,3000)+'\n\n'+
      'INPUTS:\n'+buildInputList(snap.inp)+'\n\n'+
      'BUTTONS:\n'+buildBtnList(snap.btns)+'\n\n'+
      'Does this action move toward the goal? Output your reasoning and ONE action.';

    let raw='';
    try{raw=await callAI(EXEC_SYS,execPrompt);}catch(e){rmThk();addMsg('sys','❌ '+e.message);break;}
    const elapsed=rmThk();
    await delay(1500);

    const action=parseAction(raw);
    const reasoning=raw.replace(/```[\s\S]*?```/g,'').replace(/\{[^{}]*\}/g,'').trim().split('\n')[0];

    if(!action){addMsg('sys','⚠ No action parsed:\n'+raw.slice(0,200));break;}

    // Done signal
    if(action.type==='done'){
      addMsg('ai','✅ '+reasoning+' ⏱'+elapsed);
      break;
    }

    addMsg('ai','Step '+stepN+': '+reasoning+' ⏱'+elapsed);
    const result=await execAction(action,snap);

    // Mark checklist step complete if this action matches it
    if(result.ok){
      addThk();
      const markRaw=await callAI(
        'Given the action taken and checklist, output ONLY the number(s) of steps now complete (comma-separated), or "none". No other text.',
        'ACTION: '+JSON.stringify(action)+'\nCHECKLIST:\n'+checklistDisplay
      ).catch(function(){return 'none';});
      rmThk();
      await delay(1500);
      if(!/none/i.test(markRaw)){
        (markRaw.match(/\d+/g)||[]).forEach(function(n){
          const i=parseInt(n)-1;
          if(i>=0&&i<planSteps.length&&!completedSteps.includes(i)){
            completedSteps.push(i);
            addMsg('sys','☑ Step '+(i+1)+' done: '+planSteps[i].slice(0,60));
          }
        });
      }
    }

    // After any click: wait for page to settle, then check if goal is met
    if(action.type==='click'){
      await delay(1500);
      let newSnap;
      try{newSnap=await getSnap();}catch(e){break;}

      // Quick goal-met check
      addThk();
      const goalCheckRaw=await callAI(
        'Has the goal been achieved? Answer only: YES or NO',
        'GOAL: "'+userMsg+'"\n\nCURRENT PAGE:\n'+(newSnap.txt||'').slice(0,2000)
      ).catch(function(){return 'NO';});
      rmThk();
      await delay(1500);

      if(/^YES/i.test(goalCheckRaw.trim())){
        addMsg('sys','✅ Goal met after navigation.');
        break;
      }

      // If new page has new unfilled inputs, update the plan for this page
      const newUnfilled=newSnap.inp.filter(function(x){
        return !x.val&&x.type!=='hidden'&&x.type!=='submit'&&x.type!=='button'&&x.chk!==true;
      });
      if(newUnfilled.length>0){
        addMsg('sys','↻ New page detected with '+newUnfilled.length+' input(s) — re-planning…');
        addThk();
        const replanRaw=await callAI(
          'You are a planner. The page has changed. Add new numbered steps to handle the new page toward the goal. One action per step. Numbered list only.',
          'GOAL: "'+userMsg+'"\n\n'+
          'NEW PAGE TEXT:\n'+(newSnap.txt||'').slice(0,3000)+'\n\n'+
          'NEW INPUTS:\n'+buildInputList(newSnap.inp)+'\n\n'+
          'NEW BUTTONS:\n'+buildBtnList(newSnap.btns)+'\n\n'+
          'Write ONLY the new steps needed for this page.'
        ).catch(function(){return '';});
        rmThk();
        await delay(1500);
        if(replanRaw){
          const newSteps=replanRaw.split('\n')
            .filter(function(l){return /^\d+[.)]\s/.test(l);})
            .map(function(l){return l.replace(/^\d+[.)]\s*/,'').trim();})
            .filter(Boolean);
          if(newSteps.length){
            newSteps.forEach(function(s){planSteps.push(s);});
            addMsg('ai','📋 Updated plan (+'+newSteps.length+' steps):\n'+replanRaw.trim());
          }
        }
      }
    }
  }

  if(stepN>=MAX_STEPS)addMsg('sys','⚠ Hit '+MAX_STEPS+'-step limit.');

  // ── PHASE 4: FINAL GOAL CHECK ──────────────────────────────────────────────
  addMsg('sys','🔍 Verifying goal…');
  addThk();
  let finalSnap;
  try{finalSnap=await getSnap();}catch(e){finalSnap=null;}

  if(finalSnap){
    const doneList=planSteps.map(function(s,i){
      return (completedSteps.includes(i)?'✓ ':'✗ ')+(i+1)+'. '+s;
    }).join('\n');
    const checkRaw=await callAI(
      'You verify if a goal was achieved. Answer: COMPLETE: <reason> or INCOMPLETE: <what is missing>',
      'GOAL: "'+userMsg+'"\n\nSTEPS ATTEMPTED:\n'+doneList+'\n\nFINAL PAGE:\n'+(finalSnap.txt||'').slice(0,2000)
    ).catch(function(){return '';});
    rmThk();
    if(checkRaw){
      const t=checkRaw.trim();
      addMsg('sys',(/^COMPLETE/i.test(t)?'✅ ':'⚠ ')+t.replace(/^(COMPLETE|INCOMPLETE):\s*/i,''));
    }
  } else {rmThk();}

  const secs=(((Date.now()-startTime)/1000)|0)+'s';
  addMsg('sys','⏱ Done: '+secs+' · '+completedSteps.length+'/'+planSteps.length+' steps · '+stepN+' AI calls');
}

const delay=ms=>new Promise(r=>setTimeout(r,ms));

renderKeySel();
// Auto-connect to current tab
bgSend('GET_TAB', {}).then(function(tab) {
  if (tab) {
    activeTabId = tab.id;
    document.getElementById('tab-url-display').textContent = (tab.url||'').slice(0,50);
    setSt('live','ready — tab connected');
  }
}).catch(function(){});
if(savedKeys.length){
  groqKey=savedKeys[0];
  checkGroq();
} else {
  addMsg('sys','Welcome to Olanga!\nAdd a Groq or OpenRouter API key above to get started.');
}

