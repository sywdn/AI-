// AI Broadcast Station - Popup Script v1.2

const AI_TARGETS = [
  { key: 'deepseek', matches: ['chat.deepseek.com'],                  name: 'DeepSeek', color: '#4cc9f0' },
  { key: 'kimi',     matches: ['kimi.com', 'kimi.moonshot.cn', 'kimi.ai'], excludePaths: ['/code'], name: 'Kimi',     color: '#a78bfa' },
  { key: 'gemini',   matches: ['gemini.google.com'],                  name: 'Gemini',   color: '#4361ee' },
  { key: 'claude',   matches: ['claude.ai'],                          name: 'Claude',   color: '#ff9f1c' },
  { key: 'chatgpt',  matches: ['chatgpt.com', 'chat.openai.com'],     name: 'ChatGPT',  color: '#06d6a0' },
  // minimaxi.com covers www/chat/agent subdomains; hailuoai.com covers www.hailuoai.com
  // platform.minimaxi.com is the billing console, not a chat page — excluded
  { key: 'minimax',  matches: ['minimaxi.com', 'hailuoai.com'], excludeHostnames: ['platform.minimaxi.com'], name: 'MiniMax',  color: '#00d4aa' },
  { key: 'xiaomimo', matches: ['aistudio.xiaomimimo.com'],            name: '小米MiMo',  color: '#ff6b9d' },
];

