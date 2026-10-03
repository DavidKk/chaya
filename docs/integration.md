# 集成（Skills / MCP）需求

- **日期**：2026-10-03
- **状态**：已定稿，首版实现
- **技术设计**：[docs/technical/integration-mcp.md](./technical/integration-mcp.md)；统一入口见 [docs/technical/mcp-gateway.md](./technical/mcp-gateway.md)
- **参考**：工单服务 `/integration/skill`、`/integration/mcp`

---

## 1. 目标

让用户和 Agent（Cursor / Claude Code / Codex / VS Code）都能看懂并接入 Chaya：

- **Skills**：给人和 Agent 读的使用手册——Chaya 是什么、三种形态怎么装、怎么启动游戏、Agent 怎么用 MCP。每份 Skill 都可以一键装进 Agent。
- **MCP**：本机 MCP 服务的全部工具清单、参数、示例与安装方式；本机形态下可在页面上直接试调。
- **只绑一次**：Agent 只配置一个固定地址，本机服务 / 只用 Edge / 换游戏都不用改配置（§2.1）。

## 2. 入口与路由

| 路由                       | 内容                                             |
| -------------------------- | ------------------------------------------------ |
| 顶栏「集成」               | 在游戏库（`/game`）旁新增主导航项                |
| `/integration`             | 重定向到 `/integration/skills`                   |
| `/integration/skills`      | 默认打开第一份 Skill                             |
| `/integration/skills/<id>` | Skill 详情：左侧 Skill 列表，右侧渲染正文        |
| `/integration/mcp`         | MCP 文档：连接方式、安装按钮、按分组列出全部工具 |
| `/skills/<id>.md`（公开）  | Skill 原文（纯文本 Markdown），供 `curl` 安装    |

- 集成页**不要求绑定游戏**；三种形态都能打开。
- Edge（Vercel）没有服务端 MCP：外部 Agent 连用户本机游戏提供的网关（§2.1），浏览器内 Agent 用 WebMCP；不提供试调。

### 2.1 统一 MCP 入口（本机网关）

- 统一地址：`http://127.0.0.1:39271/mcp`（端口可在游戏内修改，见下），所有 Agent（Cursor / Claude Code / Codex / VS Code）只配置这一个。
- 谁提供：

| 场景                      | 提供者                      | 可用工具                                  |
| ------------------------- | --------------------------- | ----------------------------------------- |
| 本机服务（dev / App）运行 | 本机服务（复用 `/api/mcp`） | 第 4 节全部工具，与现在一致               |
| 只用 Edge，游戏已打开     | 游戏内 ChayaAgent 插件      | 局内实时 `live` 与插件工具（不含 `eval`） |
| 都没开                    | 无                          | Agent 显示连接失败，打开后下次请求即恢复  |

- **本机服务照旧**：`/api/mcp`（`localhost:3000` / App `3927`）保留，工具与免授权行为不变，作为兼容地址。
- 同时开多个游戏：一期由先启动的游戏提供（其余提示「已有 Chaya 提供 MCP」）；二期其余游戏向它登记，工具带 `gameId` 选择目标，持有者关闭后自动接手。
- 端口默认 `39271`，在游戏内（局内面板顶栏「MCP」）或本机「集成 → MCP」修改，写入用户级端口配置文件，所有游戏、本机服务与 App 共用；删除该文件即恢复默认。改端口后在 Agent 中把地址改成新端口（或重新安装 MCP），一般设置一次即常驻。

| 平台    | 端口配置文件                                                                   |
| ------- | ------------------------------------------------------------------------------ |
| macOS   | `~/Library/Application Support/Chaya/mcp.json`                                 |
| Windows | `%APPDATA%\Chaya\mcp.json`（`C:\Users\<用户>\AppData\Roaming\Chaya\mcp.json`） |
| Linux   | `$XDG_CONFIG_HOME/chaya/mcp.json`（未设置时 `~/.config/chaya/mcp.json`）       |

- 端口只认这个文件（不提供环境变量覆盖），保证游戏、本机服务、App 看到的是同一个端口；macOS / Windows 的目录与 App 数据目录相同（`Chaya`），Linux 为 `chaya`。
- 保存前校验范围（1024–65535）并试监听，被占用则不保存并提示。
- 正在提供 MCP 的游戏检测到文件变化后自动换到新端口，无需重启。
- 不乱放：只写上表这一个文件（仅端口一项）；使用默认端口时不创建，改回默认即删除。
- 游戏内与本机「集成 → MCP」都提供「删除端口配置」（删除文件，目录为空时一并删除，恢复默认端口；只用 Edge、从未装 App 时目录会被清干净）、「打开所在文件夹」、「打开文档」（系统浏览器打开本文档）。

