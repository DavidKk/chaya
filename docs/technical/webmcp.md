# WebMCP 与插件工具技术方案

> 状态：开发中 · 2026-10-03
> 需求：[`../webmcp.md`](../webmcp.md)、[`../capabilities.md`](../capabilities.md)（能力总表） · 关联：[`integration-mcp.md`](./integration-mcp.md)
> 参考：工单服务 `initializer/webmcp`、`biz/webmcp`（`docs/technical/console-webmcp.md`）

## 1. 总体

```text
本机 dev / App                                     Edge
┌────────────── 页面 (Chrome WebMCP) ─────────────┐ ┌─────────────── 页面 ───────────────┐
│ chaya.page    page_* 10 个（DOM）                 │ │ chaya.page    同左                  │
│ chaya.mcp     tools/list 镜像 ───┼──→ /api/mcp    │ │ chaya.mcp     浏览器实现 ─┬→ IndexedDB / 目录授权 / /api/logs
│               （含插件工具）      │       │        │ │ chaya.plugins 插件工具 ─┐ │          │
└──────────────────────────────────┼───────┼────────┘ └─────────────────────────┼─┼──────────┘
                                   │       ↓ agent bridge（长轮询）             ↓ ↓
                          GameLink DataChannel（edit.* / translation.rpc，'/agent' 路径）
                                   ↓
                     游戏内 ChayaEdit 会话 / 翻译运行时 / ChayaAgent（插件声明的工具）
```

- 页面工具三种形态一致；MCP 部分按形态切换执行方式，工具名、参数、返回一致。
- 本机镜像以 `tools/list` 为准：服务端新增工具、`CHAYA_MCP_EVAL`、在线游戏的插件工具自动出现在 WebMCP。
- 翻译 / 共享翻译库 / 游戏操作 / 修改四组工具的实现抽成"注入调用方式"的工厂，服务端注入进程内路由与 agent bridge，Edge 注入 DataChannel，两端共用参数校验与返回格式。

## 2. 落点

```text
initializer/webmcp/
  model-context.ts         # 类型（含 annotations）、getDocumentModelContext、getWebMcpSupportReport
  result.ts                # webMcpOk / webMcpError
  register-page-tools.ts   # registerPageTools（一次性）+ syncPageTools（增量）+ listRegisteredPageTools
  usePageWebMcp.ts         # 静态工具集：挂载注册 / 卸载注销，不支持时重试 5 次
lib/integration/tools/     # 两端共用的 MCP 工具实现（纯函数 + 注入 I/O）
  args.ts                  # 原 _tools/args.ts
  types.ts                 # ToolImpls、ApiInvoke、AgentCall、redactSecrets
  translate.ts cache.ts    # makeTranslateTools(invoke) / makeCacheTools(invoke)
  live.ts                  # makeLiveTools({ games, call, quit? })：游戏操作 + 插件功能
  edit.ts                  # makeEditTools(call)：chaya_edit_state / set / action
  catalog.ts               # filterCatalog + chaya_edit_catalog 参数处理
lib/webmcp/
  mcp-mirror.ts            # tools/list 条目 → WebMCP 定义（标注映射）、tools/call 结果解析与截断
  mode-matrix.ts           # Edge 不可用工具与原因（page_get_context、测试共用）
lib/runtime/edit-ops.ts  # 修改参数校验（GameEditCmdOp / EditAction），工具层与游戏内共用
lib/runtime/plugin-tool-catalog.ts  # 插件工具静态元数据（描述 / schema / 标注）
lib/runtime/plugin-tools.ts  # 命名、目录查找、上报校验、第一方插件名单
components/webmcp/
  ChayaWebMcpHost.tsx      # AppProviders 内挂一次：探测形态，挂三个注册者
  mcp-mirror-client.ts     # 本机：拉 tools/list、调用 /api/mcp
  edge/{library,game,link,index}.ts  # Edge 浏览器实现（按分组拆；日志查询在 link.ts）
  page/                    # 页面工具（移植工单服务：elements / snapshot / actions / tools）
components/GameLinkProvider.tsx  # 增加 callAgent / requestCatalog / acquireEditSession（拆 useGameLinkRpc）
components/integration/webmcp/WebMcpView.tsx
plugins/src/helpers/plugin-tools.ts   # declarePluginTools(plugin, { tool: run })
plugins/src/agent/game-control.ts     # game.snap / input.tap / player.moveTo / game.quit
plugins/src/cheat/session/agent-edit.ts  # window.ChayaEdit.agentEdit：读会话 / 应用指令 / 运行动作
game-boost.ts、translator/index.ts 内提供插件工具实现
```

