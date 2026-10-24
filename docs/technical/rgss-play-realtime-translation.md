# RGSS 游玩实时翻译与悬浮字幕技术设计

- 日期：2026-10-24
- 有效性：草案
- 实现进度：已落地，实机验收未做
- 适用范围：RPG Maker VX Ace / VX / XP。实时与字幕仅 macOS 内嵌 WebView；Windows 原版 Game.exe 本期只消费缓存
- 关联需求：[RGSS 游玩实时翻译与悬浮字幕](../rgss-play-realtime-translation.md)
- 底层宿主：[RGSS 内嵌 WebView 技术设计](rgss-webview-overlay.md)
- 翻译管线：[翻译管线](translation-pipeline.md)、[调度基线](../translation-scheduling.md)

## 1. 架构

沿用现有「Ruby 查表 + 原生 WebView 浮层」，不新开翻译通道。WebRTC 仍只转发控制台编辑/信令，不传对白。

```text
RGSS 宿主 (SDL2 / mkxp-z)
  Ruby: plugins/rgss/translation.rb + translation_store.rb
        - 读 chaya/config/translation-play.json
        - 查 chaya/translate/seed.json 与 cache.ndjson
        - pretranslated / realtime：现网钩子替换显示文本
        - subtitle：跳过替换，只发当前句到浮层
        - 回包只经 Bridge.dispatch_reply，主线程刷新当前窗
              │
              │ NativeWebview.eval_js → window.__chaya_on_game_message
              ▼
  WebView: Overlay.tsx + SubtitleOverlay
        - 监听 GameLink 对白事件（扩展现有 parseGameLinkMessage）
        - fetch POST /api/translate（默认 live，persist:true）
        - 字幕层 pointer-events-none，不进 host.regions
              │ loopback /api/translate
              ▼
Chaya 服务
  liveTranslateTexts → 本作 lookup → 共享库 → 已启用引擎
  成功：appendGameNdjson(chaya/translate/cache.ndjson)
```

Windows 无 `libchaya-overlay` / WebView2 时：Ruby 只跑 TranslationStore + 现网钩子，忽略 realtime/subtitle。

## 2. 现网契约（实现必须对齐）

| 项              | 正确值                                                                                                                    | 禁止写成                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Play 设置       | `chaya/config/translation-play.json`，`gameContentRelPath('translationPlay')`                                             | `config/translation-play.json`                                   |
| 缓存            | `chaya/translate/cache.ndjson` + `seed.json`                                                                              | `cache.jsonl`                                                    |
| 默认设置        | `{ mode: 'pretranslated', model: '', timeoutMs: 8000 }`                                                                   | 默认 5s、自造 mode                                               |
| 读设置          | `getTranslationPlaySettings` / `mode: play-settings`                                                                      | `mode: dialogue`                                                 |
| 测延迟          | `mode: benchmark`，固定日文句，不读不写游戏缓存                                                                           | 用对白接口当测速                                                 |
| 服务端 realtime | `POST /api/translate` `mode: realtime` → `translateDialogue`；仅 `engines: ['ollama']`，且 `settings.mode === 'realtime'` | 用它覆盖全引擎                                                   |
| 局内请求        | 默认不带 mode 的 live 管线（与批量同一套引擎/开关/秩）                                                                    | 新造 dialogue RPC                                                |
| 单次上限        | 客户端 360 字 / 7 选项；服务 live 另有批次限制，超长跳过不拆战斗日志                                                      | 无限制或只信 2000 字                                             |
| 占位符          | `lib/translate/rm-escape.ts` + `services/translate/text-classify.ts`，槽位 `__C0__`                                       | `__CHAYA_ESC_0__`；勿把 `logic-text.ts` 当转义保护（它管软换行） |
| JSON            | 原版 RGSS 无 stdlib JSON，设置与事件用 `cache_json.rb`                                                                    | `require 'json'` 当唯一路径                                      |
| 列表互通        | ndjson 立即进局内 lookup；`/translate/list` 仍以 seed 为准                                                                | 「写入即多一行提取项」                                           |

## 3. Ruby

扩展 `plugins/rgss/translation.rb` / `translation_store.rb`，不另起模块文件除非超行限制。

### 3.1 设置

- 路径：`File.join(root, 'chaya', 'config', 'translation-play.json')`。
- `CacheJSON.parse`；缺文件或坏 JSON → 默认 `pretranslated` / `8000`。
- `tick` 已每秒后台 `refresh` 缓存；同一线程读 play 文件签名，mtime/size 变才重读。
- 不在绘制热路径 `File.read`。

### 3.2 模式对钩子

现网：

- Ace：`Window_Base#convert_escape_characters` 先 `translate`。
- VX：`start_message` 把 `@texts` / `@choices` 换成译文副本，`ensure` 还原，避免解释器再 `<<`。
- 全系列：`Bitmap#draw_text` / `text_size` 只替换长度 > 1 的串，单字打字机不改。
- 旧 Ruby 无 `prepend` 走 `install_legacy`。

改动：

- `pretranslated` / `realtime`：钩子保持。realtime 的未命中回包不得在后台线程改实例变量。
- `subtitle`：`translate` 直接返回原文（lookup 仍可供工作台目录名等 `Bridge.t_name` 选用；字幕请求自己查 store）。已打开的消息窗不强制重绘。
- 从 subtitle 切回其他模式：下一句恢复替换；不重刷已画 Bitmap。

### 3.3 捕获与回包

在 `start_message`（及 Ace 对等入口）生成 `messageKey = [texts, choices]`。仅当 mode ∈ {realtime, subtitle} 且存在未命中、未超长时：