- 展示：本机、Edge 的「集成 → MCP」与游戏内都展示同一个统一地址。
  - Edge 页面只是静态文档：三步前提（① 在 Edge 游戏库给游戏「安装插件」② 打开游戏 ③ Agent 连接统一地址）、「默认 39271，若在游戏内改过以游戏内显示为准」、各平台端口配置文件位置；不展示端口占用或服务是否开启；只提供局内工具，工具列表中其余分组标注「需本机服务」。
  - 游戏内（局内面板顶栏「MCP」）显示：当前地址、网关状态与处理建议（已开启 / 由其他 Chaya 提供 / 端口被占用 / 未开启 / 由本机服务提供）、「最近一次 Agent 请求：xx 秒前」、修改端口入口、端口配置文件完整路径（可复制）。
  - 本机「集成 → MCP」按实际生效端口展示地址与安装链接，并提供改端口、删除端口配置、打开所在文件夹（只装 App / 只跑本机服务的用户不必先开游戏）。
- 安全：只监听本机回环地址；拒绝浏览器跨站请求；`eval` 永不经网关开放。
- 不做：Edge 服务端 MCP / OAuth 授权、stdio 启动器、每个游戏单独一个 MCP（取舍见技术设计 §1）。

## 3. Skills 内容清单

每份 Skill 是一个 `skills/<id>/SKILL.md`（带 `name` / `description` frontmatter，Agent 可直接安装）。

### 3.1 `chaya-setup` — Chaya 是什么 / 三种形态 / 安装

1. Chaya 是什么：RPG Maker MV/MZ 游戏的本机工具箱（游戏库、NW.js 壳、局内修改、翻译、日志）。
2. 三种形态对比表：Edge（网页）/ 本地 dev / App——是什么、能做什么、不能做什么、适合谁。
3. Edge：打开 `https://chaya-gray.vercel.app`，Chrome / Edge 浏览器用目录授权写插件与壳；不启动进程、无共享翻译库；外部 Agent 经游戏内网关使用局内工具（§2.1）。
4. 本地 dev：`git clone` → `pnpm i` → `pnpm dev`（`localhost:3000`），打开即可使用，无需登录；`pnpm dev:lan` 局域网；`pnpm dev:app` 带 Electron 窗口。
5. App：从 GitHub Release 下载 zip（Apple 芯片 / Intel / Windows）；macOS 推荐一行命令安装（避免「已损坏」），或 `xattr -cr`；Windows 解压运行。
6. 登录：三种形态都不需要登录；本机 API 只接受同源请求（见 [deployment-platforms.md](./technical/deployment-platforms.md)）。
7. 常见问题：「已损坏」、端口被占用、浏览器不支持目录授权。

### 3.2 `chaya-launch` — 添加游戏与启动

1. 添加游戏：本机选目录（local / app）或浏览器授权目录（Edge）；识别 MV / MZ 内容根。
2. 装壳：下载最新 NW.js 壳或指定壳源；macOS 壳修复命令（`/sh/mac-shell.sh`）。
3. 注入插件：ChayaLoader 与 ChayaLog / Trans / Boost / Edit / Agent 各自的作用。
4. 启动 / 关闭游戏，控制台与游戏的连接（WebRTC），在线状态怎么看。
5. 局内修改（`/cheat`）、翻译（`/translate`：抽取 → 补译 → 翻译库）、日志（`/logs`）的入口与典型流程。
6. Edge 形态的启动差异：浏览器写好插件与壳后，由用户本机双击启动。

### 3.3 `chaya-mcp` — Agent 通过 MCP 控制 Chaya

1. 前提：本机 dev / App（全部工具），或只用 Edge 且已在 Edge 给游戏「安装插件」并打开游戏（局内工具，无需保持网页连接）。
2. 连接：统一地址 `http://127.0.0.1:39271/mcp`（改过端口以游戏内显示为准），免授权；本机兼容地址 `http://localhost:3000/api/mcp`（App 为 3927）；各 Agent 安装方式。
3. 标准工作流：读状态 → 查 id（目录）→ 修改 → 再读状态确认。
4. 场景配方：改金钱 / 物品 / 角色、传送、推进对话、整作补译、修正一条译文、排查日志。
5. 安全约定：破坏性工具（移除游戏、清除插件、卸载共用壳、删除译文、清日志、插件存档 / 读档）需先和用户确认；`chaya_live_eval` 默认关闭。

## 4. MCP 能力清单

命名：`chaya_<分组>_<动作>`。「对应接口」为同等效果的 HTTP API：多数工具在进程内调用该路由，行为一致；例外（`library_remark`、`logs_query`、`live_*`）见技术文档 §3.2。返回体会去掉启动 token 等凭证字段。

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
| `chaya_game_quit`            | 请求关闭正在运行的游戏                                        | —                        | `DELETE /api/launch`      |
| `chaya_game_plugins_install` | 安装 / 更新 Loader 与插件                                     | —                        | `POST /api/plugins`       |
| `chaya_game_plugins_clear`   | 清除 Loader 与插件 ⚠️                                         | —                        | `DELETE /api/plugins`     |
| `chaya_game_shell_install`   | 安装 NW.js 壳：未给 `shellSource` 时下载最新（最长约 5 分钟） | `shellSource?`, `force?` | `POST /api/shell`         |
| `chaya_game_shell_check`     | 检查壳是否有更新                                              | —                        | `GET /api/shell`          |
| `chaya_game_shell_uninstall` | 卸载工具目录里的共用壳 ⚠️                                     | —                        | `DELETE /api/shell`       |
| `chaya_game_window`          | 读取或修改游戏窗口（标题、宽高、全屏…）                       | `window?`                | `GET` / `PUT /api/window` |