## 3. 注册层 `initializer/webmcp`

移植工单服务实现，差异：

- `registerPageTools(registrarId, tools, signal)`：按工具名去重，开发环境重名抛错，生产告警跳过。
- `syncPageTools(registrarId, tools)`：同一注册者的工具会变化（镜像随在线游戏增减插件工具、Edge 插件工具随连接变化）。每个工具独立 `AbortController`；按名比较：新增注册，消失 abort，描述 / schema / 标注变化的先 abort 再注册。返回 `dispose()`。
- `execute` 统一包错误信封，异常转 `webMcpError('internal_error', message)`。
- 标注：非 `readOnly` 的工具一律 `consequentialHint`；镜像工具、Edge MCP 工具、插件工具一律 `untrustedContentHint`（返回值含游戏或日志文本）。

## 4. MCP 侧改动

### 4.1 标注

`McpToolMeta` 增加 `readOnly?: true`（list / status / shell_check / games / state / plugins / catalog / logs_query / cache_query）。`tools/list` 每项返回标准 `annotations: { readOnlyHint?, destructiveHint? }`。

### 4.2 插件工具

- `lib/runtime/plugin-tool-catalog.ts`：`PLUGIN_TOOL_CATALOG` 是全部第一方插件工具的**静态元数据**（插件、工具名、标题、描述、schema、`readOnly` / `destructive`）。游戏只上报"实现了哪些工具"，Agent 看到的描述与 schema 一律取自这里——游戏内任意脚本都能写全局注册表，不能让它把文本注入 `tools/list`。
- 语言：所有 WebMCP 工具定义（`page_*`、插件工具、页面工具的提示与报错）只用英文；集成页展示的说明来自 `lib/integration/web-tools-messages.json`（zh / ja / ko），经 `localizedToolDescription` 取用，缺失时显示英文原文。
- `lib/runtime/plugin-tools.ts`：

  ```ts
  pluginToolName('ChayaBoost', 'on') // → 'chaya_plugin_boost_on'
  findPluginToolMeta(plugin, tool) // 查目录
  sanitizePluginTools(raw): PluginToolMeta[] // 只读上报里的 plugin / tool，映射到目录条目；其余字段忽略
  ```

- 游戏内：`declarePluginTools(plugin, { tool: run })` 冻结后写入 `globalThis.__chayaPluginTools[plugin]`，不在目录里的工具名丢弃。ChayaAgent：
  - `plugins.list` 结果每项附 `tools`（目录元数据）。
  - 新命令 `plugin.tool { plugin, tool, input }` → `run(input)`，结果过 `toJsonSafe`；目录外的工具名一律"插件工具不存在"。
  - `info.tools` 每次长轮询上报；`window.ChayaAgent.run(cmd)` 在模块加载时挂上，与长轮询循环独立（Edge 下长轮询 404 也可经 DataChannel 用）。
  - 404 时日志改为"网页版经游戏连接提供 Agent 能力"。
- `plugin.call`（插件任意方法的链式调用）已移除（[capabilities.md](../capabilities.md) §1.4）：Agent 只能调声明的插件工具与 §4.4 的预设指令。
- 服务端：`/api/runtime/agent` 对 `info.tools` 过 `sanitizePluginTools`；`agent-bridge` 记录每个游戏的工具，`listPluginTools()` 汇总在线游戏（同名去重）。省略 `gameId` 时，若只有一个在线游戏声明了该工具则默认路由给它。
- `initializer/mcp.ts`：`McpServerConfig.dynamicTools?: () => McpTool[]`；`tools/list` / `tools/call` 合并静态 + 动态。`McpTool` 增加 `annotations`。插件工具 `inputSchema` 额外加可选 `gameId`，`run` → `plugin.tool`。
- 已有工具扩展（不新增工具名）：`chaya_live_plugins` 只返回各插件声明的 `tools`；`chaya_live_call { plugin, tool, input }` 供未刷新 `tools/list` 的客户端调用（不再接受 `method` / `args` / `chain`）。
- `capabilities.tools.listChanged` 维持 `false`，`MCP_INSTRUCTIONS` 说明插件工具随游戏在线变化。

