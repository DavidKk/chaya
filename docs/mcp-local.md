# 本地 MCP 需求

> 能力总表：[capabilities.md](./capabilities.md)（各环境的工具以它为准）

- **日期**：2026-10-04
- **状态**：已实现
- **适用**：本地 dev（`pnpm dev`）与 App（Electron）——即本机服务自身的 MCP
- **技术设计**：[docs/technical/integration-mcp.md](./technical/integration-mcp.md)
- **另见**：[插件 MCP](./mcp-plugin.md)、[Edge MCP](./mcp-edge.md)、[集成页](./integration.md)

---

## 1. 是什么

本机服务（dev / App）自己提供的 MCP：Agent 直连 `http://127.0.0.1:<端口>/api/mcp`（dev 为 3000，App 为 3927），免令牌、免授权。它拥有 Chaya 的**全部**能力；其中只有本机服务才有的能力（能读写本机磁盘、管理游戏库与进程）见 §2。

本文只描述本机服务自身；游戏插件提供的 MCP 由 [mcp-plugin.md](./mcp-plugin.md) 说明。

## 2. 本机独有能力

插件 MCP 只覆盖「局内实时」与插件工具；以下分组只有本机服务提供：

| 分组               | 为什么只有本机有                                   |
| ------------------ | -------------------------------------------------- |
| 游戏库 `library`   | 游戏库存在本机服务的数据目录里（列出、添加、删除） |
| 当前游戏 `game`    | 启动 / 关闭进程、装插件、装壳都要读写本机磁盘      |
| 修改目录 `edit`    | 从游戏 data 读 id 目录                             |
| 翻译 `translate`   | 抽取原文、整作补译任务、引擎配置在服务端           |
| 共享翻译库 `cache` | 翻译库存在服务端                                   |
| 日志 `logs`        | 日志汇总在服务端                                   |
| `chaya_live_eval`  | 只在本机长轮询且 `CHAYA_MCP_EVAL=1` 时开放         |

## 3. 连接

- 地址：`http://127.0.0.1:<端口>/api/mcp`，由「集成 → MCP」展示（读当前服务实际端口）。
- 鉴权：无；本机 API 只接受同源或非浏览器请求（见 [deployment-platforms.md](./technical/deployment-platforms.md)）。
- 安装：「接入 Agent」按钮只有图标 + 文字，不显示状态。「安装到 Cursor / VS Code」直接触发 deep link。Claude Code / Codex：找到 CLI 时由本机服务执行 `mcp add`；已安装（`~/.claude.json` 顶层 `mcpServers`、`$CODEX_HOME`（默认 `~/.codex`）`/config.toml` 的 `[mcp_servers.chaya]`，三平台同路径）则变为红色「从 X 卸载」，执行 `mcp remove`；找不到 CLI 时弹框复制命令。CLI 查找除 PATH 外还覆盖 GUI 启动时缺失的目录：macOS / Linux 的 `~/.local/bin`、`~/.claude/local`、Homebrew / Linuxbrew、`/snap/bin`、npm-global、bun、volta、pnpm、nvm、fnm；Windows 的 `%USERPROFILE%\.local\bin`、`%APPDATA%\npm`、`NVM_SYMLINK`、pnpm、scoop。结果用 toast 提示。下方单独一栏 `mcp.json` 可直接复制。按钮下方提示：装上后每次对话都会占用 Agent 上下文，不用 Chaya 时可卸载或在客户端里关闭 chaya。

## 4. 能力清单

命名：`chaya_<分组>_<动作>`。「对应接口」为同等效果的 HTTP API：多数工具在进程内调用该路由，行为一致；例外（`library_remark`、`logs_query`、`live_*`）见 [integration-mcp.md](./technical/integration-mcp.md) §3.2。返回体会去掉启动 token 等凭证字段。

### 4.1 游戏库 `library`

| 工具                   | 作用                                   | 主要参数             | 对应接口             |
| ---------------------- | -------------------------------------- | -------------------- | -------------------- |
| `chaya_library_list`   | 列出游戏库，可按名称 / 备注 / 路径筛选 | `q?`                 | `GET /api/status`    |
| `chaya_library_bind`   | 添加并切换到某个游戏目录               | `gameRoot`           | `PUT /api/status`    |
| `chaya_library_remark` | 修改游戏备注（不切换当前游戏）         | `gameRoot`, `remark` | 服务内直写配置       |
| `chaya_library_remove` | 从游戏库移除（不删游戏文件）⚠️         | `gameRoot`           | `DELETE /api/status` |

### 4.2 当前游戏 `game`（本机磁盘侧）

