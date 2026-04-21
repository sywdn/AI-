# AI 广播站

一个 Chrome 扩展，一键将你的消息同时广播到所有已打开的 AI 对话标签页，支持同一平台开多个标签页。

## 支持的 AI 平台

| 平台 | 域名覆盖 | 排除的非对话页 |
|------|---------|--------------|
| **DeepSeek** | `chat.deepseek.com` | — |
| **Kimi** | `kimi.com`、`kimi.moonshot.cn`、`kimi.ai` 及各自子域 | 路径含 `/code`（开发者控制台）|
| **Gemini** | `gemini.google.com` | — |
| **Claude** | `claude.ai` 及 `www.claude.ai` | — |
| **ChatGPT** | `chatgpt.com`、`chat.openai.com` | — |
| **MiniMax / 海螺 AI** | `minimaxi.com`（含 `www.` / `chat.` / `agent.` 子域）、`hailuoai.com`（含 `www.`） | `platform.minimaxi.com`（计费后台）|
| **小米 MiMo** | `aistudio.xiaomimimo.com` | — |

## 安装方式

1. 打开 Chrome，进入 `chrome://extensions/`。
2. 开启右上角「**开发者模式**」。
3. 点击「**加载已解压的扩展程序**」，选择本项目文件夹（`game9/`）。
4. 工具栏出现红色广播图标即安装成功。

> **更新代码后**：在 `chrome://extensions/` 点击扩展卡片上的「**重新加载**」，否则修改不会生效。

## 使用方法

1. 在浏览器中打开需要同时提问的 AI 网站（可同时开多个标签页，包括同一平台多个）。
2. 点击工具栏红色图标打开弹窗，弹窗会自动扫描当前所有 AI 标签页：
   - 亮色 chip = 已检测到，灰色 = 未开启
   - `DeepSeek ×2` 表示检测到 2 个 DeepSeek 标签页，均会收到消息
3. 在输入框中输入问题，点击「**⚡ 全部发送**」或按 `Ctrl + Enter`。
4. 发送完成后弹窗显示每个平台的结果；多标签页平台显示 `X / N 成功`。

## 项目文件说明

