# 插件 MCP 需求

> 能力总表：[capabilities.md](./capabilities.md)（各环境的工具以它为准）

- **日期**：2026-10-04
- **状态**：一期已实现（单游戏）；二期（多游戏登记）未开始
- **适用**：游戏内 ChayaAgent 插件自己提供的 MCP（只用 Edge、不跑本机服务时使用）
- **技术设计**：[docs/technical/mcp-gateway.md](./technical/mcp-gateway.md)
- **另见**：[本地 MCP](./mcp-local.md)、[Edge MCP](./mcp-edge.md)

---

## 1. 是什么

游戏打开后，ChayaAgent 插件在本机开一个 MCP 网关：`http://127.0.0.1:39271/mcp`（端口可改，见 §3）。Agent 配一次即可，换游戏不用改配置。

- 开启条件：游戏插件由 Edge「安装插件」写入（`ChayaEnv` 带开启标记），且游戏运行在 NW.js（有 Node 上下文）。
- 本机服务运行时由本机服务占用该端口（插件不再开），工具即本地 MCP 的全部工具。

## 2. 能力

插件 MCP 的工具是本地 MCP 的子集，只保留能在游戏进程内完成的部分。各环境能力以 [capabilities.md](./capabilities.md) 为准，代码里的矩阵为 `lib/integration/mcp-availability.ts`：

| 分组       | 插件 MCP 提供                                                                                           | 不提供（需本机服务）          |
| ---------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 游戏操作   | `chaya_live_games` / `state` / `history` / `press` / `play` / `screenshot` / `tap` / `move_to` / `quit` | `chaya_live_eval`             |
| 修改       | `chaya_edit_catalog` / `state` / `set` / `action`（与游戏内「修改」页同一套指令）                       | —                             |
| 翻译       | `chaya_translate_text` / `extract` / `job` / `engines` / `play_settings`（翻译插件运行时）              | `chaya_translate_batch`       |
| 共享翻译库 | `chaya_cache_query` / `update` / `delete` / `import`（游戏内翻译运行时）                                | —                             |
| 日志       | `chaya_logs_query` / `chaya_logs_clear`（本游戏插件日志）                                               | —                             |
| 插件功能   | `chaya_plugin_*`（`boost` / `trans` 声明的工具）、`chaya_live_plugins` / `call`                         | —                             |
| 游戏库     | —                                                                                                       | 全部（列表 / 导入 / 删除…）   |
| 当前游戏   | —                                                                                                       | 全部（启动 / 装插件 / 装壳…） |

- 修改依赖修改插件、翻译与翻译库依赖翻译插件；对应插件未装或未就绪时，工具返回明确提示而不是静默失败。
- 不开放 `eval`；`gameId` 可省略，填了必须是本游戏。
- 同时开多个游戏：一期由先启动的游戏提供（其余显示「由其他 Chaya 提供」）；二期其余游戏向它登记，工具带 `gameId` 选择目标，持有者关闭后自动接手。

## 3. 端口配置

- 默认 `39271`，在游戏内（局内面板顶栏「集成 → MCP」）修改，写入用户级端口配置文件，所有游戏、本机服务与 App 共用；删除该文件即恢复默认。改端口后在 Agent 中把地址改成新端口（或重新安装 MCP），一般设置一次即常驻。

| 平台    | 端口配置文件                                                                   |
| ------- | ------------------------------------------------------------------------------ |
| macOS   | `~/Library/Application Support/Chaya/mcp.json`                                 |
| Windows | `%APPDATA%\Chaya\mcp.json`（`C:\Users\<用户>\AppData\Roaming\Chaya\mcp.json`） |
| Linux   | `$XDG_CONFIG_HOME/chaya/mcp.json`（未设置时 `~/.config/chaya/mcp.json`）       |

- 端口只认这个文件（不提供环境变量覆盖）；macOS / Windows 的目录与 App 数据目录相同（`Chaya`），Linux 为 `chaya`。
- 保存前校验范围（1024–65535）并试监听，被占用则不保存并提示。
- 正在提供 MCP 的游戏检测到文件变化后自动换到新端口，无需重启。
- 不乱放：只写上表这一个文件（仅端口一项）；使用默认端口时不创建，改回默认即删除。

## 4. 游戏内「集成」页

局内面板顶栏「集成」与本机控制台「集成」用同一套 MCP 视图（`McpView`，游戏内通过属性切换），不含 Skills 与 WebMCP（游戏窗口里没有浏览器 Agent；外部 Agent 与内置 Agent 用同一份工具）：

- **MCP**（给外部 Agent）：
  - 概览：当前地址（可复制）与 `mcp.json` 片段；网关状态与处理建议（已开启 / 由其他 Chaya 提供 / 由本机服务提供 / 端口被占用 / 未开启）；「最近一次 Agent 请求：xx 秒前」。
  - 修改端口；端口配置文件完整路径（可复制）；「删除端口配置」（删除文件，目录为空时一并删除，恢复默认端口）、「打开所在文件夹」、「打开文档」（系统浏览器打开本文档）。
  - 工具分组：只列 §2 中插件 MCP 提供的工具；右侧试调直接调本游戏的 MCP（不经 HTTP，无 Node 时也可用）。

## 5. 安全

- 只监听本机回环地址；拒绝浏览器跨站请求（带 `Origin`）与非回环 `Host`；`eval` 永不经网关开放。

## 6. 验收

- 只用 Edge 且游戏已打开：Agent 连 `http://127.0.0.1:39271/mcp` 得到 §2 的工具（无游戏库 / 当前游戏 / `eval` / 批量翻译）；游戏操作、修改、翻译、翻译库、日志可用。
- `chaya_live_screenshot` 返回 MCP 图片内容；`chaya_live_move_to` 主角走到目标格；`chaya_edit_set {op:"gold", value:999}` 后游戏内「修改」页同步显示。
- 游戏内「集成 → MCP」列出的工具与 `tools/list` 一致，试调可直接执行。
- 游戏内改端口：保存前试监听，被占用不写文件；保存后网关自动换到新端口；使用默认端口时不存在端口配置文件。
- 「删除端口配置」后文件被删除（目录为空时目录也删除），网关回到 39271；「打开所在文件夹」「打开文档」可用。
- 端口被非 Chaya 程序占用时有明确提示；未写开启标记时不监听。

## 7. 修订

| 日期       | 说明                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-04 | 从 `integration.md` §2.1 拆出：插件 MCP 自成一份，能力为本地 MCP 的子集                                                                |
| 2026-10-04 | 增加修改目录 / 翻译 / 翻译库 / 日志；局内顶栏「MCP」改为「集成」（MCP / WebMCP）                                                       |
| 2026-10-04 | 按 [capabilities.md](./capabilities.md)：新增截图 / 点击 / 寻路 / 退出与修改工具；ChayaEdit 不再声明插件工具；游戏内「集成」只保留 MCP |
| 2026-10-04 | 游戏操作增加 `chaya_live_history`（最近剧情）                                                                                          |
