# WebMCP 与插件工具需求

> 状态：开发中 · 2026-10-03
> 技术方案：[`technical/webmcp.md`](./technical/webmcp.md) · 关联：[`integration.md`](./integration.md)（集成页与本机 MCP）

## 1. 背景与目标

本机 MCP（`/api/mcp`）只在本机 dev / App 可用；网页版（Edge）没有 MCP。WebMCP 是 Chrome 的浏览器原生能力（`document.modelContext.registerTool`）：页面打开期间向浏览器注册工具，浏览器里的 Agent 发现并调用，调用在页面内执行、沿用当前页面的访问权限。

目标：

1. **所有 Web 页面**注册 WebMCP 工具（首页、游戏库、修改、翻译、日志、共享翻译库、集成、脚本查看页）。
2. **WebMCP 是 MCP 的超集**：包含全部 `chaya_*` MCP 工具（同名、同参数、同返回），另有页面操作与局内实时修改等能力。
3. **三种形态都对外提供 MCP**：本机 dev / App 同时有本机 MCP 与 WebMCP；Edge 由 WebMCP 提供，工具在浏览器内执行。
4. **插件也能生成对外工具**：游戏内第一方插件声明工具，游戏运行时自动出现在本机 MCP 与 WebMCP 中。

## 2. 各形态的对外 MCP

| 形态       | 本机 MCP（HTTP）   | WebMCP                                                                   | 插件工具                                   |
| ---------- | ------------------ | ------------------------------------------------------------------------ | ------------------------------------------ |
| 本机 dev   | `/api/mcp`（已有） | 全部 MCP 工具（转发本机 MCP）+ 页面工具 + 局内修改                       | 本机 MCP 与 WebMCP（经 ChayaAgent 长轮询） |
| App        | 同上               | 同上，需在 Chrome 中打开 `http://localhost:3927`（App 窗口内没有 Agent） | 同上                                       |
| Edge       | 不提供（见 2.1）   | 26 / 32 个 MCP 工具在浏览器内执行（见 4.2）+ 页面工具 + 局内修改         | WebMCP（经游戏 DataChannel）               |
| 游戏内插件 | —                  | 不注册（见 2.2）                                                         | 由插件声明，经 ChayaAgent 对外             |

### 2.1 Edge 不提供远程 HTTP MCP

网页版跑在 Vercel 函数上：服务端碰不到用户的游戏目录与本机进程，函数实例之间也没有共享状态与长连接，没法把外部 Agent 的请求中继到用户的页面或游戏。Edge 的对外 MCP 就是页面里的 WebMCP；Claude Code、Cursor 等外部 Agent 想用 Edge 能力需改用本机 dev / App。以后若要做中继，前提是引入共享存储 / 长连接（如 KV、Durable Object）并配对令牌。

### 2.2 游戏窗口不注册 WebMCP

游戏跑在 NW.js 窗口里，没有能发现 WebMCP 的浏览器 Agent。插件能力改为"插件声明工具 → ChayaAgent 上报 → 本机 MCP / WebMCP 生成工具"，三种形态通用。

## 3. 使用方式

1. Chrome 146+：打开 `chrome://flags/#enable-webmcp-testing` 设为 Enabled 并重启。
2. 打开任一 Chaya 页面；浏览器内 Agent 即可看到工具。
3. 集成页新增 **WebMCP** 子页：当前浏览器是否支持、本页已注册工具（按来源分组）、开启方法、各形态说明。

## 4. 工具清单

### 4.1 MCP 镜像（本机 dev / App）

页面加载后读取本机 MCP 的 `tools/list`（含 `chaya_live_eval` 开关与在线游戏的插件工具），逐个注册为同名 WebMCP 工具，执行时以同源请求调 `/api/mcp` 的 `tools/call`，结果与直连本机 MCP 一致。清单在游戏连接变化时与每 30 秒同步一次。

### 4.2 Edge 工具矩阵