```
game9/
├── manifest.json      # 扩展配置（域名权限、content script 注入）
├── popup.html         # 弹出窗口 HTML
├── popup.css          # 弹出窗口样式
├── popup.js           # 弹出窗口逻辑（扫描、广播、结果展示）
├── content.js         # 内容脚本（在各 AI 页面填充输入框并触发发送）
├── icons/
│   ├── icon16.png     # 工具栏图标（红色广播）
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 技术说明

### 域名匹配

popup.js 和 content.js 均使用精确域名匹配，同时支持子域自动覆盖：

```
hostname === m  OR  hostname.endsWith('.' + m)
```

- `minimaxi.com` 自动覆盖 `www.minimaxi.com`、`chat.minimaxi.com`、`agent.minimaxi.com`
- 支持 `excludeHostnames`（排除特定子域）和 `excludePaths`（排除特定路径），防止非对话页面被误检测

### 文本填充（三级降级，异步）

1. **Paste 事件**（优先）：同时派发规范格式的 `beforeinput(insertFromPaste, data:null, dataTransfer)` 和 `ClipboardEvent(paste)`，触发 React / Slate / ProseMirror 等框架的内容替换逻辑。
2. **`execCommand('insertText')`**（次选）：等待 80ms 后检查填充结果，若实际字符数 < 预期的 90%（判定为部分失败），触发此方法。
3. **直接写 `textContent`**（兜底）：用于框架未拦截前两种事件的情况。

> 80ms 延迟是必要的：React/ProseMirror 的 paste 处理器在微任务里运行，同步检查时内容还未更新，会误判为失败并触发二次写入导致文字重复。

### 发送按钮查找（三级降级）

1. **精确选择器**：每个平台预定义的 CSS 选择器，优先使用 `aria-label` 和 `data-testid`。
2. **输入框附近搜索**（逐层向上 8 级）：扫描父节点内所有按钮，通过 `looksLikeSendButton` 语义判断。
3. **全局搜索**：扫描页面全局按钮。

`looksLikeSendButton` 仅接受在 `aria-label`、`title`、`className` 或可见文字中含有 `send / 发送` 的按钮。**不再使用 SVG 图标猜测**——该规则会误点资源上传、附件添加等图标按钮。

### 点击触发

`triggerClick` 只派发一个 `click` 事件（`MouseEvent`）。不再发送完整的 `pointerdown/mousedown/mouseup/click` 五件套——ChatGPT 的按钮同时监听 `onMouseDown` 和 `onClick`，五件套会触发两次发送。

### 其他可靠性机制

- **等待按钮启用**：填充后最多循环等待 3 秒，检测发送按钮从 `disabled` 变为可用（解决 React 状态异步更新）。
- **sendMessage 超时**：PING 超时 3 秒，BROADCAST 超时 8 秒，防止单标签页挂起阻塞整个广播。
- **多标签页并发**：同一平台的多个标签页并行发送，互不阻塞。
- **Content script 自动重注入**：若 PING 无响应，自动重新注入 content.js 后重试。
- **Textarea 自动识别**：若选择器命中的是 `<textarea>` 元素，自动切换填充策略，不强行用 contenteditable 方式填入。

## 常见问题

### 某个平台检测到 ×2，但我只想发一个

这说明该平台有多个标签页被检测到（如同时开了 kimi.com 和 kimi.moonshot.cn）。关闭多余标签页后点「↻」重新扫描即可。

### 平台 chip 是灰的，没被检测到

确保打开的是对话页（不是登录页、设置页等），然后点「↻」重新扫描。

### 某个平台「只填入文字但不发送」或「无反应」

在**该 AI 页面**按 `F12` 打开控制台，过滤关键词 `AI Broadcast`，重新发送一次，把日志截图发给开发者定位。

日志含义速查：
- `input = null` + `Page candidates: [...]` → 输入框选择器未命中，candidates 列表即页面实际输入元素
- `Button found, disabled=true` → 按钮被找到但一直处于禁用状态
- `No send button found` → 按钮选择器和语义查找均失败，已降级到 Enter 键

> 控制台出现 `Extension context invalidated` 且文件名带 hash（如 `content.js-e4490f5d.js`）——这是 **页面自带 JS** 的报错，与本扩展无关，可忽略。

### 修改后扩展加载失败

检查 `manifest.json` 是否是有效 JSON（不能有多余逗号）。

## 更新日志

### v1.4
- **修复 Kimi 文字截断**：`beforeinput` 改为规范格式（`data: null` + `dataTransfer`），此前 `data:'你好'` 被 Kimi 编辑器当作键盘 insertText 处理，只提取了第一个字符。
- **修复 ChatGPT 重复发送**：`triggerClick` 从 5 个合成事件简化为 1 个 `click`，ChatGPT 按钮同时响应 `onMouseDown` 和 `onClick`，原先每次广播触发 2 条消息。
- **修复填充部分成功被误判**：fill 成功判定从「有任何内容」改为「实际字符数 ≥ 预期 90%」，防止短文本仅填入首字符即被接受。
- **Gemini 兼容性修复**：inputType 改为 `contenteditable`，不再使用 Quill 专属的 `innerHTML` 写入（Gemini 已更新编辑器结构）。
- **小米 MiMo 选择器扩充**：新增多个候选选择器（`placeholder` 含「输入/发送/消息」等）；当所有选择器均未命中时，自动在控制台打印页面所有输入元素信息便于诊断。

### v1.3
- **修复 Kimi 文字乱码**：移除 `forceStateUpdate` 中的 space+backspace 键盘模拟，改为只派发 `InputEvent('input')`，键盘事件触发了 Kimi 输入法自动完成导致文字被替换。
- **修复点击资源添加按钮**：删除发送按钮的 SVG 图标兜底识别规则（「有 SVG 且无可见文字 → 当发送按钮」），该规则持续误点上传/附件图标。
- **修复文字填充双写**：`fillContentEditable` 改为异步，paste 事件后等待 80ms 再检查结果，解决框架异步处理导致的二次写入。
- **修复等待循环干扰**：移除 `waitForEnabledSendButton` 循环中的 `forceStateUpdate` 调用，避免等待期间反复触发键盘事件影响已填入内容。
- **过滤非对话页面**：`platform.minimaxi.com`（计费后台）和 Kimi `/code` 路径（开发者控制台）不再被识别为 AI 对话标签页。

### v1.2
- **多标签页支持**：同一平台开多个标签页时全部发送，chip 显示 `×N`，结果显示 `X / N 成功`。
- **发送超时保护**：PING 3s / BROADCAST 8s，防止单标签页挂起阻塞广播。
- **修复按钮文字**：「当前窗口发送」改为「全部发送」。
- **SITE_MAP 重构**：原 14 条条目合并为 7 条，改用 `endsWith` 精确子域匹配，消除死代码。
- **修复结果区 XSS**：`note` 字段 HTML 转义后再插入 DOM。
- **红色扩展图标**：新增 `icons/` 目录，工具栏显示红色广播图标便于与其他扩展区分。

### v1.1
- 修复 Kimi 消息只填入但不发送的问题。
- 补全 MiniMax 新域名权限支持。
- 重构 content script，增强文本填充和按钮查找的稳定性。
- 增加循环等待发送按钮可用的机制。