// detectedTabs: { [key]: tabId[] }
// Changed from key→single tabId to key→array, so we broadcast to ALL matching tabs per platform.
let detectedTabs = {};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Wraps chrome.tabs.sendMessage with a hard timeout so one hung tab
// can never block the entire broadcast.
function sendMessageWithTimeout(tabId, message, options, timeoutMs = 5000) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${timeoutMs / 1000}s)`)), timeoutMs)
    )
  ]);
}

// ─── Tab Scanner ──────────────────────────────────────────
async function scanTabs() {
  const scanBtn = document.getElementById('btn-scan');
  scanBtn.classList.add('spinning');

  const allTabs = await chrome.tabs.query({});
  detectedTabs = {};

  for (const target of AI_TARGETS) {
    const matchingTabs = allTabs.filter(tab => {
      if (!tab.url) return false;
      try {
        const url      = new URL(tab.url);
        const hostname = url.hostname;
        const path     = url.pathname;
        // Exact hostname match OR subdomain match
        if (!target.matches.some(m => hostname === m || hostname.endsWith('.' + m))) return false;
        // Exclude specific subdomains (e.g. platform.minimaxi.com = billing, not chat)
        if (target.excludeHostnames?.some(ex => hostname === ex)) return false;
        // Exclude specific paths (e.g. /code on kimi.com = developer console, not chat)
        if (target.excludePaths?.some(p => path.startsWith(p))) return false;
        return true;
      } catch {
        return false;
      }
    });
    if (matchingTabs.length > 0) {
      detectedTabs[target.key] = matchingTabs.map(t => t.id);
    }
  }

  renderChips();
  updateSubtitle();
  scanBtn.classList.remove('spinning');
}

// ─── Render ───────────────────────────────────────────────
function renderChips() {
  const container = document.getElementById('targets');
  container.innerHTML = '';

  for (const target of AI_TARGETS) {
    const tabIds = detectedTabs[target.key] || [];
    const found  = tabIds.length > 0;
    const chip   = document.createElement('div');
    chip.className         = `chip ${found ? 'active' : 'inactive'}`;
    chip.style.borderColor = found ? target.color : '';
    chip.style.color       = found ? target.color : '';
    // Show ×N badge when more than one tab of the same platform is open
    const label = found && tabIds.length > 1 ? `${target.name} ×${tabIds.length}` : target.name;
    chip.innerHTML = `
      <span class="chip-dot" style="background:${found ? target.color : '#2a2a45'}"></span>
      <span>${label}</span>
    `;
    container.appendChild(chip);
  }
}

function updateSubtitle() {
  const platformCount = Object.keys(detectedTabs).length;
  const tabCount      = Object.values(detectedTabs).reduce((s, ids) => s + ids.length, 0);
  const total         = AI_TARGETS.length;
  const el            = document.getElementById('subtitle');

  if (platformCount > 0) {
    el.textContent = tabCount > platformCount
      ? `${platformCount} / ${total} PLATFORMS · ${tabCount} TABS`
      : `${platformCount} / ${total} TARGETS LOCKED`;
    el.style.color = '#4cc9f0';
  } else {
    el.textContent = 'NO TARGETS — OPEN AI TABS FIRST';
    el.style.color = '#f72585';
  }
}

// ─── HTML escape (prevent XSS from result notes) ──────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

// ─── Send to a single tab ─────────────────────────────────
async function sendToTab(tabId, text) {
  try {
    // 1) PING — confirm content script is alive (3s timeout)
    try {
      const ping = await sendMessageWithTimeout(tabId, { type: 'PING' }, { frameId: 0 }, 3000);
      if (!ping?.alive) throw new Error('no response');
    } catch {
      // Content script not alive — inject it and wait for registration
      await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content.js'] });
      await sleep(800);
    }

    // 2) Broadcast (8s timeout — allows for the 3s button-wait inside content script)
    const result = await sendMessageWithTimeout(tabId, { type: 'BROADCAST', text }, { frameId: 0 }, 8000);
    return { ok: result?.ok === true, note: result?.note || result?.err || '' };
  } catch (e) {
    return { ok: false, note: e.message?.slice(0, 70) || 'Unknown error' };
  }
}

// ─── Send All ─────────────────────────────────────────────
async function sendAll() {
  const text = document.getElementById('msg-input').value.trim();
  if (!text) {
    document.getElementById('msg-input').focus();
    return;
  }

  const btn        = document.getElementById('btn-send');
  const resultArea = document.getElementById('result-area');

  btn.disabled    = true;
  btn.textContent = '发送中...';
  resultArea.innerHTML = '';

  const entries = Object.entries(detectedTabs);
  if (entries.length === 0) {
    resultArea.innerHTML = `<div class="no-tabs-msg">⚠️ 没有检测到任何 AI 标签页<br>请先打开 DeepSeek / Kimi / Gemini / Claude / ChatGPT</div>`;
    btn.disabled    = false;
    btn.textContent = '⚡ 全部发送';
    return;
  }

  const promises = entries.map(async ([key, tabIds]) => {
    const target = AI_TARGETS.find(t => t.key === key);
    // Send to every tab for this platform in parallel
    const results     = await Promise.all(tabIds.map(tabId => sendToTab(tabId, text)));
    const successCount = results.filter(r => r.ok).length;
    const allOk       = successCount === results.length;
    // If multiple tabs, show "X / N 成功"; if single tab, show individual note
    const note = results.length > 1
      ? `${successCount} / ${results.length} 成功`
      : (results[0].note || '');
    return { target, ok: allOk, note };
  });

  const results = await Promise.all(promises);
  renderResults(results);

  btn.disabled    = false;
  btn.textContent = '⚡ 全部发送';
}

function renderResults(results) {
  const area = document.getElementById('result-area');
  area.innerHTML = results.map(({ target, ok, note }) => {
    const safeNote = escapeHtml(note);
    const safeName = escapeHtml(target.name);
    return `
      <div class="result-row" style="border-left-color:${target.color}; background: ${ok ? 'rgba(6,214,160,0.05)' : 'rgba(247,37,133,0.05)'}">
        <div class="result-left" style="color:${target.color}">
          <span class="result-icon">${ok ? '✓' : '✗'}</span>
          <span>${safeName}</span>
        </div>
        ${safeNote ? `<span class="result-note" title="${safeNote}">${safeNote}</span>` : ''}
      </div>
    `;
  }).join('');
}

// ─── Event Bindings ───────────────────────────────────────
document.getElementById('btn-scan').addEventListener('click', scanTabs);
document.getElementById('btn-send').addEventListener('click', sendAll);

document.getElementById('msg-input').addEventListener('input', () => {
  const len = document.getElementById('msg-input').value.length;
  document.getElementById('char-count').textContent = len > 0 ? `${len} 字` : '0 字';
});

document.getElementById('msg-input').addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    sendAll();
  }
});

// ─── Init ─────────────────────────────────────────────────
scanTabs();
