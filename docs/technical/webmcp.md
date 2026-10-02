# WebMCP 与插件工具技术方案

> 状态：开发中 · 2026-10-03
> 需求：[`../webmcp.md`](../webmcp.md) · 关联：[`integration-mcp.md`](./integration-mcp.md)
> 参考：工单服务 `initializer/webmcp`、`biz/webmcp`（`docs/technical/console-webmcp.md`）

## 1. 总体

```text
本机 dev / App                                     Edge
┌────────────── 页面 (Chrome WebMCP) ─────────────┐ ┌─────────────── 页面 ───────────────┐
│ chaya.page    page_* 10 个（DOM）                 │ │ chaya.page    同左                  │
│ chaya.edit    chaya_web_edit_* ──┐                │ │ chaya.edit    同左 ──┐              │
│ chaya.mcp     tools/list 镜像 ───┼──→ /api/mcp    │ │ chaya.mcp     浏览器实现 ─┬→ IndexedDB / 目录授权 / /api/logs
│               （含插件工具）      │       │        │ │ chaya.plugins 插件工具 ─┐ │          │
└──────────────────────────────────┼───────┼────────┘ └─────────────────────────┼─┼──────────┘
                                   │       ↓ agent bridge（长轮询）             ↓ ↓
                          GameLink DataChannel（edit.* / translation.rpc，'/agent' 路径）
                                   ↓
                     游戏内 ChayaEdit 会话 / 翻译运行时 / ChayaAgent（插件声明的工具）
```

- 页面工具与局内修改三种形态一致；MCP 部分按形态切换执行方式，工具名、参数、返回一致。
- 本机镜像以 `tools/list` 为准：服务端新增工具、`CHAYA_MCP_EVAL`、在线游戏的插件工具自动出现在 WebMCP。
- 翻译 / 共享翻译库 / 局内实时三组工具的实现抽成"注入调用方式"的工厂，服务端注入进程内路由与 agent bridge，Edge 注入 DataChannel，两端共用参数校验与返回格式。

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
  live.ts                  # makeLiveTools({ games, call })（含插件工具调用）
  catalog.ts               # filterCatalog + chaya_edit_catalog 参数处理
lib/webmcp/
  mcp-mirror.ts            # tools/list 条目 → WebMCP 定义（标注映射）、tools/call 结果解析与截断
  mode-matrix.ts           # Edge 不可用工具与原因（page_get_context、测试共用）
lib/runtime/plugin-tool-catalog.ts  # 插件工具静态元数据（描述 / schema / 标注）
lib/runtime/plugin-tools.ts  # 命名、目录查找、上报校验、第一方插件名单
components/webmcp/
  ChayaWebMcpHost.tsx      # AppProviders 内挂一次：探测形态，挂四个注册者
  mcp-mirror-client.ts     # 本机：拉 tools/list、调用 /api/mcp
  edge/{library,game,link,index}.ts  # Edge 浏览器实现（按分组拆；日志查询在 link.ts）
  edit-tools.ts            # chaya_web_edit_*
  page/                    # 页面工具（移植工单服务：elements / snapshot / actions / tools）