### 4.3 局内实时 `live`（需游戏运行并加载 ChayaAgent）

| 工具                 | 作用                                                          | 主要参数                                                  |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| `chaya_live_games`   | 列出已连接的游戏                                              | —                                                         |
| `chaya_live_state`   | 场景、地图坐标、金钱、队伍、对话文字与选项                    | `gameId?`                                                 |
| `chaya_live_plugins` | 已加载的 Chaya 插件、方法与声明的工具                         | `gameId?`                                                 |
| `chaya_live_call`    | 调用插件方法或插件工具（改金钱 / 物品 / 变量 / 开关 / 传送…） | `plugin`, `method?`, `args?`, `chain?`, `tool?`, `input?` |
| `chaya_live_press`   | 模拟按键：确认 / 取消 / 菜单 / 方向                           | `key`, `frames?`                                          |
| `chaya_live_eval`    | 执行任意 JS（默认关闭，`CHAYA_MCP_EVAL=1` 开启）⚠️            | `code`                                                    |

对应接口：`POST /api/runtime/agent`（游戏侧长轮询，Agent 不直接调用）。

游戏在线时还会出现插件工具 `chaya_plugin_edit_*` / `chaya_plugin_boost_*` / `chaya_plugin_trans_*`（参数见 `tools/list`；`save` / `load` ⚠️），也可用 `chaya_live_call {plugin, tool, input}` 调用。

### 4.4 修改目录 `edit`

| 工具                 | 作用                                                                                                                  | 主要参数               | 对应接口                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------- |
| `chaya_edit_catalog` | 按类别搜索 id：`items` / `weapons` / `armors` / `actors` / `skills` / `states` / `classes` / `variables` / `switches` | `kind`, `q?`, `limit?` | `GET /api/game-edit/catalog` |

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

## 5. MCP 页面

1. 顶部：一句话说明；统一地址（本机按实际生效端口，Edge 显示默认 `http://127.0.0.1:39271/mcp`）、安装按钮（Cursor / VS Code 链接，Claude Code / Codex 命令）、mcp.json；本机另列兼容地址 `/api/mcp` 与 `chaya_live_eval` 开关状态。
2. 分组目录：七个分组，每个工具一张卡片——名称、说明、参数表（必填 / 类型 / 说明）、对应接口、⚠️ 标记。
3. 试调（本机形态）：选择工具、编辑 JSON 参数、执行，显示返回结果。
4. Edge：静态展示统一地址、安装方式与三步前提（安装插件 → 打开游戏 → Agent 连接）；不随连接变化；不可用分组标注「需本机服务」；不提供试调。

## 6. 验收

- 三种形态都能打开 `/integration/skills` 与 `/integration/mcp`；页面不展示任何凭证。
- Agent 只配 `http://127.0.0.1:39271/mcp`：本机服务运行时得到全部工具；只用 Edge 且游戏已打开时得到局内工具；两者切换不改配置。
- 游戏内改端口：保存前试监听，被占用不写文件；保存后网关自动换到新端口；使用默认端口时不存在端口配置文件。
- 「删除端口配置」后文件被删除（目录为空时目录也删除），网关回到 39271；「打开所在文件夹」「打开文档」可用。
- 网关拒绝浏览器跨站请求与非回环 `Host`；端口被非 Chaya 程序占用时有明确提示。
- `/skills/<id>.md` 未授权也能 `curl` 下载。
- `tools/list` 返回第 4 节全部工具（`chaya_live_eval` 视开关）；目录与实现一一对应（单测保证）。
- 七个分组都有工具层单测（参数校验、接口映射、脱敏）；读类工具另有本机实例端到端验证。写类 / 耗时工具（启动、装壳、整作补译等）复用已有接口，接口本身已有测试，MCP 层只测参数映射。

## 7. 修订

| 日期       | 说明                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | 初稿：Skills / MCP 集成页                                                                                   |
| 2026-10-03 | 统一 MCP 入口：本机固定端口网关（本机服务照旧，Edge 由游戏插件提供局内工具），撤 Edge OAuth                 |
| 2026-10-04 | 端口可在游戏内修改；配置文件只放一处、按需创建；游戏内可一键删除、打开所在文件夹、打开文档                  |
| 2026-10-04 | Review：目录统一小写 `chaya`（与 App 数据目录一致）；去掉 `CHAYA_MCP_PORT`；Edge 前提不要求网页连接；补验收 |
| 2026-10-04 | 流程 Review PASS；本机「集成 → MCP」也可管理端口；游戏内入口定为局内面板顶栏「MCP」；Edge 登录随 OAuth 移除 |
| 2026-10-04 | 一期实现：macOS / Windows 目录为 `Chaya`（与 App 一致）；Edge 工具列表标注「需本机服务」                    |