```ruby
ChayaRGSS::Bridge.dispatch_reply(
  'type' => 'translation.dialogue',
  'key' => key,
  'texts' => texts,
  'choices' => choices,
  'mode' => play_mode,
  'timeoutMs' => timeout_ms
)
```

WebView 完成后回 `translation.dialogue.result`（经现有 `receive_from_webview` 队列）。`Graphics.update` / `Bridge.pump` 所在主线程消化：

- key 仍是当前消息 → realtime 用译文刷新显示副本并 `refresh` store；subtitle 只让浮层更新（Ruby 不改 Bitmap）。
- key 已变或窗已关 → 丢弃显示，缓存已由服务端写入。

禁止：`Thread.new` 里写 `$game_message`、改 Bitmap、调 `Graphics`。禁止用 Fiber 当跨引擎方案（XP/VX 的 1.8 无 Fiber）。后台线程只允许现有 `TranslationStore#refresh`。

### 3.4 行宽

Realtime 写回后若单行超出 `contents.width`，按标点/`\n` 拆行，规则与列表侧展示换行一致，不在热路径做模型二次改写。字幕层用 CSS 折行，不改游戏行高。

## 4. WebView

### 4.1 事件

扩 `GameLinkMessage`：`translation.dialogue` / `translation.dialogue.result`。`parseGameLinkMessage` 仍只校验 `type`，新 type 即可过桥。不要用未进协议的 `CustomEvent('chaya:dialogue_subtitle')` 当主路径。

### 4.2 请求

```ts
await fetch(`${apiBase}/api/translate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ texts, persist: true, contentRoot }),
  signal,
})
```

- 走默认 live，不是 `mode: realtime`（那个只开 Ollama 且要求 play mode 已是 realtime，字幕模式会被拒）。
- `contentRoot` 用 query/`__CHAYA_RGSS_CONFIG__` / 服务绑定根。
- 超时用 play 设置；与消息 key 绑定的 `AbortController`，换句即 abort。
- 引擎集合、人工秩、`isReusableTranslation` 全交 live，浮层不自己写 ndjson。

若后续确需与 MV 插件 runtime 完全同一套开关，优先把 `createTranslationRuntime` 能复用的 lookup/请求抽到浮层，而不是在 Ruby 重写引擎调度。

### 4.3 SubtitleOverlay

挂在现有 `Overlay.tsx`，与 Workbench / MiniMap 并列：

- 只渲染译文；`pointer-events-none`，不要 `data-rgss-interactive`。
- 显隐跟消息窗：有 `translation.dialogue` 显示 pending/译文，关窗或 key 变清空。不用 `setTimeout(duration)` 当主隐藏。
- 位置靠近消息窗底部；拿不到几何时退到底部居中，不盖工作台。
- 选项随当前句；choice help 只译当前项，对齐 MV `dialogue-subtitles.ts`。
- 等待用小 badge，不遮地图点击。

Realtime 也可复用同一组件做 pending，但画面替换仍由 Ruby 钩子完成。

## 5. 服务端

- 不新增 `mode: dialogue`。
- 实时沉淀复用 `appendGameNdjson`；行格式与现网一致（`[src, zh]` 或 `{s,t}` + origin）。
- `translateDialogue` 维持现状，给控制台/旧客户端；RGSS 浮层不依赖它。
- 扩展全引擎实时是另一项，不在本文偷偷改 `realtime.ts` 语义。

## 6. 控制台

`/translate/play` 继续对 RGSS 可见。设置写入路径与 MV 相同。可在 `TranslationPlaySettings` 加平台说明（macOS 浮层 / Windows 仅缓存），不按引擎隐藏 Tab，不改 Switch 语义。

本期不改 GameEdit 工作台。若以后加局内开关，只 `writeJson('translationPlay')`，Ruby 轮询同一文件。

## 7. 分阶段

1. **契约**：Ruby 读 play JSON；subtitle 关闭替换；play 页说明。无 WebView 时 realtime/subtitle 降级为仅查表。
2. **字幕先行（macOS）**：`start_message` 发 `translation.dialogue`；Overlay 请求 live 并画跟随窗的字幕。Windows 不实现浮层。
3. **实时替换**：主线程消化 `translation.dialogue.result`，只更新当前 key 的显示副本；验证 VX ensure 还原。
4. **回归**：Ace/VX 钩子、超长跳过、占位符、ndjson 追加、点击穿透、无 WebView 降级。

## 8. 测试

- 单测：设置缺省/坏 JSON；subtitle 不替换；VX 副本还原；超长与 7 选项；key 变化丢弃；`CacheJSON` 读 play 文件。
- 组件：Overlay 收协议事件、abort、字幕不进 hit-test。
- 服务：默认 live 写 `cache.ndjson`；`mode: realtime` 在 subtitle 设置下失败（防止误用）。
- 真机：macOS Ace/VX 各走三模式；Windows 仅缓存。未做宿主不得标已验收。

## 9. 风险

| 风险             | 处理                                         |
| ---------------- | -------------------------------------------- |
| 主线程卡死       | 请求只在 WebView；Ruby 无同步 HTTP           |
| 后台改消息窗     | 回包进 Bridge 队列，主循环应用               |
| 字幕仍看到中文框 | subtitle 必须短路全部显示钩子，含 cache 命中 |
| 占位符被译坏     | 只用现网 `__C0__` 掩码                       |
| Windows 当已交付 | 文档与 UI 写明仅缓存                         |
| 列表「少一行」   | 验收不要求 seed 自动增行                     |