components/GameLinkProvider.tsx  # 增加 callAgent / requestCatalog / acquireEditSession（拆 useGameLinkRpc）
components/integration/webmcp/WebMcpView.tsx
plugins/src/helpers/plugin-tools.ts   # declarePluginTools(plugin, { tool: run })
plugins/src/cheat/console/tools.ts、game-boost.ts、translator/index.ts 内提供实现
```

## 3. 注册层 `initializer/webmcp`

移植工单服务实现，差异：

- `registerPageTools(registrarId, tools, signal)`：按工具名去重，开发环境重名抛错，生产告警跳过。
- `syncPageTools(registrarId, tools)`：同一注册者的工具会变化（镜像随在线游戏增减插件工具、Edge 插件工具随连接变化）。每个工具独立 `AbortController`；按名比较：新增注册，消失 abort，描述 / schema / 标注变化的先 abort 再注册。返回 `dispose()`。
- `execute` 统一包错误信封，异常转 `webMcpError('internal_error', message)`。
- 标注：非 `readOnly` 的工具一律 `consequentialHint`；镜像工具、Edge MCP 工具、插件工具、局内修改一律 `untrustedContentHint`（返回值含游戏或日志文本）。

## 4. MCP 侧改动

### 4.1 标注

`McpToolMeta` 增加 `readOnly?: true`（list / status / shell_check / games / state / plugins / catalog / logs_query / cache_query）。`tools/list` 每项返回标准 `annotations: { readOnlyHint?, destructiveHint? }`。

### 4.2 插件工具

- `lib/runtime/plugin-tool-catalog.ts`：`PLUGIN_TOOL_CATALOG` 是全部第一方插件工具的**静态元数据**（插件、工具名、标题、描述、schema、`readOnly` / `destructive`）。游戏只上报"实现了哪些工具"，Agent 看到的描述与 schema 一律取自这里——游戏内任意脚本都能写全局注册表，不能让它把文本注入 `tools/list`。
- `lib/runtime/plugin-tools.ts`：

  ```ts
  pluginToolName('ChayaEdit', 'gold') // → 'chaya_plugin_edit_gold'
  findPluginToolMeta(plugin, tool) // 查目录
  sanitizePluginTools(raw): PluginToolMeta[] // 只读上报里的 plugin / tool，映射到目录条目；其余字段忽略
  ```

- 游戏内：`declarePluginTools(plugin, { tool: run })` 冻结后写入 `globalThis.__chayaPluginTools[plugin]`，不在目录里的工具名丢弃。ChayaAgent：
  - `plugins.list` 结果每项附 `tools`（目录元数据）。
  - 新命令 `plugin.tool { plugin, tool, input }` → `run(input)`，结果过 `toJsonSafe`；目录外的工具名一律"插件工具不存在"。
  - `info.tools` 每次长轮询上报；`window.ChayaAgent.run(cmd)` 在模块加载时挂上，与长轮询循环独立（Edge 下长轮询 404 也可经 DataChannel 用）。
  - 404 时日志改为"网页版经游戏连接提供 Agent 能力"。
- `plugin.call` 链式调用每一步只允许 `methods` 列出的方法（不含 `Object.prototype`、`constructor`、`_*`），且调用对象必须是非函数对象——否则可经 `__lookupGetter__` / `constructor` 拿到 `Function` 执行任意代码，绕过对 `game.eval` 的拒绝。
- 服务端：`/api/runtime/agent` 对 `info.tools` 过 `sanitizePluginTools`；`agent-bridge` 记录每个游戏的工具，`listPluginTools()` 汇总在线游戏（同名去重）。省略 `gameId` 时，若只有一个在线游戏声明了该工具则默认路由给它。
- `initializer/mcp.ts`：`McpServerConfig.dynamicTools?: () => McpTool[]`；`tools/list` / `tools/call` 合并静态 + 动态。`McpTool` 增加 `annotations`。插件工具 `inputSchema` 额外加可选 `gameId`，`run` → `plugin.tool`。
- 已有工具扩展（不新增工具名）：`chaya_live_plugins` 返回各插件 `methods` + `tools`；`chaya_live_call` 新增 `tool` 参数（与 `method` 二选一），供未刷新 `tools/list` 的客户端调用。
- `capabilities.tools.listChanged` 维持 `false`，`MCP_INSTRUCTIONS` 说明插件工具随游戏在线变化。

### 4.3 各插件声明

| 插件       | 工具 → 实现（复用插件现有方法）                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChayaEdit  | `gold{value}`、`item{kind,id,count}` → `item/weapon/armor`、`variable{id,value}`、`switch{id,value}`、`god{on}`、`through{on}`、`teleport{mapId,x,y}`、`save{slot}`、`load{slot}`⚠️、`find{kind,keyword}`、`common_event{id}` |
| ChayaBoost | `on{rate?}`、`off{}`、`status{}`                                                                                                                                                                                              |
| ChayaTrans | `status{}`、`reload{}`                                                                                                                                                                                                        |

`readOnly`：`find` / `status`。`destructive`：`save`（覆盖存档位）、`load`。

## 5. DataChannel：复用翻译 RPC

不新增消息类型。现有 `createTranslationRpc` 已有 4KB 分片（单条 < 16KiB）、并发上限、取消与超时，游戏侧的处理函数按路径路由：

- `path === '/agent'`、`method === 'POST'`：`body = { method, params }`，只允许 `game.state` / `plugins.list` / `plugin.call` / `plugin.tool` / `input.press`，**拒绝 `game.eval`**（Edge 的 `/api/runtime/webrtc` 信令无鉴权，DataChannel 视为不可信入口）；交给 `window.ChayaAgent.run`（该入口固定不允许 eval），未加载返回 400 "ChayaAgent 未加载"。
- 其余路径照旧交给翻译运行时。

网页侧（`useGameLinkRpc`，从 `GameLinkProvider` 拆出）：

- `callAgent(method, params)` = `translationRequest({ path: '/agent', method: 'POST', body })`，`status >= 400` 抛错。
- `requestCatalog()`：发 `edit.catalog.request`，等 `edit.catalog`（10s）。
- `acquireEditSession()`：引用计数，0→1 发 `edit.subscribe`，1→0 发 `edit.unsubscribe`；连接恢复时计数 > 0 自动重发订阅。`useGameEditLinkSync` 改用它，WebMCP 读完会话不会关掉修改页的订阅。

## 6. 页面侧

### 6.1 `ChayaWebMcpHost`

挂在 `AppProviders` 的 `GameLinkProvider` 内。形态探测用 `/api/status`（`canUseDisk === false` → Edge；401 → 未授权），**不调用 `/api/integration/mcp`**（会返回令牌）。

| 注册者          | 本机 dev / App                  | Edge                                            | 未授权（公开页） |
| --------------- | ------------------------------- | ----------------------------------------------- | ---------------- |
| `chaya.page`    | 页面工具                        | 页面工具                                        | 页面工具         |
| `chaya.edit`    | `chaya_web_edit_*`              | 同左                                            | —                |
| `chaya.mcp`     | `tools/list` 镜像（含插件工具） | 4.2 矩阵中 ✓ 的工具（`components/webmcp/edge`） | —                |
| `chaya.plugins` | —（镜像已含）                   | 连上后 `plugins.list` 的 `tools`                | —                |

### 6.2 本机镜像

- 挂载、游戏连接变化、页面可见时每 30s：POST `/api/mcp` `tools/list` → `syncPageTools('chaya.mcp', defs)`。
- 执行：POST `/api/mcp` `tools/call`；`isError` → `webMcpError('mcp_error', text)`；401 → `unauthorized`；文本是 JSON 则解析为 `{ result }`，否则 `{ text }`；超 100KB 截断并标 `truncated`。

### 6.3 Edge 实现

- 工具定义取自 `MCP_TOOLS`（同名同参同标注），只换执行函数；不可用工具不注册，`page_get_context.unavailableTools` 给原因（`lib/webmcp/mode-matrix.ts`）。
- 游戏库：`cloudLibraryStorage` / `selectCloudGameId`；`bind` 只接受库中已有 id。
- 目录读写：先 `queryPermission({ mode: 'read' | 'readwrite' })`，未授权返回 `permission_required`（授权需用户手势）；绝不走 `requireCloudPermission`。`status` / `shell_check` 用 `inspectCloudGame`；`plugins_install` / `clear` / `shell_install` 调对应 `cloud-prepare-game` 函数。
- `quit`：GameLink `quit`。
- 局内实时 / 翻译 / 共享翻译库 / 修改目录：`makeLiveTools` / `makeTranslateTools` / `makeCacheTools` 注入 `callAgent` 与 `translationRequest`；未连接返回 `game_offline`。
- 日志：`GET /api/logs`（内存，跨访问者共享，`untrustedContentHint`）；不注册 `clear`。

### 6.4 局内修改 `edit-tools.ts`

- `chaya_web_edit_state`：`acquireEditSession()`，等第一份 `edit.state`（5s）后释放，返回会话。
- `chaya_web_edit_set`：`{ op, ... }`，`op` ∈ `gold | goldLock | count | countLock | var | varLock | sw | swLock | runFlag | walkRate | runRate | expRate | actor | actorVitalLock | actorOwnedLock`，按 `GameEditCmdOp` 校验后发 `edit.cmd`，等同 `cmdId` 的 `edit.ack`（5s，无需订阅）。
- `chaya_web_edit_action`：`{ id: RunActionId }`。
- `RunActionId` / `RunFlagKey` 增加运行时常量数组，类型由数组推导。

### 6.5 页面工具 `components/webmcp/page/`

移植工单服务 10 个通用工具。差异：

- 敏感：`[data-webmcp-sensitive]` 及其子树不出现在快照与 `page_read_text`，`page_fill` 拒绝；`CopyField` 新增 `sensitive` 属性，集成页令牌、含令牌的命令、启动链接标上。
- 禁区：确认框（`ConfirmProvider` 对话框，`data-webmcp-confirm`）内的按钮 `page_click` 返回 `needs_user_confirmation`；确认框自身的 Enter 与确认按钮也只响应 `isTrusted` 事件，脚本派发的事件无效。
- `page_get_context`：路径、标题、导航、形态、绑定游戏、连接状态、已注册的注册者、`unavailableTools`。
- `page_list_routes`：按形态列出（Edge 不列只在本机可用的页面）。
- `page_navigate`：只允许同源站内路径，`router.push` 后等地址变化（3s）。

## 7. 集成页

子导航加 `WebMCP`（`/integration/webmcp`）：支持检测、开启步骤、各形态说明、当前页已注册工具（按注册者分组，实时刷新）。

## 8. 安全

- 不放大权限：本机镜像用 cookie 调 `/api/mcp`；页面不取令牌；令牌字段对页面工具不可见。
- DataChannel 入口拒绝 eval；插件工具只接受第一方插件声明，冻结并限长；服务端再校验 `info.tools`。
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
| 游戏侧   | `/agent` 路由白名单拒绝 eval、`plugin.call` 原型链 gadget 被拒、`plugin.tool` 执行                                                               |
| 共用工具 | translate / cache / live 工厂注入假 invoke 的参数与路径                                                                                          |
| Edge     | 矩阵与注册集合一致、权限未授权返回 `permission_required`、`game_offline`                                                                         |
| 修改     | `edit_set` 参数校验、ack 等待、引用计数订阅                                                                                                      |

## 10. 修订

| 日期       | 说明                                                                                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | 初稿                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-03 | 评审修订：Edge 工具矩阵（翻译 / 翻译库 / quit / shell 经运行时实现）；形态探测改用 `/api/status`；敏感字段与确认框禁区；DataChannel 复用翻译 RPC 并拒绝 eval；插件声明限第一方；Edge 日志只读；扩展 `live_plugins` / `live_call` 替代新工具；共用工具工厂                                                                               |
| 2026-10-03 | 开发后评审：插件工具元数据改为静态目录（防游戏脚本注入描述）；`plugin.call` 只允许列出的方法（堵 `Function` 构造链）；`page_wait_for` 走脱敏文本；`page_navigate` / `page_click` 拒绝解码后的 `/api`；确认框只响应用户真实事件（`isTrusted`）；`save` 标记 destructive；镜像刷新丢弃过期响应、连上游戏后延迟补刷；Edge 插件工具退避重试 |
| 2026-10-03 | 整体评审：`plugin.call` / `plugins.list` 只允许 `ChayaEdit` / `ChayaBoost` / `ChayaTrans`（原先 `window.Chaya*` 可调 `ChayaAgent.run` 执行 eval、`stop` 停桥）；`game.eval` 只在本机长轮询路径执行；游戏上报的 `info` 只保留已知字段且不能覆盖 `gameId`；长轮询中止时命令留在队列；畸形 JSON-RPC 返回 -32600                            |