### 4.3 各插件声明

| 插件       | 工具 → 实现（复用插件现有方法）  |
| ---------- | -------------------------------- |
| ChayaBoost | `on{rate?}`、`off{}`、`status{}` |
| ChayaTrans | `status{}`、`reload{}`           |

`readOnly`：`status`。ChayaEdit 不再声明插件工具（与 `chaya_edit_*` 重复），修改走 §4.4。

### 4.4 游戏操作与修改指令

按 [capabilities.md](../capabilities.md) §3.2 / §4 / §7。ChayaAgent 新增指令（`lib/runtime/agent-protocol.ts`），三条通道共用：

| 指令            | 参数                                                                                               | 实现                                                                                                                                                                                     | 返回                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `game.history`  | `limit?`（默认 50，上限 300）、`kinds?`（条目类型数组）、`afterSeq?`（只取之后的条目，便于增量读） | 读剧情记录器（见下）                                                                                                                                                                     | `{ entries, lastSeq, dropped }`                                 |
| `game.snap`     | `maxWidth?`（默认 512，上限 1280）                                                                 | `SceneManager.snap()` 按宽缩放，JPEG 0.7                                                                                                                                                 | `{ mimeType, data, width, height, screen }`（`data` 为 base64） |
| `input.tap`     | `x`、`y`、`frames?`（默认 6）                                                                      | `TouchInput._onTrigger` → 等帧 → `_onRelease`，坐标夹到画面内                                                                                                                            | `{ tapped, frames }`                                            |
| `player.moveTo` | `x`、`y`、`timeoutMs?`（默认 8000，上限 12000）                                                    | 只在 `Scene_Map`；直接写 `$gameTemp._destinationX/Y`（关闭点击移动时 `setDestination` 被补丁成空操作），每 100ms 轮询，超时清除目的地；途中踩到传送点换了地图即停（`transferred: true`） | `{ arrived, transferred?, mapId, position, target }`            |
| `game.quit`     | —                                                                                                  | `SceneManager.exit()`（插件网关与 server 用；server 无长轮询游戏时退回 `DELETE /api/launch`；Edge 走 GameLink `quit`）                                                                   | `{ quit: true }`                                                |
| `edit.catalog`  | —                                                                                                  | `window.ChayaEdit.catalog()`（内存里的 `$data*`，有译文时附译文）；server 的 `chaya_edit_catalog` 带 `gameId` 时用它                                                                     | `GameEditCatalog`                                               |
| `edit.state`    | —                                                                                                  | `window.ChayaEdit.agentEdit.state()`：与 `edit.state` 消息同一份会话（去掉快捷键）                                                                                                       | `{ ready, error?, session }`                                    |
| `edit.apply`    | `op: GameEditCmdOp`                                                                                | 游戏内再过一次 `parseEditOp`，调 `applyEditCmd`，并推送给已订阅的修改页                                                                                                                  | `{ applied, fields }`                                           |
| `edit.action`   | `action: EditAction`                                                                               | `parseEditAction`；运行动作走 `applyEditCmd({ op: 'runAction' })`，传送 / 公共事件 / 存档 / 读档走 `Cheats`                                                                              | 各动作结果                                                      |

- 剧情记录器（`plugins/src/agent/history.ts`，ChayaAgent 加载即开始记录）：
  - 记录时机：`Window_Message.startMessage`（`$gameMessage` 里的文本：「预翻译」模式下已是译文，字幕等其他模式下是原文；快进 / 跳过的对话同样经过这里）、`Window_ChoiceList.start`（选项）、`Game_Message.onChoice`（所选项）、`Game_Map.setup`（地图切换，附地图名）、`BattleManager.setup` 与胜利 / 失败 / 逃跑、`DataManager.loadGame`（读档，之后的进度可能与之前不连续）。
  - 条目：`{ seq, at, playtime, kind: 'message' | 'choices' | 'choice' | 'map' | 'battle' | 'load', speaker?, text?, choices?, index?, mapId?, mapName?, result? }`；文本去掉颜色 / 图标等控制符，`\N[n]` / `\V[n]` / `\P[n]` 按当前值展开，单条上限 1000 字；不调用 `convertEscapeCharacters`（翻译插件挂了它）。
  - 译文：读取时对 `text` / `choices` 调 `window.ChayaTrans.translate`（只查本地翻译缓存、无副作用），结果与原文不同才附 `translated`；没装翻译插件则不附。
  - 存储：内存环形缓冲 300 条；每 5 秒（有新条目时）写一份到 `localStorage`（键含游戏标题与游戏目录路径，避免同名游戏串用），刷新游戏后可恢复；不上传、不进日志。
  - 连续相同的对话（重复触发的事件）合并计数，不重复占位。
