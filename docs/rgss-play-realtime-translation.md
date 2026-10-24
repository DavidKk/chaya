# RGSS 游玩实时翻译与悬浮字幕需求文档

- 日期：2026-10-24
- 有效性：草案
- 实现进度：已落地（macOS WebView 实时/字幕、Windows 仅缓存）；实机验收未做
- 适用范围：RPG Maker VX Ace / VX / XP（RGSS1 / RGSS2 / RGSS3）。macOS 内嵌 WebView 宿主为实时与字幕的运行前提；Windows 原版 Game.exe 本期只保留缓存查表
- 技术方案：[RGSS 游玩实时翻译与悬浮字幕技术设计](technical/rgss-play-realtime-translation.md)
- 关联：[翻译调度优化基线](translation-scheduling.md)、[RGSS 内嵌 WebView](rgss-webview-overlay.md)、[翻译管线](technical/translation-pipeline.md)

## 1. 背景

### 1.1 现状

- **MV/MZ**：`ChayaTrans.js` 在局内读 `chaya/config/translation-play.json`，按 `pretranslated` / `realtime` / `subtitle` 工作。实时请求走插件内 `createTranslationRuntime`（本作 lookup + 已启用引擎）；服务端另有 `POST /api/translate` `mode: realtime`，目前只派 Ollama，且要求当前模式为 `realtime`。
- **RGSS**：`plugins/rgss/translation.rb` 与 `translation_store.rb` 只做本作查表。加载 `chaya/translate/seed.json`，再以 `chaya/translate/cache.ndjson` 覆盖；兼容旧扁平文件名。命中后在 `Bitmap#draw_text` / `Window_Base#convert_escape_characters`（Ace）或 `Window_Message#start_message` 临时副本（VX）替换显示文本。不读 play 设置，不发网络请求，不画悬浮字幕。
- **控制台**：`/translate/play` 对 RGSS 绑定游戏已经可打开并写入同一份 play 设置；不是「仅 MV 才能进页」。缺的是 RGSS 运行时消费这些设置。

### 1.2 目标

1. VX / Ace / XP 与 MV 使用同一套游玩三模式和同一份 `translation-play.json`，控制台开关对局内即时生效（文件轮询，间隔约 1s）。
2. 未命中缓存的当前对白可走现有 live 管线（本作 lookup → 共享库 → 已启用引擎），成功结果追加 `cache.ndjson`；再次遇到同一原文走内存 Hash，不再请求。
3. 实时模式替换当前消息窗显示文本；字幕模式保留原画面文字，只在 WebView 浮层跟随消息窗显示译文。
4. 主线程不阻塞。先显示原文或缓存，后台翻译；超时回退原文，不冻结 60 帧循环。

## 2. 模式与范围

### 2.1 三模式

与 `lib/translate/play-settings.ts` 的 `TranslationPlayMode` 一致。默认 `pretranslated`，超时默认 `8000`，可配 `2000–30000`。

| 模式            | 游戏画面                                                   | 未命中缓存                                           | 适用                               |
| --------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `pretranslated` | 继续走现有 Bitmap / 消息窗查表替换                         | 保持原文，不请求                                     | 离线、全量预译、Windows 无 WebView |
| `realtime`      | 命中即替换；未命中先原文，回包后刷新**当前仍打开的同一句** | WebView 走 live 管线，成功写入 `cache.ndjson`        | 边玩边补当前对白                   |
| `subtitle`      | **关闭** Bitmap / 消息窗替换，原文字不动                   | 同上请求；译文只出现在浮层，跟随消息窗开关与选项高亮 | 要保留原文排版                     |

互斥：控制台两个开关仍按现网互写为单一 `mode`。字幕不是「替换失败后的备选层」。

### 2.2 做

- 当前可见消息与选项（Ace / VX 的 `$game_message.texts` / `choices`；XP 对等消息数组）。
- 与 MV 对齐的客户端上限：正文加选项合计超过 360 字，或选项超过 7 项，跳过本次实时请求，保留已有缓存/原文。
- 控制字符与占位符由现网 `rm-escape` / `text-classify` 保护（`\N[n]`、`\V[n]`、`\C[n]`、`\!`、`__C0__` 等），不另造掩码格式。
- macOS 内嵌 WebView 已就绪时：WebView `fetch` 本地控制台，Ruby 只抛事件、收主线程回包。
- 控制台 `/translate/play` 保持可见；RGSS 显示说明：实时/字幕依赖 macOS 浮层宿主，Windows 目前仅缓存模式生效。

