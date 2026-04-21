// AI Broadcast Station - Content Script v1.4

(() => {
  const listener = (msg, _sender, respond) => {
    try {
      if (msg.type === 'BROADCAST') {
        broadcast(msg.text).then(r => {
          try { respond(r); } catch (e) {}
        }).catch(err => {
          try { respond({ ok: false, err: err.message }); } catch (e) {}
        });
        return true;
      }
      if (msg.type === 'PING') {
        const config = getSiteConfig();
        try { respond({ alive: true, name: config ? config.name : window.location.hostname }); } catch (e) {}
        return true;
      }
    } catch (e) {}
  };

  try {
    if (window.__AI_BROADCAST_LISTENER__) {
      chrome.runtime.onMessage.removeListener(window.__AI_BROADCAST_LISTENER__);
    }
  } catch (e) {}
  chrome.runtime.onMessage.addListener(listener);
  window.__AI_BROADCAST_LISTENER__ = listener;

  console.log('[AI Broadcast] Content script registered on:', window.location.hostname);

  // ─── Site Map ─────────────────────────────────────────────
  const SITE_MAP = [
    {
      matches: ['chat.deepseek.com'],
      name: 'DeepSeek',
      inputSel: ['textarea#chat-input', '.ds-textarea textarea', '.input-area textarea', 'textarea[placeholder]', 'textarea'],
      submitSel: ['button[aria-label="发送"]', 'button[aria-label="Send"]', 'button[type="submit"]', '.send-button button'],
      inputType: 'textarea'
    },
    {
      matches: ['kimi.com', 'kimi.moonshot.cn', 'kimi.ai'],
      excludePaths: ['/code'],
      name: 'Kimi',
      inputSel: ['.editor-kt [contenteditable="true"]', '.chat-input [contenteditable="true"]', '[contenteditable="true"]', 'textarea'],
      submitSel: ['button[aria-label="发送"]', 'button[data-testid="send-button"]', '.send-button', 'button[class*="send"]'],
      inputType: 'contenteditable'
    },
    {
      // FIX: Gemini dropped standard Quill. inputType changed to 'contenteditable'.
      // fillViaQuill used innerHTML as fallback which breaks non-Quill editors.
      // Added rich-textarea-scoped selectors + generic role="textbox" fallback.
      matches: ['gemini.google.com'],
      name: 'Gemini',
      inputSel: [
        'rich-textarea .ql-editor',
        'rich-textarea div[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]'
      ],
      submitSel: [
        'button[aria-label="Send message"]',
        'button[aria-label="发送消息"]',
        'button[mattooltip="Send message"]',
        'button.send-button'
      ],
      inputType: 'contenteditable'
    },
    {
      matches: ['claude.ai'],
      name: 'Claude',
      inputSel: ['.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
      submitSel: ['button[aria-label="Send Message"]', 'button[aria-label="Send message"]', 'button[data-value="send"]'],
      inputType: 'contenteditable'
    },
    {
      matches: ['chatgpt.com', 'chat.openai.com'],
      name: 'ChatGPT',
      inputSel: ['div#prompt-textarea[contenteditable="true"]', '#prompt-textarea', 'div[contenteditable="true"]'],
      submitSel: ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label="Send message"]'],
      inputType: 'contenteditable'
    },
    {
      matches: ['minimaxi.com', 'hailuoai.com'],
      excludeHostnames: ['platform.minimaxi.com'],
      name: 'MiniMax',
      inputSel: ['.chat-input [contenteditable="true"]', '[contenteditable="true"]', 'textarea'],
      submitSel: ['button[aria-label="发送"]', 'button[aria-label="Send"]', 'button[class*="send"]'],
      inputType: 'contenteditable'
    },
    {
      matches: ['aistudio.xiaomimimo.com'],
      name: '小米MiMo',
      // Selectors ordered from most-specific to generic fallback.
      // If all fail, the console will log "Input not found" — use the diagnostic
      // snippet in README to find the correct selector for this platform.
      inputSel: [
        'textarea[placeholder]',
        '.chat-input textarea',
        '.input-area textarea',
        '.chat-input [contenteditable="true"]',
        '.input-area [contenteditable="true"]',
        '.input-box [contenteditable="true"]',
        '[placeholder*="输入"]',
        '[placeholder*="发送"]',
        '[placeholder*="消息"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      submitSel: [
        'button[aria-label="发送"]',
        'button[aria-label="Send"]',
        'button[type="submit"]',
        'button[class*="send"]'
      ],
      inputType: 'contenteditable'
    }
  ];

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getSiteConfig() {
    const hostname = window.location.hostname;
    const path     = window.location.pathname;
    return SITE_MAP.find(s => {
      if (!s.matches.some(m => hostname === m || hostname.endsWith('.' + m))) return false;
      if (s.excludeHostnames?.some(ex => hostname === ex)) return false;
      if (s.excludePaths?.some(p => path.startsWith(p))) return false;
      return true;
    });
  }

  function findFirst(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  // ─── Fill strategies ──────────────────────────────────────

  function fillTextarea(el, text) {
    el.focus();
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(el, text);
    } catch (e) {
      el.value = text;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  // FIX: Removed space+backspace keyboard simulation.
  // Previously, firing synthetic space keydown triggered IME/autocomplete in Kimi,
  // corrupting the filled text (e.g. "好等我看看" → "好的我看").
  // A plain InputEvent('input') is sufficient to notify React/Vue that the value changed.
  function forceStateUpdate(el) {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  }

  function fillViaPaste(el, text) {
    el.focus();
    // Select all existing content so paste replaces rather than appends
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}

    const dt = new DataTransfer();
    dt.setData('text/plain', text);

    // beforeinput with correct spec format for paste:
    //   data: null          (keyboard data — null for paste)
    //   dataTransfer: dt    (paste data lives here, not in .data)
    // Previously data:'你好' caused Kimi's editor to read it as a keyboard insertText
    // event and only commit the first character. data:null + dataTransfer is correct.
    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertFromPaste',
        data: null,
        dataTransfer: dt,
        bubbles: true,
        cancelable: true
      }));
    } catch (e) {}

    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt
    }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  }

  function fillViaExecCommand(el, text) {
    el.focus();
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete',    false, null);
      const ok = document.execCommand('insertText', false, text);
      if (ok) el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      return ok;
    } catch (e) {
      return false;
    }
  }

  function fillViaDom(el, text) {
    el.focus();
    el.textContent = text;
    try {
      const range = document.createRange();
      const sel   = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  }

  // Cascade: paste → execCommand → direct DOM.
  // The 80ms await lets React/ProseMirror paste handlers (which run as microtasks)
  // finish before we check whether the fill actually worked.
  async function fillContentEditable(el, text) {
    fillViaPaste(el, text);
    await sleep(80);
    const afterPaste = (el.innerText || el.textContent || '').trim();
    // FIX: verify fill length, not just "any content present".
    // "你好" (2 chars) partially filled as "你" (1 char, 50%) was previously accepted.
    // Require ≥90% of intended length to consider paste successful.
    const pasteOk = afterPaste.length > 0 && afterPaste.length >= text.length * 0.9;
    if (pasteOk) {
      forceStateUpdate(el);
      return;
    }
    // Paste failed or incomplete — try execCommand (selectAll + delete + insertText)
    if (fillViaExecCommand(el, text)) {
      await sleep(50);
      forceStateUpdate(el);
      return;
    }
    // Last resort: direct DOM write
    fillViaDom(el, text);
    forceStateUpdate(el);
  }

  // ─── Send-button detection ────────────────────────────────

  // Only accepts buttons with explicit "send / 发送" signals.
  // No SVG-only heuristic — that was matching upload/resource icon buttons.
  function looksLikeSendButton(btn) {
    if (!btn) return false;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;

    const aria  = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title')      || '').toLowerCase();
    const cls   = (btn.className                  || '').toLowerCase();
    const text  = (btn.textContent                || '').trim().toLowerCase();

    if (aria.includes('send')  || aria.includes('发送'))  return true;
    if (title.includes('send') || title.includes('发送')) return true;
    if (cls.includes('send'))                             return true;
    if (text === '发送' || text === 'send')               return true;

    return false;
  }

  function findNearbySendButton(input) {
    let parent = input;
    for (let i = 0; i < 8 && parent; i++) {
      const candidates = Array.from(parent.querySelectorAll('button, [role="button"]'))
        .filter(b => looksLikeSendButton(b));
      if (candidates.length > 0) return candidates[candidates.length - 1];
      parent = parent.parentElement;
    }
    return null;
  }

  function findGlobalSendButton() {
    const all = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(b => looksLikeSendButton(b));
    return all.length > 0 ? all[all.length - 1] : null;
  }

  function findSendButton(input, selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') return el;
      } catch (e) {}
    }
    return findNearbySendButton(input) || findGlobalSendButton();
  }

  async function waitForEnabledSendButton(input, selectors, maxWaitMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const btn = findSendButton(input, selectors);
      if (btn) {
        const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
        console.log('[AI Broadcast] Button found, disabled=', disabled, btn.className);
        if (!disabled) return btn;
      } else {
        console.log('[AI Broadcast] No send button found yet...');
      }
      await sleep(300);
    }
    return findSendButton(input, selectors);
  }

  // FIX: simplified to a single click event.
  // The previous 5-event sequence (pointerdown→mousedown→pointerup→mouseup→click)
  // caused ChatGPT to send twice: its button listens to both onMouseDown AND onClick,
  // so mousedown fired a send and click fired another. A single 'click' is sufficient
  // for all React-based send buttons (onClick maps to the native click event).
  function triggerClick(el) {
    if (!el) return;
    console.log('[AI Broadcast] Clicking', el.tagName, el.className);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  }

  // ─── Main broadcast logic ─────────────────────────────────

  async function broadcast(text) {
    const config = getSiteConfig();
    console.log('[AI Broadcast] broadcast() on', window.location.hostname, '->', config?.name);
    if (!config) return { ok: false, err: 'Unsupported site: ' + window.location.hostname };

    const input = findFirst(config.inputSel);
    console.log('[AI Broadcast] input =', input?.tagName, input?.className);
    if (!input) {
      // Diagnostic: log every textarea and contenteditable on the page so the
      // correct selector can be identified when a platform's input isn't found.
      const candidates = [
        ...document.querySelectorAll('textarea'),
        ...document.querySelectorAll('[contenteditable="true"]')
      ].map(el => ({
        tag: el.tagName,
        id: el.id || '',
        cls: el.className?.toString().slice(0, 60) || '',
        placeholder: el.placeholder || el.getAttribute('placeholder') || '',
        visible: el.offsetParent !== null
      }));
      console.log('[AI Broadcast] Input not found. Page candidates:', candidates);
      return { ok: false, err: 'Input not found' };
    }

    // FIX: auto-detect textarea regardless of config.inputType.
    // 小米MiMo and others may match a textarea element via a contenteditable selector
    // if the page uses textarea as the chat input. Using contenteditable fill methods
    // on a textarea silently fails; auto-detect prevents this.
    const isTextarea = input.tagName.toLowerCase() === 'textarea';
    const fillType   = isTextarea ? 'textarea' : config.inputType;

    try {
      if      (fillType === 'textarea') fillTextarea(input, text);
      else                              await fillContentEditable(input, text);
    } catch (e) {
      return { ok: false, err: 'Fill error: ' + e.message };
    }

    const filled = (input.innerText || input.textContent || input.value || '').trim();
    console.log('[AI Broadcast] Filled (30ch):', filled.slice(0, 30));

    const submitBtn = await waitForEnabledSendButton(input, config.submitSel, 3000);
    console.log('[AI Broadcast] submitBtn =', submitBtn?.tagName, submitBtn?.className);

    if (submitBtn) {
      triggerClick(submitBtn);
      await sleep(200);
      return { ok: true, note: 'Clicked send button' };
    }

    // Enter key fallback
    console.log('[AI Broadcast] No button found, sending Enter key');
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }
    await sleep(200);
    return { ok: true, note: 'Enter fallback' };
  }
})();