| 工具                         | 作用                                                          | 主要参数                 | 对应接口                  |
| ---------------------------- | ------------------------------------------------------------- | ------------------------ | ------------------------- |
| `chaya_game_status`          | 当前游戏详情：壳、插件、缓存、是否在线                        | —                        | `GET /api/status`         |
| `chaya_game_launch`          | 注入插件并启动游戏                                            | —                        | `POST /api/launch`        |
| `chaya_game_plugins_install` | 安装 / 更新 Loader 与插件                                     | —                        | `POST /api/plugins`       |
| `chaya_game_plugins_clear`   | 清除 Loader 与插件 ⚠️                                         | —                        | `DELETE /api/plugins`     |
| `chaya_game_shell_install`   | 安装 NW.js 壳：未给 `shellSource` 时下载最新（最长约 5 分钟） | `shellSource?`, `force?` | `POST /api/shell`         |
| `chaya_game_shell_check`     | 检查壳是否有更新                                              | —                        | `GET /api/shell`          |
| `chaya_game_shell_uninstall` | 卸载工具目录里的共用壳 ⚠️                                     | —                        | `DELETE /api/shell`       |
| `chaya_game_window`          | 读取或修改游戏窗口（标题、宽高、全屏…）                       | `window?`                | `GET` / `PUT /api/window` |

### 4.3 游戏操作 `live`（需游戏运行并加载 ChayaAgent；各端一致，见 [capabilities.md](./capabilities.md) §4）

| 工具                    | 作用                                                                                          | 主要参数                        |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------- |
| `chaya_live_games`      | 列出已连接的游戏                                                                              | —                               |
| `chaya_live_state`      | 场景、地图坐标、金钱、队伍、对话文字与选项                                                    | `gameId?`                       |
| `chaya_live_press`      | 模拟按键：确认 / 取消 / 菜单 / 方向                                                           | `key`, `frames?`                |
| `chaya_live_play`       | 按键序列，返回操作后的状态                                                                    | `steps`                         |
| `chaya_live_history`    | 最近剧情：渲染过的对话、选项与所选项、地图切换、战斗、读档（跳过的对话也在）                  | `limit?`, `kinds?`, `afterSeq?` |
| `chaya_live_screenshot` | 当前画面截图（MCP 图片内容）；较占 token，按需调用                                            | `maxWidth?`                     |
| `chaya_live_tap`        | 在画面坐标点击（菜单、对话、按钮）                                                            | `x`, `y`, `frames?`             |
| `chaya_live_move_to`    | 地图上寻路走到格子坐标，等到达或超时（上限 12 秒）                                            | `x`, `y`, `timeoutMs?`          |
| `chaya_live_quit`       | 关闭 `gameId` 对应的游戏（ChayaAgent `game.quit`）；没有连着的游戏时请求关闭 Chaya 启动的游戏 | `gameId?`                       |
| `chaya_live_eval`       | 执行任意 JS（默认关闭，`CHAYA_MCP_EVAL=1` 开启）⚠️                                            | `code`                          |

对应接口：`POST /api/runtime/agent`（游戏侧长轮询，Agent 不直接调用）。

插件功能：`chaya_live_plugins` 列出在线插件与它们声明的工具；游戏在线时出现插件工具 `chaya_plugin_boost_*` / `chaya_plugin_trans_*`（参数见 `tools/list`），也可用 `chaya_live_call {plugin, tool, input}` 调用（只能调声明的工具）。

### 4.4 修改 `edit`（与游戏内「修改」页同一套指令）

| 工具                 | 作用                                                                                                                  | 主要参数                          | 对应接口                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `chaya_edit_catalog` | 按类别搜索 id：`items` / `weapons` / `armors` / `actors` / `skills` / `states` / `classes` / `variables` / `switches` | `kind`, `q?`, `limit?`, `gameId?` | 带 `gameId` 读该游戏（ChayaAgent `edit.catalog`），否则 `GET /api/game-edit/catalog`（当前游戏的数据文件） |
| `chaya_edit_state`   | 读修改会话：金钱、物品数、变量、开关、锁定、角色、倍率、运行开关                                                      | `gameId?`                         | —                                                                                                          |
| `chaya_edit_set`     | 改值 / 锁定（金钱、物品数、变量、开关、角色属性、倍率、运行开关）                                                     | `op` + 对应参数                   | —                                                                                                          |
| `chaya_edit_action`  | 运行动作（场景 / 修复 / 战斗）、传送、公共事件、存档 ⚠️、读档 ⚠️                                                      | `id` + 对应参数                   | —                                                                                                          |

### 4.5 翻译 `translate`

