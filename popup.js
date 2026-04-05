// AI Broadcast Station - Popup Script

const AI_TARGETS = [
  { key: 'deepseek', matches: ['chat.deepseek.com'],                  name: 'DeepSeek', color: '#4cc9f0' },
  { key: 'kimi',     matches: ['kimi.com', 'kimi.moonshot.cn', 'kimi.ai'],  name: 'Kimi',     color: '#a78bfa' },
  { key: 'gemini',   matches: ['gemini.google.com'],                  name: 'Gemini',   color: '#4361ee' },
  { key: 'claude',   matches: ['claude.ai'],                          name: 'Claude',   color: '#ff9f1c' },
  { key: 'chatgpt',  matches: ['chatgpt.com', 'chat.openai.com'],     name: 'ChatGPT',  color: '#06d6a0' },
];

// tabId per key
let detectedTabs = {};

// ─── Tab Scanner ───────────────────────────────────────────
async function scanTabs() {
  const scanBtn = document.getElementById('btn-scan');
  scanBtn.classList.add('spinning');

  const allTabs = await chrome.tabs.query({});
  detectedTabs = {};

  for (const target of AI_TARGETS) {
    for (const tab of allTabs) {
      if (!tab.url) continue;
      const matched = target.matches.some(m => tab.url.includes(m));
      if (matched) {
        detectedTabs[target.key] = tab.id;
        break; // 只取每个 AI 的第一个匹配 tab
      }
    }
  }

  renderChips();
  updateSubtitle();
  scanBtn.classList.remove('spinning');
}

// ─── Render ────────────────────────────────────────────────
function renderChips() {
  const container = document.getElementById('targets');
  container.innerHTML = '';

  for (const target of AI_TARGETS) {
    const found = !!detectedTabs[target.key];
    const chip = document.createElement('div');
    chip.className = `chip ${found ? 'active' : 'inactive'}`;
    chip.style.borderColor = found ? target.color : '';
    chip.style.color       = found ? target.color : '';
    chip.innerHTML = `
      <span class="chip-dot" style="background:${found ? target.color : '#2a2a45'}"></span>
      <span>${target.name}</span>
    `;
    container.appendChild(chip);
  }
}

function updateSubtitle() {
  const count = Object.keys(detectedTabs).length;
  const total = AI_TARGETS.length;
  const el = document.getElementById('subtitle');
  el.textContent = count > 0
    ? `${count} / ${total} TARGETS LOCKED`
    : `NO TARGETS — OPEN AI TABS FIRST`;
  el.style.color = count > 0 ? '#4cc9f0' : '#f72585';
}

// ─── Send ──────────────────────────────────────────────────
async function sendAll() {
  const text = document.getElementById('msg-input').value.trim();
  if (!text) {
    document.getElementById('msg-input').focus();
    return;
  }

  const btn = document.getElementById('btn-send');
  const resultArea = document.getElementById('result-area');

  btn.disabled = true;
  btn.textContent = '发送中...';
  resultArea.innerHTML = '';

  const entries = Object.entries(detectedTabs);
  if (entries.length === 0) {
    resultArea.innerHTML = `<div class="no-tabs-msg">⚠️ 没有检测到任何 AI 标签页<br>请先打开 DeepSeek / Kimi / Gemini / Claude / ChatGPT</div>`;
    btn.disabled = false;
    btn.textContent = '⚡ 全部发送';
    return;
  }

  const promises = entries.map(async ([key, tabId]) => {
    const target = AI_TARGETS.find(t => t.key === key);
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'BROADCAST', text });
      return { target, ok: result?.ok === true, note: result?.note || result?.err || '' };
    } catch (e) {
      // Content script 未就绪时，手动注入后重试一次
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await sleep(600);
        const result = await chrome.tabs.sendMessage(tabId, { type: 'BROADCAST', text });
        return { target, ok: result?.ok === true, note: result?.note || result?.err || '' };
      } catch (e2) {
        return { target, ok: false, note: e2.message.slice(0, 60) };
      }
    }
  });

  const results = await Promise.all(promises);
  renderResults(results);

  btn.disabled = false;
  btn.textContent = '⚡ 全部发送';
}

function renderResults(results) {
  const area = document.getElementById('result-area');
  area.innerHTML = results.map(({ target, ok, note }) => `
    <div class="result-row" style="border-left-color:${target.color}; background: ${ok ? 'rgba(6,214,160,0.04)' : 'rgba(247,37,133,0.04)'}">
      <div class="result-left" style="color:${target.color}">
        <span class="result-icon">${ok ? '✓' : '✗'}</span>
        <span>${target.name}</span>
      </div>
      ${note ? `<span class="result-note" title="${note}">${note}</span>` : ''}
    </div>
  `).join('');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Event Bindings ────────────────────────────────────────
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

// ─── Init ──────────────────────────────────────────────────
scanTabs();