- 移除 `plugin.call`；`plugins.list` 每项只含 `{ name, tools }`。
- `AGENT_LINK_METHODS`（DataChannel 白名单）= 除 `game.eval` 外的全部指令。
- 长轮询单次调用 15 秒（`AGENT_CALL_TIMEOUT_MS`），`player.moveTo` 上限 12 秒留出余量。
- 工具层：`makeLiveTools` 增加 `chaya_live_history` / `screenshot` / `tap` / `move_to` / `quit`（`quit` 可注入各端实现）；`makeEditTools(call)` 实现 `chaya_edit_state` / `set` / `action`，参数先经 `lib/runtime/edit-ops.ts` 校验。
- 目录：`McpToolMeta.kind?: 'game'`（缺省为工具操作），游戏操作标 `game`；`chaya_game_quit` 改名 `chaya_live_quit`（`live` 分组）。
- 图片：`mcpImage(image, meta)`（`lib/integration/tools/types.ts`）返回 `{ mcpImage: { mimeType, data }, ...meta }`；`dispatchMcp` 遇到它输出 `[{ type: 'image', data, mimeType }, { type: 'text', text: JSON(meta) }]`；`parseMcpCallResult` 把图片部分还原成同样结构，WebMCP 镜像与 Edge 返回一致；截断只算文本。

## 5. DataChannel：复用翻译 RPC

不新增消息类型。现有 `createTranslationRpc` 已有 4KB 分片（单条 < 16KiB）、并发上限、取消与超时，游戏侧的处理函数按路径路由：

- `path === '/agent'`、`method === 'POST'`：`body = { method, params }`，只允许 `AGENT_LINK_METHODS`（除 `game.eval` 外的全部指令，见 4.4），**拒绝 `game.eval`**（Edge 的 `/api/runtime/webrtc` 信令无鉴权，DataChannel 视为不可信入口）；交给 `window.ChayaAgent.run`（该入口固定不允许 eval），未加载返回 400 "ChayaAgent 未加载"。
- 其余路径照旧交给翻译运行时。

网页侧（`useGameLinkRpc`，从 `GameLinkProvider` 拆出）：

- `callAgent(method, params)` = `translationRequest({ path: '/agent', method: 'POST', body })`，`status >= 400` 抛错。
- `requestCatalog()`：发 `edit.catalog.request`，等 `edit.catalog`（10s）。
- `acquireEditSession()`：引用计数，0→1 发 `edit.subscribe`，1→0 发 `edit.unsubscribe`；连接恢复时计数 > 0 自动重发订阅。`useGameEditLinkSync` 改用它，WebMCP 读完会话不会关掉修改页的订阅。

## 6. 页面侧

### 6.1 `ChayaWebMcpHost`

挂在 `AppProviders` 的 `GameLinkProvider` 内。形态探测用 `/api/status`（`canUseDisk === false` → Edge；401 → 未授权），**不调用 `/api/integration/mcp`**（只服务集成页）。

| 注册者          | 本机 dev / App                  | Edge                                            | 未授权（公开页） |
| --------------- | ------------------------------- | ----------------------------------------------- | ---------------- |
| `chaya.page`    | 页面工具                        | 页面工具                                        | 页面工具         |
| `chaya.mcp`     | `tools/list` 镜像（含插件工具） | 4.2 矩阵中 ✓ 的工具（`components/webmcp/edge`） | —                |
| `chaya.plugins` | —（镜像已含）                   | 连上后 `plugins.list` 的 `tools`                | —                |

### 6.2 本机镜像

