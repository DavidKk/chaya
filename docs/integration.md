# 集成（Skills / MCP）需求

- **日期**：2026-10-03
- **状态**：已定稿，首版实现
- **能力总表**：[capabilities.md](./capabilities.md)（各环境能用哪些工具，增减能力先改它）
- **MCP 分三份**：[本地 MCP](./mcp-local.md)（dev / App 自身）、[插件 MCP](./mcp-plugin.md)（游戏内 ChayaAgent）、[Edge MCP](./mcp-edge.md)（网页版只说明如何装插件 MCP）
- **技术设计**：[docs/technical/integration-mcp.md](./technical/integration-mcp.md)、[docs/technical/mcp-gateway.md](./technical/mcp-gateway.md)
- **参考**：工单服务 `/integration/skill`、`/integration/mcp`

---

## 1. 目标

让用户和 Agent（Cursor / Claude Code / Codex / VS Code）都能看懂并接入 Chaya：

- **Skills**：给人和 Agent 读的使用手册——Chaya 是什么、三种形态怎么装、怎么启动游戏、Agent 怎么用 MCP。每份 Skill 都可以一键装进 Agent。
- **MCP**：每种形态只介绍自身——本机介绍本地 MCP（全部工具 + 试调），Edge 不支持 MCP（整页空态，引导装插件后在游戏内查看），游戏内「集成」由插件说明插件 MCP。

## 2. 入口与路由

| 路由                       | 内容                                                          |
| -------------------------- | ------------------------------------------------------------- |
| 顶栏「集成」               | 在游戏库（`/game`）旁新增主导航项                             |
| `/integration`             | 重定向到 `/integration/skills`                                |
| `/integration/skills`      | 默认打开第一份 Skill                                          |
| `/integration/skills/<id>` | Skill 详情：左侧 Skill 列表，右侧渲染正文                     |
| `/integration/mcp`         | 本机：本地 MCP 地址、安装与工具；Edge：整页空态，引导到游戏内 |
| `/skills/<id>.md`（公开）  | Skill 原文（纯文本 Markdown），供 `curl` 安装                 |

- 集成页**不要求绑定游戏**；三种形态都能打开。
- 每种形态只描述自身的 MCP / WebMCP，不在本机页说明插件 MCP，也不在 Edge 页列本机工具。
- **布局规则：页面上的文字只能放在卡片内**，卡片外不放说明段落（见 [chaya-ui-style-guide.md](./technical/chaya-ui-style-guide.md) §4.2）。

## 3. Skills 内容清单

每份 Skill 是一个 `skills/<id>/SKILL.md`（带 `name` / `description` frontmatter，Agent 可直接安装）。

### 3.1 `chaya-setup` — Chaya 是什么 / 三种形态 / 安装

1. Chaya 是什么：RPG Maker MV/MZ 游戏的本机工具箱（游戏库、NW.js 壳、局内修改、翻译、日志）。
2. 三种形态对比表：Edge（网页）/ 本地 dev / App——是什么、能做什么、不能做什么、适合谁。
3. Edge：打开 `https://chaya-gray.vercel.app`，Chrome / Edge 浏览器用目录授权写插件与壳；不启动进程、无共享翻译库；外部 Agent 经插件 MCP 使用局内工具（[mcp-plugin.md](./mcp-plugin.md)）。
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

1. 前提：本机 dev / App（本地 MCP，全部工具），或只用 Edge 且已给游戏「安装插件」并打开游戏（插件 MCP，局内工具）。
2. 连接：本地 MCP `http://127.0.0.1:3000/api/mcp`（App 为 3927）；插件 MCP `http://127.0.0.1:39271/mcp`（改过端口以游戏内显示为准）；都免授权；各 Agent 安装方式。
3. 标准工作流：读状态 → 查 id（目录）→ 修改 → 再读状态确认。
4. 场景配方：改金钱 / 物品 / 角色、传送、推进对话、整作补译、修正一条译文、排查日志。
5. 安全约定：破坏性工具（移除游戏、清除插件、卸载共用壳、删除译文、清日志、插件存档 / 读档）需先和用户确认；`chaya_live_eval` 默认关闭。

### 3.4 安装到 Agent（Skills 页右侧）

- 按钮：「通用」（`~/.agents/skills`，多个 Agent 共用）/ Codex / Claude Code / Cursor，每个按钮只有图标 + 名称，悬停提示「安装到 X」/「从 X 卸载」。
- 本机（dev / App）：点击即由本机服务把 `SKILL.md` 写入 `<目录>/<id>/SKILL.md`；已安装的目标按钮变为卸载（红色边框与文字），卸载只删这份文件，目录为空时一并删除；结果用 toast 提示，窗口重新聚焦时刷新状态。
- Edge：网页不能写本机文件，点击后弹框展示 `curl` 安装命令（可复制）。

## 4. MCP 页面

- 本机：见 [mcp-local.md](./mcp-local.md) §5（地址、安装、七个分组、试调）。
- Edge：见 [mcp-edge.md](./mcp-edge.md) §2（插件 MCP 安装说明，不列工具、不试调）。
- 游戏内：局内面板顶栏「集成」，子页 MCP / WebMCP，复用本机同一套视图，内容见 [mcp-plugin.md](./mcp-plugin.md) §4；不含 Skills。
- WebMCP 页同理只描述当前形态。

## 5. 验收

- 三种形态都能打开 `/integration/skills` 与 `/integration/mcp`；页面不展示任何凭证。
- 页面文字都在卡片内。
- `/skills/<id>.md` 未授权也能 `curl` 下载。
- MCP 各自验收见三份 MCP 文档。

## 6. 修订

| 日期       | 说明                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | 初稿：Skills / MCP 集成页                                                                                             |
| 2026-10-03 | 统一 MCP 入口：本机固定端口网关（本机服务照旧，Edge 由游戏插件提供局内工具），撤 Edge OAuth                           |
| 2026-10-04 | 端口可在游戏内修改；配置文件只放一处、按需创建；游戏内可一键删除、打开所在文件夹、打开文档                            |
| 2026-10-04 | Review：目录统一小写 `chaya`（与 App 数据目录一致）；去掉 `CHAYA_MCP_PORT`；Edge 前提不要求网页连接；补验收           |
| 2026-10-04 | 流程 Review PASS；本机「集成 → MCP」也可管理端口；游戏内入口定为局内面板顶栏「MCP」；Edge 登录随 OAuth 移除           |
| 2026-10-04 | 一期实现：macOS / Windows 目录为 `Chaya`（与 App 一致）；Edge 工具列表标注「需本机服务」                              |
| 2026-10-04 | 集成页 MCP 概览去掉卡片外的说明文字；集成页不放「打开文档」（仅游戏内保留）                                           |
| 2026-10-04 | 本机「集成 → MCP」只介绍本机服务自身的 `/api/mcp`；网关端口只在游戏内管理                                             |
| 2026-10-04 | MCP 拆成本地 / 插件 / Edge 三份文档；各形态只描述自身；页面文字只在卡片内                                             |
| 2026-10-04 | Skills 一键安装 / 卸载（本机写文件，Edge 弹框给命令）；Edge MCP 改整页空态；游戏内「MCP」改为「集成」（MCP / WebMCP） |
