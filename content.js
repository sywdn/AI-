// AI Broadcast Station - Content Script
// Injected into each AI chat page to fill and submit messages

const SITE_MAP = [
  {
    match: 'chat.deepseek.com',
    name: 'DeepSeek',
    inputSel: [
      'textarea#chat-input',
      '.ds-textarea textarea',
      '.input-area textarea',
      'textarea[placeholder]',
      'textarea'
    ],
    submitSel: [
      'button[type="submit"]',
      '.send-button button',
      'button[aria-label="发送"]',
      'button[aria-label="Send"]'
    ],
    inputType: 'textarea'
  },
  {
    match: 'kimi.com',
    name: 'Kimi',
    inputSel: [
      '.editor-kt [contenteditable="true"]',
      '.chat-input [contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea'
    ],
    submitSel: [
      'button[type="submit"]',
      '.send-button',
      'button[data-testid="send-button"]',
      'button[aria-label="发送"]'
    ],
    inputType: 'auto'
  },
  {
    match: 'kimi.moonshot.cn',
    name: 'Kimi',
    inputSel: [
      '.editor-kt [contenteditable="true"]',
      '.chat-input [contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea'
    ],
    submitSel: [
      'button[type="submit"]',
      '.send-button',
      'button[data-testid="send-button"]',
      'button[aria-label="发送"]'
    ],
    inputType: 'auto'
  },
  {
    match: 'kimi.ai',
    name: 'Kimi',
    inputSel: [
      '[contenteditable="true"]',
      'textarea'
    ],
    submitSel: [
      'button[type="submit"]',
      '.send-button'
    ],
    inputType: 'auto'
  },
  {
    match: 'gemini.google.com',
    name: 'Gemini',
    inputSel: [
      'rich-textarea .ql-editor',
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"]'
    ],
    submitSel: [
      'button.send-button',
      'button[aria-label="Send message"]',
      'button[aria-label="发送消息"]',
      'button[mattooltip="Send message"]'
    ],
    inputType: 'quill'  // Quill 编辑器用专用粘贴注入
  },
  {
    match: 'claude.ai',
    name: 'Claude',
    inputSel: [
      '.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ],
    submitSel: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[data-value="send"]'
    ],
    inputType: 'contenteditable'
  },
  {
    match: 'chatgpt.com',
    name: 'ChatGPT',
    inputSel: [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'div[contenteditable="true"]'
    ],
    submitSel: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]'
    ],
    inputType: 'contenteditable'
  },
  {
    match: 'chat.openai.com',
    name: 'ChatGPT',
    inputSel: [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'div[contenteditable="true"]'
    ],
    submitSel: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]'
    ],
    inputType: 'contenteditable'
  }
];

// ---- 填充方法 ----

function fillTextarea(el, text) {
  el.focus();
  // 用原生 setter 绕过 React 的值劫持
  try {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(el, text);
  } catch (e) {
    el.value = text;
  }
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function fillContentEditable(el, text) {
  el.focus();

  // 方法1：execCommand（兼容 ProseMirror）
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    const ok = document.execCommand('insertText', false, text);
    if (ok && el.innerText.trim()) return;
  } catch (e) { /* 继续降级 */ }

  // 方法2：手动清空并模拟 InputEvent
  el.innerHTML = '';
  const range = document.createRange();
  const sel = window.getSelection();
  const textNode = document.createTextNode(text);
  el.appendChild(textNode);
  range.setStart(textNode, text.length);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
}

// Gemini 专用：通过 paste 事件注入完整文本（绕过 Quill 对 insertText 的长度限制）
function fillViaQuill(el, text) {
  el.focus();

  // 先清空
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  // 用 paste 事件携带完整内容，Quill 会接管处理整个字符串
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt
    }));
    if (el.innerText.trim()) return;
  } catch (e) { /* 降级 */ }

  // 降级：直接写 innerHTML 并触发 input 事件
  el.innerHTML = `<p>${text.replace(/\n/g, '</p><p>')}</p>`;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
}

// ---- 工具函数 ----

function getSiteConfig() {
  const hostname = window.location.hostname;
  return SITE_MAP.find(s => hostname.includes(s.match));
}

function findFirst(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch (e) { /* 忽略无效选择器 */ }
  }
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---- 核心广播函数 ----

async function broadcast(text) {
  const config = getSiteConfig();
  if (!config) return { ok: false, err: 'Unsupported site' };

  const input = findFirst(config.inputSel);
  if (!input) return { ok: false, err: 'Input not found — page may not be on chat screen' };

  // 检测实际输入类型
  let type = config.inputType;
  if (type === 'auto') {
    type = input.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'contenteditable';
  }

  try {
    if (type === 'quill') {
      fillViaQuill(input, text);
    } else if (type === 'textarea') {
      fillTextarea(input, text);
    } else {
      fillContentEditable(input, text);
    }
  } catch (e) {
    return { ok: false, err: 'Fill error: ' + e.message };
  }

  // 等待框架处理 input 事件（React/Vue 需要一点时间）
  await sleep(700);

  // 查找发送按钮
  const submitBtn = findFirst(config.submitSel);

  if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
    submitBtn.click();
    return { ok: true };
  }

  // 降级：模拟 Enter 键
  const enterEvt = new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13,
    which: 13, bubbles: true, cancelable: true
  });
  input.dispatchEvent(enterEvt);
  return { ok: true, note: 'Enter fallback' };
}

// ---- 消息监听 ----

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === 'BROADCAST') {
    broadcast(msg.text).then(result => respond(result));
    return true; // 保持异步通道
  }
  if (msg.type === 'PING') {
    const config = getSiteConfig();
    respond({ alive: true, name: config ? config.name : window.location.hostname });
    return true;
  }
});