- 挂载、游戏连接变化、页面可见时每 30s：POST `/api/mcp` `tools/list` → `syncPageTools('chaya.mcp', defs)`。
- 执行：POST `/api/mcp` `tools/call`；`isError` → `webMcpError('mcp_error', text)`；401 → `unauthorized`；文本是 JSON 则解析为 `{ result }`，否则 `{ text }`；图片内容按 4.4 还原；文本超 100KB 截断并标 `truncated`。

### 6.3 Edge 实现

- 工具定义取自 `MCP_TOOLS`（同名同参同标注），只换执行函数；不可用工具不注册，`page_get_context.unavailableTools` 给原因（`lib/webmcp/mode-matrix.ts`）。
- 游戏库：`cloudLibraryStorage` / `selectCloudGameId`；`bind` 只接受库中已有 id。
- 目录读写：先 `queryPermission({ mode: 'read' | 'readwrite' })`，未授权返回 `permission_required`（授权需用户手势）；绝不走 `requireCloudPermission`。`status` / `shell_check` 用 `inspectCloudGame`；`plugins_install` / `clear` / `shell_install` 调对应 `cloud-prepare-game` 函数；`window` 用 `inspectCloudGame` 的 `nwPackage` 读、`writeCloudWindow` 写。
- `chaya_game_status`：与本机共用 `GameStatusView`（`lib/integration/tools/game-status.ts`）。库为空返回 `ready: false`；`serviceMode` 取 `/api/status`；网页版恒 `remote: false`、`bundled: false`、`sharedCache: null`，`translateCache.file / sizeBytes` 为 null，`contentRoot` 为相对所选目录的显示路径。
- `chaya_live_quit`：GameLink `quit`（注入 `makeLiveTools`）。
- 游戏操作 / 修改 / 翻译 / 共享翻译库 / 修改目录：`makeLiveTools` / `makeEditTools` / `makeTranslateTools` / `makeCacheTools` 注入 `callAgent` 与 `translationRequest`；未连接返回 `game_offline`。
- 日志：`GET /api/logs`（内存，跨访问者共享，`untrustedContentHint`）；不注册 `clear`。

### 6.4 修改

网页不再单独登记 `chaya_web_edit_*`；`chaya_edit_*` 随 MCP 镜像（本机）或 Edge 矩阵（Edge）出现，实现见 4.4。`acquireEditSession()` 只给修改页用。

### 6.5 页面工具 `components/webmcp/page/`

移植工单服务 10 个通用工具。差异：

- 敏感：`[data-webmcp-sensitive]` 及其子树不出现在快照与 `page_read_text`，`page_fill` 拒绝；`CopyField` 新增 `sensitive` 属性，启动链接等凭证类内容标上（集成页已不再展示令牌）。
- 禁区：确认框（`ConfirmProvider` 对话框，`data-webmcp-confirm`）内的按钮 `page_click` 返回 `needs_user_confirmation`；确认框自身的 Enter 与确认按钮也只响应 `isTrusted` 事件，脚本派发的事件无效。
- `page_get_context`：路径、标题、导航、形态、绑定游戏、连接状态、已注册的注册者、`unavailableTools`。
- `page_list_routes`：按形态列出（Edge 不列只在本机可用的页面）。
- `page_navigate`：只允许同源站内路径，`router.push` 后等地址变化（3s）。

## 7. 集成页

子导航加 `WebMCP`（`/integration/webmcp`）：支持检测、开启步骤、各形态说明、当前页已注册工具（按注册者分组，实时刷新）。游戏内「集成」页不含 WebMCP。

## 8. 安全

- 不放大权限：本机镜像以同源请求调 `/api/mcp`（本机 MCP 免授权）；页面不取任何令牌；凭证字段对页面工具不可见。
- DataChannel 入口拒绝 eval，且只放行预设指令（无 `plugin.call`）；剧情记录与 `game.state` 的画面文字暴露面相同；截图按只读 + 不可信内容标注；插件工具只接受第一方插件声明，冻结并限长；服务端再校验 `info.tools`。
- Edge 不触发目录授权弹窗；日志只读。
- `chaya_live_eval`：本机由 `tools/list`（`CHAYA_MCP_EVAL`）决定是否出现；Edge 不提供。
- 确认框需用户亲自点击。

