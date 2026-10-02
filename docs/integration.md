# 集成（Skills / MCP）需求

- **日期**：2026-10-03
- **状态**：已定稿，首版实现
- **技术设计**：[docs/technical/integration-mcp.md](./technical/integration-mcp.md)
- **参考**：工单服务 `/integration/skill`、`/integration/mcp`

---

## 1. 目标

让用户和 Agent（Cursor / Claude Code / Codex / VS Code）都能看懂并接入 Chaya：

- **Skills**：给人和 Agent 读的使用手册——Chaya 是什么、三种形态怎么装、怎么启动游戏、Agent 怎么用 MCP。每份 Skill 都可以一键装进 Agent。
- **MCP**：本机 MCP 服务的全部工具清单、参数、示例与安装方式；本机形态下可在页面上直接试调。

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
- Edge（Vercel）上 MCP 不可用：页面照常展示文档，连接区提示「需本机 dev 或 App」，不展示 token、不提供试调。

## 3. Skills 内容清单

每份 Skill 是一个 `skills/<id>/SKILL.md`（带 `name` / `description` frontmatter，Agent 可直接安装）。

### 3.1 `chaya-setup` — Chaya 是什么 / 三种形态 / 安装

1. Chaya 是什么：RPG Maker MV/MZ 游戏的本机工具箱（游戏库、NW.js 壳、局内修改、翻译、日志）。
2. 三种形态对比表：Edge（网页）/ 本地 dev / App——是什么、能做什么、不能做什么、适合谁。
3. Edge：打开 `https://chaya-gray.vercel.app`，Chrome / Edge 浏览器用目录授权写插件与壳；不启动进程、无共享翻译库、无 MCP。
4. 本地 dev：`git clone` → `pnpm i` → `pnpm dev`（3927 端口），用终端打印的授权链接打开控制台；`pnpm dev:lan` 局域网；`pnpm dev:app` 带 Electron 窗口。
5. App：从 GitHub Release 下载 zip（Apple 芯片 / Intel / Windows）；macOS 推荐一行命令安装（避免「已损坏」），或 `xattr -cr`；Windows 解压运行。
6. 授权：控制台与 API 需要管理 token（终端里的授权链接 / `data/access/token`）。
7. 常见问题：「已损坏」、端口被占用、浏览器不支持目录授权。

### 3.2 `chaya-launch` — 添加游戏与启动

1. 添加游戏：本机选目录（local / app）或浏览器授权目录（Edge）；识别 MV / MZ 内容根。
2. 装壳：下载最新 NW.js 壳或指定壳源；macOS 壳修复命令（`/sh/mac-shell.sh`）。
3. 注入插件：ChayaLoader 与 ChayaLog / Trans / Boost / Edit / Agent 各自的作用。
4. 启动 / 关闭游戏，控制台与游戏的连接（WebRTC），在线状态怎么看。
5. 局内修改（`/cheat`）、翻译（`/translate`：抽取 → 补译 → 翻译库）、日志（`/logs`）的入口与典型流程。
6. Edge 形态的启动差异：浏览器写好插件与壳后，由用户本机双击启动。

### 3.3 `chaya-mcp` — Agent 通过 MCP 控制 Chaya

1. 前提：本机 dev 或 App；游戏需加载 ChayaAgent 插件并从 Chaya 启动。
2. 连接：`http://127.0.0.1:3927/api/mcp` + `Authorization: Bearer <token>`；各 Agent 安装方式。
3. 标准工作流：读状态 → 查 id（目录）→ 修改 → 再读状态确认。
4. 场景配方：改金钱 / 物品 / 角色、传送、推进对话、整作补译、修正一条译文、排查日志。
5. 安全约定：破坏性工具（移除游戏、清日志、删除译文、清除插件）需先和用户确认；`chaya_live_eval` 默认关闭。

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

| 工具                 | 作用                                                         | 主要参数                              |
| -------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `chaya_live_games`   | 列出已连接的游戏                                             | —                                     |
| `chaya_live_state`   | 场景、地图坐标、金钱、队伍、对话文字与选项                   | `gameId?`                             |
| `chaya_live_plugins` | 已加载的 `Chaya*` 插件及方法                                 | `gameId?`                             |
| `chaya_live_call`    | 调用插件方法（改金钱 / 物品 / 变量 / 开关 / 传送 / 存读档…） | `plugin`, `method`, `args?`, `chain?` |
| `chaya_live_press`   | 模拟按键：确认 / 取消 / 菜单 / 方向                          | `key`, `frames?`                      |
| `chaya_live_eval`    | 执行任意 JS（默认关闭，`CHAYA_MCP_EVAL=1` 开启）⚠️           | `code`                                |

对应接口：`POST /api/runtime/agent`（游戏侧长轮询，Agent 不直接调用）。

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

1. 顶部：一句话说明；本机形态显示服务地址、token（可复制，附「只在本机使用」提醒）、安装按钮（Cursor / VS Code 链接，Claude Code / Codex 命令，Codex 附环境变量持久化提示）、mcp.json 与 `chaya_live_eval` 开关状态。
2. 分组目录：七个分组，每个工具一张卡片——名称、说明、参数表（必填 / 类型 / 说明）、对应接口、⚠️ 标记。
3. 试调（本机形态）：选择工具、编辑 JSON 参数、执行，显示返回结果。
4. Edge：隐藏 token / 安装 / 试调，提示切到本机 dev 或 App。

## 6. 验收

- 三种形态都能打开 `/integration/skills` 与 `/integration/mcp`；Edge 不泄露 token。
- `/skills/<id>.md` 未授权也能 `curl` 下载。
- `tools/list` 返回第 4 节全部工具（`chaya_live_eval` 视开关）；目录与实现一一对应（单测保证）。
- 七个分组都有工具层单测（参数校验、接口映射、脱敏）；读类工具另有本机实例端到端验证。写类 / 耗时工具（启动、装壳、整作补译等）复用已有接口，接口本身已有测试，MCP 层只测参数映射。