| 工具                            | 作用                                                         | 主要参数                      | 对应接口                                   |
| ------------------------------- | ------------------------------------------------------------ | ----------------------------- | ------------------------------------------ |
| `chaya_translate_text`          | 翻译一段或多段文本（默认写入缓存）                           | `texts`, `force?`, `persist?` | `POST /api/translate`                      |
| `chaya_translate_extract`       | 从游戏 data 抽取原文并生成 seed                              | —                             | `POST /api/extract`                        |
| `chaya_translate_job`           | 整作补译任务：开始 / 暂停 / 查看进度                         | `action`                      | `POST /api/translate` `mode=job/progress`  |
| `chaya_translate_batch`         | 只补译一批缺词                                               | `limit?`                      | `POST /api/translate` `mode=seed`          |
| `chaya_translate_engines`       | 读取或修改引擎开关与顺序（`ollama` / `bing` / `google`）     | `switches?`, `order?`         | `POST /api/translate` `mode=switches`      |
| `chaya_translate_play_settings` | 读取或修改游戏内翻译方式（预翻译 / 实时 / 字幕）、模型、超时 | `settings?`                   | `POST /api/translate` `mode=play-settings` |

### 4.6 共享翻译库 `cache`（CRUD + 筛选）

| 工具                 | 作用                                                                              | 主要参数                                                          | 对应接口                      |
| -------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| `chaya_cache_query`  | 分页查询：关键词 / 引擎 / 只看敏感 / 排序（`updated` \| `hits`，`asc` \| `desc`） | `q?`, `engine?`, `nsfw?`, `sort?`, `order?`, `page?`, `pageSize?` | `GET /api/translate-cache`    |
| `chaya_cache_update` | 修改一条译文                                                                      | `src`, `zh`                                                       | `PATCH /api/translate-cache`  |
| `chaya_cache_delete` | 删除一条译文 ⚠️                                                                   | `src`                                                             | `DELETE /api/translate-cache` |
| `chaya_cache_import` | 导入 JSON / NDJSON 译文                                                           | `text`, `overwrite?`                                              | `POST /api/translate-cache`   |

### 4.7 日志 `logs`

| 工具               | 作用                                                                                        | 主要参数                                      | 对应接口           |
| ------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------ |
| `chaya_logs_query` | 查询最近日志，按来源 / 级别（`ok` / `warn` / `fail` / `info` / `debug`）/ 时间 / 关键词筛选 | `limit?`, `source?`, `level?`, `since?`, `q?` | `GET /api/logs`    |
| `chaya_logs_clear` | 清空日志 ⚠️                                                                                 | —                                             | `DELETE /api/logs` |

⚠️ = 破坏性或不可逆，工具描述中要求 Agent 先征得用户同意。

### 4.8 不暴露的接口

| 接口                                                         | 原因                                     |
| ------------------------------------------------------------ | ---------------------------------------- |
| `POST /api/pick`、`POST /api/reveal`                         | 弹本机原生对话框 / Finder，Agent 用不上  |
| `logs/stream`、`plugins/stream`                              | SSE 推流，MCP 只回 JSON                  |
| `runtime/heartbeat`、`runtime/webrtc`、`runtime/agent`       | 游戏与控制台内部通道                     |
| `access`、`remote/nw-meta`、`POST /api/logs`                 | 授权 / 下载元信息 / 插件上报，非操作能力 |
| `POST /api/translate` 的 `lookup` / `realtime` / `benchmark` | 插件专用或耗时测速                       |

## 5. 本机「集成 → MCP」页面

- 只介绍本机服务自身：服务地址、安装方式、`chaya_live_eval` 开关状态；不展示插件 MCP 或网关的连接方式。
- 分组目录：七个分组，每个工具一张卡片——名称、说明、参数表（必填 / 类型 / 说明）、对应接口、⚠️ 标记。
- 试调：选择工具、编辑 JSON 参数、执行，显示返回结果。
- 本机 WebMCP 页同样只描述本机：页面注册的 MCP 工具镜像本机 `/api/mcp`，另有页面工具。

## 6. 验收

- `tools/list` 返回 §4 全部工具（`chaya_live_eval` 视开关）；目录与实现一一对应（单测保证）。
- 七个分组都有工具层单测（参数校验、接口映射、脱敏）；读类工具另有本机实例端到端验证。写类 / 耗时工具复用已有接口，MCP 层只测参数映射。
- 页面与 `/api/integration/mcp` 不展示任何凭证。

## 7. 修订

| 日期       | 说明                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-04 | 从 `integration.md` 拆出：本地 MCP 自成一份，标注本机独有能力                                                                                         |
| 2026-10-04 | 按 [capabilities.md](./capabilities.md)：新增截图 / 点击 / 寻路与修改工具；`chaya_game_quit` 改名 `chaya_live_quit`；`chaya_live_call` 只调声明的工具 |
| 2026-10-04 | 新增 `chaya_live_history`（最近剧情：对话 / 选项 / 地图 / 战斗 / 读档）                                                                               |
