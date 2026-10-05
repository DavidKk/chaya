# 集成页与本机 MCP 技术设计

> 需求真源：[docs/mcp-local.md](../mcp-local.md)（本地 MCP）；集成页见 [docs/integration.md](../integration.md)
> 相关：[service-modes.md](./service-modes.md)（`canUseDisk` 门禁）、[mcp-gateway.md](./mcp-gateway.md)（统一入口 `127.0.0.1:39271/mcp`（默认端口）：本机服务进程内复用本文 `/api/mcp` 的处理逻辑，Edge 由游戏插件提供局内工具）

---

## 1. 总览

```text
Agent ──JSON-RPC（本机免授权）────────► POST /api/mcp
                                      │ initializer/mcp.ts（协议）
                                      ▼
                         app/api/mcp/_tools/*（工具实现）
             ┌────────────────────────┼─────────────────────────┐
             ▼                        ▼                         ▼
   进程内调用现有路由          services/*（少量直调）      agent-bridge 指令队列
 （status / launch / …）     （备注、日志关键词）              ▲
                                                               │ POST /api/runtime/agent（长轮询）
                                                     游戏内 ChayaAgent → ChayaEdit / ChayaBoost / ChayaTrans
```

- `/api/mcp` 只在 `canUseDisk()`（local / app）开放；Edge 返回 404 `LOCAL_ONLY`。本机「集成 → MCP」只介绍这个地址；本机服务另开的统一网关也原样转发到这里（[mcp-gateway.md](./mcp-gateway.md) §4）。
- 协议：Streamable HTTP，只回 JSON（不推 SSE）；支持 `initialize` / `ping` / `tools/list` / `tools/call`，通知返回 202，支持批量。

## 2. 模块落点