## 9. 测试

Jest 运行在 node 环境（无 jsdom），单测覆盖纯函数与假 `modelContext`；浏览器端用临时 Playwright 脚本手动验证，不进 CI。

| 层级     | 用例                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 注册层   | 去重、`syncPageTools` 增删改、abort、错误信封、支持检测                                                                                          |
| 镜像     | 定义映射（标注）、结果解析、截断、401 / isError                                                                                                  |
| 插件工具 | 命名、目录唯一性、`sanitizePluginTools`（非第一方 / 目录外 / 伪造描述被忽略）、`tools/list` 含动态工具与 annotations、`live_call` 的 `tool` 参数 |
| 游戏侧   | `/agent` 路由白名单拒绝 eval、`plugin.call` 已移除、`plugin.tool` 执行、`game.snap` / `input.tap` / `player.moveTo` / `edit.*`                   |
| 共用工具 | translate / cache / live 工厂注入假 invoke 的参数与路径                                                                                          |
| Edge     | 矩阵与注册集合一致、权限未授权返回 `permission_required`、`game_offline`                                                                         |
| 修改     | `parseEditOp` / `parseEditAction` 校验、`edit.apply` 推送修改页、引用计数订阅                                                                    |

## 10. 修订

| 日期       | 说明                                                                                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | 初稿                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-03 | 评审修订：Edge 工具矩阵（翻译 / 翻译库 / quit / shell 经运行时实现）；形态探测改用 `/api/status`；敏感字段与确认框禁区；DataChannel 复用翻译 RPC 并拒绝 eval；插件声明限第一方；Edge 日志只读；扩展 `live_plugins` / `live_call` 替代新工具；共用工具工厂                                                                               |
| 2026-10-03 | 开发后评审：插件工具元数据改为静态目录（防游戏脚本注入描述）；`plugin.call` 只允许列出的方法（堵 `Function` 构造链）；`page_wait_for` 走脱敏文本；`page_navigate` / `page_click` 拒绝解码后的 `/api`；确认框只响应用户真实事件（`isTrusted`）；`save` 标记 destructive；镜像刷新丢弃过期响应、连上游戏后延迟补刷；Edge 插件工具退避重试 |
| 2026-10-03 | 整体评审：`plugin.call` / `plugins.list` 只允许 `ChayaEdit` / `ChayaBoost` / `ChayaTrans`（原先 `window.Chaya*` 可调 `ChayaAgent.run` 执行 eval、`stop` 停桥）；`game.eval` 只在本机长轮询路径执行；游戏上报的 `info` 只保留已知字段且不能覆盖 `gameId`；长轮询中止时命令留在队列；畸形 JSON-RPC 返回 -32600                            |
| 2026-10-03 | 工具定义统一英文（Agent 读），集成页说明按界面语言展示（`web-tools-messages.json`）；`ASK_FIRST` 抽到 `lib/integration/ask-first.ts` 供 MCP 与插件工具共用                                                                                                                                                                              |
| 2026-10-04 | 按能力总表：新增 4.4 游戏操作与修改指令（截图 / 点击 / 寻路 / 退出、`edit.*`）；移除 `plugin.call`、`chaya_web_edit_*`、ChayaEdit 插件工具与游戏内 WebMCP；MCP 图片内容                                                                                                                                                                 |
| 2026-10-04 | 4.4 增加 `game.history` 与剧情记录器（对话 / 选项 / 地图 / 战斗 / 读档，300 条环形缓冲，本机持久化）                                                                                                                                                                                                                                    |
| 2026-10-05 | 用行走 demo（`pnpm demo:walk`）实跑 MCP 全流程；`player.moveTo` 换图即停并返回 `transferred`                                                                                                                                                                                                                                            |
| 2026-10-05 | 新增 `edit.catalog`：server 的 `chaya_edit_catalog` 带 `gameId` 时从该游戏读编号，与 `chaya_edit_set` 改的是同一个游戏                                                                                                                                                                                                                  |
| 2026-10-05 | server 的 `chaya_live_quit` 改为向 `gameId` 对应的游戏发 `game.quit`（`DELETE /api/launch` 只能关 Chaya 启动且装了翻译运行时的游戏，也不分 `gameId`）；无长轮询游戏时才退回                                                                                                                                                             |