### 2.3 不做

- 不改 `Data/*.rvdata(2)`，不把实时结果当二进制回写。
- 不翻译战斗飘字、商店循环刷新、脚本参数、文件名、SE/ME 标识。现有 `translate` 已跳过单字符绘制，必须保持。
- 不承诺毫秒级模型出译；超时内能出则出，否则原文。
- 不把 WebRTC DataChannel 当翻译通道。WebRTC 仍只服务控制台 ↔ 游戏的编辑/信令。
- 不要求本期 GameEdit 工作台内再做一套 play 开关；生效源是控制台写入的 JSON。以后若加局内开关，复用同一文件。
- 写入 `cache.ndjson` 不等于自动新增 `/translate/list` 的 seed 行。列表仍看抽取 seed；lookup 与局内显示能立刻用到新译文。
- Windows 原版 `Game.exe` 无 WebView / 实时桥：本期非目标。设置可存，运行时忽略 `realtime` / `subtitle`，只做 `pretranslated`。
- 不把 CSS `pointer-events` 当成原生点击穿透。字幕层不可命中；可点 UI 继续走 `host.regions`。

## 3. 流程

```text
消息窗即将显示当前 texts/choices
        │
        ▼
读 chaya/config/translation-play.json（内存，约 1s 刷新）
        │
        ├─ subtitle：显示路径不替换，原文照画
        └─ 其他：查 seed + cache.ndjson（现有 TranslationStore）
                ├─ 命中 → 按现网钩子替换显示副本（不改解释器原数组）
                └─ 未命中且 mode=pretranslated → 原文结束
        │
        ▼
mode 为 realtime 或 subtitle，且未命中、未超长
        │
WebView 异步请求 POST /api/translate（默认 live 管线，persist）
        │
        ├─ 成功：服务端追加 cache.ndjson；浮层刷新字幕或通知 Ruby 刷新当前窗
        └─ 超时/失败：保持原文；不写坏缓存
```

等待期间游戏循环、BGM、地图动画照常。禁止在 Ruby 绘制线程里同步 HTTP。禁止后台线程改 `$game_message` 或 Bitmap。

## 4. 体验与文案

- 实时：当前句仍打开时才替换；玩家已翻页则丢弃回包，只留缓存给下次。
- 字幕：位置跟随消息窗（底对齐/靠近对话框），选项只显示当前相关译文；消息关闭即隐藏。禁止用固定 duration 自己消失导致和对话框错位。
- 等待态：轻量 pending，不盖住整屏，不抢点击。
- 超时提示可进现有 RGSS 日志，不弹阻塞窗。
- play 页不隐藏。可加一句平台说明，不改开关语义。

## 5. 验收

1. Ace / VX 各一档：`pretranslated` 只查表；关网时 `realtime` / `subtitle` 也不卡死，超时后原文仍在。
2. `realtime` 未命中句：先原文，回包后同一窗口变成译文；解释器后续 `texts <<` 不受影响（VX 仍用临时副本）。
3. `subtitle`：画面原文不替换（含已在 cache 中的句）；浮层显示译文；关窗字幕消失。
4. `\N[4]'s name (\N[2]'s dad)` 类控制符保留格式，不得收成相邻占位符。
5. 成功句写入 `chaya/translate/cache.ndjson`，重启后 `pretranslated` 能命中。该句若已在 seed 列表，控制台 lookup 可见；不要求凭空多出一行提取项。
6. 控制台改模式后约 1s 内局内切换；字幕→实时会恢复查表替换。
7. 字幕气泡不进入 `host.regions`，点击落到游戏。
8. Windows 无 WebView 构建：缓存替换仍可用；实时/字幕不请求、不报未处理异常。

## 6. 测试矩阵（实现时必须有）

- Ruby：play 设置解析（无 JSON 标准库）、subtitle 关闭替换、VX 临时副本恢复、超长跳过、消息 key 变化丢弃回包。
- WebView：字幕跟随开闭、选项、pending、pointer-events。
- 服务：默认 live 写入 ndjson；不走不存在的 `mode: dialogue`。
- 平台：macOS 浮层宿主；Windows 仅缓存。不把未实现宿主写成已验收。