| 文件                                                                                           | 职责                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/integration/mcp-catalog.ts`                                                               | **纯元数据**：分组、工具名、标题、说明、`inputSchema`、对应接口、危险标记；前后端共用。文案只有英文（Agent 读的就是这份）                                                                                           |
| `lib/integration/mcp-catalog-i18n.ts`                                                          | 页面展示用翻译：`mcp-catalog-messages.json`（zh / ja / ko 的分组、标题、说明、顶层参数说明）与 `web-tools-messages.json`（WebMCP 专属工具说明）                                                                     |
| `lib/integration/mcp-install.ts`                                                               | 生成 Cursor / VS Code 链接与 Claude Code / Codex 命令（含 CLI 参数数组）；UI 为 `McpClientInstall`                                                                                                                  |
| `services/integration/mcp-clients.ts` + `app/api/integration/mcp/clients/route.server.ts`      | 仅本机，Claude Code / Codex：GET 读用户配置判断是否已装、CLI 是否可用；POST `{client, action:'install'\|'uninstall'}` 执行 CLI `mcp add` / `mcp remove`；`defineApiRoute` 拒跨站，参数固定为 `chaya` + 本机回环地址 |
| `lib/integration/mcp-availability.ts`                                                          | 各形态可用工具矩阵 `mcpToolsFor('server' \| 'plugin')`：本机全部；插件 MCP 为局内实时（无 eval）/ 修改目录 / 翻译（无 batch）/ 翻译库 / 日志。页面、插件网关、文档都按它                                            |
| `services/integration/skill-install.ts` + `app/api/integration/skills/install/route.server.ts` | 仅本机：GET `?id` 返回四个目标是否已装；POST `{id, target, action}` 写入 / 删除 `<目录>/<id>/SKILL.md`（目录为空时删除）；目标限定为 `~/.agents` / `~/.cursor` / `~/.claude` / `~/.codex` 下的 `skills`             |
| `lib/integration/skills.ts`                                                                    | Skill 清单（id、标题、摘要）与原文路径约定                                                                                                                                                                          |
| `app/api/mcp/_tools/*.ts`                                                                      | 按分组的工具实现 `name → run`；`index.ts` 组装 `McpServerConfig`。放在 API 层：工具是 HTTP API 的投影，调用同层路由不构成 `services → app` 反向依赖                                                                 |
| `app/api/mcp/_tools/route-invoke.ts`                                                           | 进程内调用路由处理函数（带服务端管理 token、透传取消信号）并解包 `apiOk` 信封、去掉凭证字段                                                                                                                         |
| `services/integration/skills.ts`                                                               | 读取 `skills/<id>/SKILL.md`；`readSkillBody(id, locale)` 读页面展示正文（字面路径保证被 output file tracing 打包）                                                                                                  |
| `services/runtime/agent-bridge.ts`                                                             | 内存指令队列（已存在）                                                                                                                                                                                              |
| `app/api/mcp/route.server.ts`                                                                  | MCP 入口                                                                                                                                                                                                            |
| `app/api/integration/mcp/route.ts`                                                             | 页面用：服务地址、eval 开关（不含任何凭证）                                                                                                                                                                         |
| `app/integration/**`                                                                           | 集成页（layout + skills / mcp 子页）                                                                                                                                                                                |
| `app/skills/[file]/route.ts`                                                                   | 公开 Skill 原文 `/skills/<id>.md`                                                                                                                                                                                   |
| `components/integration/*`                                                                     | 页面组件                                                                                                                                                                                                            |
| `skills/<id>/SKILL.md`                                                                         | Skill 正文（英文，安装给 Agent 的就是这份）                                                                                                                                                                         |
| `skills/<id>/i18n/<locale>.md`                                                                 | 页面展示用译文（zh / ja / ko，只有正文、无 frontmatter）                                                                                                                                                            |

元数据与实现分离：页面只引用 `lib/integration/mcp-catalog.ts`，不把服务端代码打进客户端。单测保证「目录里每个工具都有实现、每个实现都在目录里」。

## 3. 工具实现策略

### 3.1 进程内调用路由

现有路由已包含完整的校验与错误码（例如启动前检查壳、插件产物）。MCP 不重写这些逻辑，而是直接调用路由导出的处理函数：

```ts
const res = await invokeRoute(StatusRoute.PUT, { method: 'PUT', path: '/api/status', body: { gameRoot } })
```

- `invokeRoute` 构造 `Request`（`http://127.0.0.1<path>`），带 `Authorization: Bearer ${CHAYA_AUTH_TOKEN}`，复用 `defineApiRoute` 的鉴权；外层 MCP 请求的 `signal` 透传，客户端断开时翻译等长任务可取消。
- `CHAYA_AUTH_TOKEN` 由 `scripts/next-listen.mjs` / `electron/main.cjs` 注入；未设置时外层 `/api/mcp` 本身就 401，行为一致。
- 返回体：`{ ok: true, ... }` 去掉 `ok` 后作为结果；`{ ok: false, error: { code, message } }` 或非 2xx → 抛错，MCP 侧返回 `isError: true` 与错误文案。
- **凭证脱敏**：`launch` / `plugins` 返回含 `launchToken` 与 `env`（插件凭证），统一在解包时递归删除 `launchToken` / `token` / `env` 键。
- 动态路由的 `context` 传 `{ params: Promise.resolve({}) }`。

### 3.2 直调服务

| 工具                            | 原因                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `chaya_library_remark`          | `PUT /api/status` 带 `gameRoot + remark` 会顺带切换当前游戏，不符合「只改备注」                 |
| `chaya_logs_query`              | 路由不支持关键词；`listLogs` 增加 `q`，在截取 `limit` **之前**过滤 message / source，避免漏结果 |
| `chaya_game_window`             | 写入前先 `GET /api/status` 取当前 `selected`，作为 `gameRoot` 传给 `PUT /api/window` 防并发切换 |
| `chaya_translate_play_settings` | 写入前先读一次取 `contentRoot`，否则路由返回 409                                                |
| `chaya_game_shell_install`      | 未给 `shellSource` 时传 `fetchLatest: true`（路由默认不下载）                                   |
| `chaya_live_*`                  | 走 agent bridge                                                                                 |

### 3.3 返回体裁剪

`GET /api/status` 体量大。`chaya_library_list` 只返回 `{ serviceMode, current, total, games[] }`（`gameRoot / name / remark / kindLabel / missing / remote / hasShell / lastOpenedAt`）；`chaya_game_status` 输出 `GameStatusView`（`lib/integration/tools/game-status.ts`，与网页版 WebMCP 同形）：绑定、名称 / 标题、内容根、系统、壳、插件、缓存、体积、指纹、在线。`chaya_game_plugins_install` / `chaya_game_plugins_clear` 写完后重读状态，返回 `{ installed | cleared, plugins, pluginsReady, pluginsTotal }`；`chaya_game_shell_install` 返回 `{ pending, hasShell, shellApp, taskId, downloadUrl, hint }`，两端同形。`chaya_edit_catalog` 按 `kind` 取一类并按 `q` 过滤，默认最多 50 条；带 `gameId` 时经长轮询 `edit.catalog` 从该游戏读取，否则读当前游戏的数据文件。

## 4. 鉴权与安全

| 调用方             | 凭证                                 | 可访问                                                 |
| ------------------ | ------------------------------------ | ------------------------------------------------------ |
| Agent → `/api/mcp` | 无（同源或非浏览器请求即放行）       | 全部 MCP 工具                                          |
| 脚本               | `Authorization: Bearer <管理 token>` | 全部 API                                               |
| 浏览器页面         | 无（同源 + `Host` 校验）             | 全部 API（含 `/api/mcp` 试调、`/api/integration/mcp`） |
| 游戏插件           | `X-Chaya-Launch-Token`               | 仅本房间的 `/api/runtime/agent`；**不能**调 `/api/mcp` |
| 任何人             | 无                                   | `/skills/<id>.md`（公开文档）                          |

- `/api/integration/mcp` 在 Edge 返回 `{ available: false }`（Edge 下 `mayAccessApi` 全放行，必须自行判 `canUseDisk`）；响应 `no-store`；本机返回自身地址 `endpoint = http://127.0.0.1:<port>/api/mcp` 与 `evalEnabled`，页面据此生成安装链接（`dev:lan` 监听 0.0.0.0 时也不把局域网地址写进安装链接）；统一网关见 [mcp-gateway.md](./mcp-gateway.md)。
- 本机不登录、MCP 免授权；Edge 没有服务端 MCP，也没有 OAuth（[mcp-gateway.md](./mcp-gateway.md) §9）。
- `proxy.ts` 不拦页面；跨站网页调用本机 API 由 `mayAccessApi` 拒绝。
- `chaya_live_eval` 由 `CHAYA_MCP_EVAL=1` 控制：关闭时不出现在 `tools/list`，也不可调用。
- Agent 不能调插件的任意方法：`chaya_live_call` 只按名调用 `ChayaBoost` / `ChayaTrans` 声明的插件工具，修改走 `chaya_edit_*` 预设指令（[capabilities.md](../capabilities.md) §1）；`game.eval` 只在本机长轮询且开启 `CHAYA_MCP_EVAL=1` 时执行。
- 破坏性工具在描述里写明「先征得用户同意」，目录里标 `destructive: true`，页面显示 ⚠️。

## 5. 页面

- `app/integration/layout.tsx`：二级导航（Skills / MCP），参照 `app/translate/layout.tsx`；不包 `RequireBoundGame`。
- `/integration/skills/[id]`：`generateStaticParams` + `dynamicParams=false` 限定 id；根布局读 cookie，所以页面按需渲染（`/skills/[file]` 原文路由是构建期 SSG）。服务端用 `marked` 把每种语言的 Skill Markdown 都转成 HTML（仓库内可信内容），客户端按当前语言取用；`en` 用 `SKILL.md` 正文，其他语言用 `i18n/<locale>.md`，缺失时回退英文。左半列表 + 正文，右半「安装到 Agent」（`components/integration/SkillInstall.tsx`：通用 / Codex / Claude Code / Cursor 四个按钮；本机调 `/api/integration/skills/install` 由服务端写文件，Edge 弹框给 `curl` 命令；窄屏放进正文顶部）。
- 三个子页共用 `components/integration/Hub.tsx` 的 `HubLayout`：左半「导航 + 说明」，右半面板底「操作」（Skills 安装、MCP 试调、WebMCP 浏览器支持与启用步骤）。
- `/integration/mcp`：客户端组件读取 `/api/integration/mcp`：
  - 可用：服务地址（`CopyField`）+「本地直连，无需授权」+ 安装按钮 + 试调面板。
  - 不可用（Edge）：提示改用本机 dev / App，文档照常。
  - 工具卡片由 `mcp-catalog` 渲染：参数表从 `inputSchema` 生成；标题、说明、参数说明按当前语言替换（`localizedMcpToolsByGroup`），工具名与 schema 不变。
- **语言约定**：给 Agent 的内容（`SKILL.md`、`tools/list`、`MCP_INSTRUCTIONS`、WebMCP 工具定义）只用英文；页面展示跟随界面语言。
- 主导航 `AppNav` 增加「集成」，匹配 `/integration/*`。
- `proxy.ts`：`/skills/` 前缀与 `/sh/` 一样公开。

## 6. 安装链接

| 目标        | 形式                                                                               |
| ----------- | ---------------------------------------------------------------------------------- |
| Cursor      | `cursor://anysphere.cursor-deeplink/mcp/install?name=chaya&config=<base64({url})>` |
| VS Code     | `vscode:mcp/install?<urlencode({name, type:'http', url})>`                         |
| Claude Code | `claude mcp add --transport http --scope user chaya <url>`                         |
| Codex       | `codex mcp add chaya --url <url>`                                                  |

Skill 安装命令：`mkdir -p <dir>/<id> && curl -fsSL <origin>/skills/<id>.md -o <dir>/<id>/SKILL.md`，`<dir>` 为 `~/.agents/skills`（默认「通用」，多 Agent 共用）/ `~/.cursor/skills` / `~/.claude/skills` / `~/.codex/skills`。

## 7. 测试

| 层级   | 用例                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 协议   | `initialize` / `tools/list` / `tools/call` / 通知 / 隐藏工具（已有）                                                                                                                                         |
| 目录   | 目录与实现一一对应；名称唯一且符合 `chaya_<group>_<verb>`；`inputSchema` 为 object                                                                                                                           |
| 工具   | `invokeRoute` 解包与报错；library 筛选与裁剪；remark 不切换当前游戏；logs 关键词；catalog 过滤；translate job 参数映射；game 状态裁剪 / 装壳 / 窗口；live 调用与按键校验；cache 查询映射；play_settings 合并 |
| 安装   | 四种安装链接 / 命令格式                                                                                                                                                                                      |
| 鉴权   | `/api/integration/mcp` 不返回任何凭证；本机同源放行、跨站拒绝；插件 token 不能调 `/api/mcp` 与 `/api/integration/mcp`                                                                                        |
| Skill  | 清单里每个 id 都有 `SKILL.md`，frontmatter `name` 与 id 一致；`SKILL.md` 不含中日韩文字（行内代码除外），每种语言都有展示译文与标题 / 摘要                                                                   |
| 语言   | 目录与 WebMCP 工具定义不含中日韩文字；zh / ja / ko 译文覆盖每个分组、工具与顶层参数                                                                                                                          |
| 端到端 | 本机实例 curl：`tools/list` 数量、`chaya_library_list`、`chaya_logs_query`、`chaya_cache_query`；浏览器：Skills / MCP 页、试调、Edge 提示                                                                    |
| 页面   | 参数表 / 示例参数 / JSON 校验 / `tools/call` 结果解析（`components/integration/mcp/schema.ts`）                                                                                                              |

## 8. 修订

| 日期       | 说明                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | 初稿                                                                                                                                   |
| 2026-10-03 | Review：凭证脱敏、日志先筛后截、透传 signal、工具实现移到 `app/api/mcp/_tools`、补窗口 / 壳卸载 / 游戏内翻译设置、参数枚举、不暴露清单 |
| 2026-10-03 | 开发后 Review：Codex 环境变量提示、真实鉴权与 proxy 单测、各分组工具单测、MCP 内容语言提示、试调显示服务端错误原因                     |
| 2026-10-03 | Agent 内容统一英文，页面展示多语言：Skill 译文目录、目录翻译 JSON，移除内容语言提示                                                    |
| 2026-10-03 | MCP 改为 OAuth 授权（授权页 + 已授权应用列表），页面不再展示令牌；dev 端口改 3000                                                      |
| 2026-10-03 | 本机 MCP 改为免授权（同源 + Host 校验），去掉已授权应用与浏览器接力；OAuth 只守 Edge MCP                                               |
| 2026-10-03 | 统一入口改为本机网关（见 mcp-gateway.md），`/api/mcp` 作为其本机后端与兼容地址保留                                                     |
| 2026-10-04 | 按 [capabilities.md](../capabilities.md)：插件任意方法调用移除，修改走 `chaya_edit_*` 预设指令                                         |