| 分组       | 工具                                                     | Edge | 实现 / 不可用原因                                                        |
| ---------- | -------------------------------------------------------- | ---- | ------------------------------------------------------------------------ |
| 游戏库     | `list` / `bind` / `remark` / `remove`                    | ✓    | 浏览器游戏库；`bind` 只切换已在库中的游戏（添加需用户选目录）            |
| 当前游戏   | `status`、`shell_check`                                  | ✓    | 读游戏目录（需已授权读取）                                               |
|            | `plugins_install` / `plugins_clear`、`shell_install`     | ✓    | 经目录授权写入；未授权返回 `permission_required`（授权需用户在页面点击） |
|            | `quit`                                                   | ✓    | 经 DataChannel 通知游戏退出                                              |
|            | `launch`                                                 | ✗    | 网页不能启动本机进程                                                     |
|            | `shell_uninstall`                                        | ✗    | 共用壳目录只存在于本机服务                                               |
|            | `window`                                                 | ✗    | 网页版未实现 package.json 窗口配置                                       |
| 局内实时   | `games` / `state` / `plugins` / `call` / `press`         | ✓    | 经 DataChannel 交给游戏内 ChayaAgent                                     |
|            | `eval`                                                   | ✗    | 网页版无服务端开关，游戏侧拒绝来自 DataChannel 的 eval                   |
| 修改目录   | `catalog`                                                | ✓    | 经 DataChannel 向游戏请求                                                |
| 翻译       | `text` / `extract` / `job` / `engines` / `play_settings` | ✓    | 经 DataChannel 由游戏内翻译运行时执行（游戏需在线）                      |
|            | `batch`                                                  | ✗    | 游戏内运行时没有单批补译，用 `job` 代替                                  |
| 共享翻译库 | `query` / `update` / `delete` / `import`                 | ✓    | 经 DataChannel 由游戏内翻译运行时执行                                    |
| 日志       | `query`                                                  | ✓    | 网页版内存日志（与其他访问者共用，结果视为不可信）                       |
|            | `clear`                                                  | ✗    | 会清掉其他访问者的日志                                                   |

`page_get_context` 返回 `unavailableTools: [{ name, reason }]`，Agent 能知道缺什么、为什么。

### 4.3 额外能力（WebMCP 独有，三种形态）

| 分组     | 工具                                                                                                                                                                    | 说明                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 页面     | `page_get_context`、`page_list_routes`、`page_navigate`、`page_snapshot`、`page_read_text`、`page_click`、`page_fill`、`page_press_key`、`page_scroll`、`page_wait_for` | 读页面、按编号点击 / 填写 / 按键 / 滚动 / 等待、站内跳转（对齐工单服务通用工具）                      |
| 局内修改 | `chaya_web_edit_state`、`chaya_web_edit_set`、`chaya_web_edit_action`                                                                                                   | 与修改页同一通道：读实时会话（金钱、物品、变量、开关、锁、角色、运行开关），改值 / 锁定，执行运行动作 |

### 4.4 插件工具

第一方插件（`plugins/manifest.json` 中列出的）在游戏内声明工具，名称 `chaya_plugin_<插件>_<动作>`（插件名去掉 `Chaya` 前缀小写）：

| 插件       | 工具                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| ChayaEdit  | `gold`、`item`、`variable`、`switch`、`god`、`through`、`teleport`、`save` ⚠️、`load` ⚠️、`find`、`common_event` |
| ChayaBoost | `on`、`off`、`status`                                                                                            |
| ChayaTrans | `status`、`reload`                                                                                               |

- 游戏连上后出现，断开后消失。本机 MCP 的 `tools/list` 随在线游戏变化；客户端没有重新拉清单时，`chaya_live_plugins` 也返回各插件声明的工具与参数，`chaya_live_call` 可按工具名调用。
- 新增插件工具需在 `lib/runtime/plugin-tool-catalog.ts` 登记元数据（描述、参数、标注），插件内只提供实现；未登记的工具名会被丢弃。

## 5. 约束

- 不放大权限：本机形态 WebMCP 走 `/api/mcp`，与控制台一样只靠同源校验（本机 MCP 免授权）；页面不额外取任何令牌。公开页（脚本查看页）只注册页面工具。
- 标注：只读工具 `readOnlyHint`，其余全部 `consequentialHint`；镜像与游戏相关工具都标 `untrustedContentHint`（游戏名、文本、日志来自游戏）。破坏性工具描述写明先征得用户同意。
- 页面工具不读 cookie / storage / 剪贴板，不跳站外；凭证等敏感内容不返回、不可填写；确认框内的按钮不允许 Agent 点击（需用户亲自确认）。
- 插件声明只接受第一方插件，声明冻结、长度受限；描述作为不可信内容。
- 不支持 WebMCP 的浏览器整段跳过，不影响页面。

## 6. 验收

1. 本机 dev + 开启 WebMCP 的 Chrome 打开任一页面：`getTools()` 包含本机 MCP `tools/list` 全部工具 + 10 个页面工具 + 3 个局内修改工具，无重名；切页不重复注册。
2. 镜像工具结果与 `/api/mcp` 直调一致（抽查 `chaya_library_list`、`chaya_logs_query`、`chaya_cache_query`）。
3. Edge（`pnpm dev` 切到 Edge）：注册 4.2 中 ✓ 的工具与 4.3 全部工具；`chaya_library_list` 返回浏览器游戏库；`page_get_context.unavailableTools` 列出 6 个 ✗ 工具。
4. 游戏连上后插件工具出现在本机 MCP `tools/list` 与 WebMCP，`chaya_plugin_boost_status` 可调用；断开后消失。
5. `page_snapshot` 不返回标记为敏感的内容；确认框按钮 `page_click` 被拒绝。
6. 集成页 WebMCP 子页显示支持状态与工具清单；不支持的浏览器显示开启方法且无报错。
