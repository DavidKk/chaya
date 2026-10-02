# 集成页与本机 MCP 技术设计

> 需求真源：[docs/integration.md](../integration.md)
> 相关：[service-modes.md](./service-modes.md)（`canUseDisk` 门禁）

---

## 1. 总览

```text
Agent ──JSON-RPC（Bearer token）──► POST /api/mcp
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

- MCP 只在 `canUseDisk()`（local / app）开放；Edge 返回 404 `LOCAL_ONLY`。
- 协议：Streamable HTTP，只回 JSON（不推 SSE）；支持 `initialize` / `ping` / `tools/list` / `tools/call`，通知返回 202，支持批量。

## 2. 模块落点

| 文件                                 | 职责                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/integration/mcp-catalog.ts`     | **纯元数据**：分组、工具名、标题、说明、`inputSchema`、对应接口、危险标记；前后端共用                                                               |
| `lib/integration/mcp-install.ts`     | 生成 Cursor / VS Code 链接与 Claude Code / Codex 命令                                                                                               |
| `lib/integration/skills.ts`          | Skill 清单（id、标题、摘要）与原文路径约定                                                                                                          |
| `app/api/mcp/_tools/*.ts`            | 按分组的工具实现 `name → run`；`index.ts` 组装 `McpServerConfig`。放在 API 层：工具是 HTTP API 的投影，调用同层路由不构成 `services → app` 反向依赖 |
| `app/api/mcp/_tools/route-invoke.ts` | 进程内调用路由处理函数（带服务端管理 token、透传取消信号）并解包 `apiOk` 信封、去掉凭证字段                                                         |
| `services/integration/skills.ts`     | 读取 `skills/<id>/SKILL.md`（字面路径保证被 output file tracing 打包）                                                                              |
| `services/runtime/agent-bridge.ts`   | 内存指令队列（已存在）                                                                                                                              |
| `app/api/mcp/route.ts`               | MCP 入口                                                                                                                                            |
| `app/api/integration/mcp/route.ts`   | 页面用：服务地址、token（仅本机 + 管理会话）、eval 开关                                                                                             |
| `app/integration/**`                 | 集成页（layout + skills / mcp 子页）                                                                                                                |
| `app/skills/[file]/route.ts`         | 公开 Skill 原文 `/skills/<id>.md`                                                                                                                   |
| `components/integration/*`           | 页面组件                                                                                                                                            |
| `skills/<id>/SKILL.md`               | Skill 正文                                                                                                                                          |

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

`GET /api/status` 体量大。`chaya_library_list` 只返回 `{ serviceMode, current, total, games[] }`（`gameRoot / name / remark / kindLabel / missing / remote / hasShell / lastOpenedAt`）；`chaya_game_status` 只保留绑定、壳、插件、缓存、在线、`nwPackage.name` 等字段。`chaya_edit_catalog` 按 `kind` 取一类并按 `q` 过滤，默认最多 50 条。

## 4. 鉴权与安全

| 调用方             | 凭证                                 | 可访问                                                 |
| ------------------ | ------------------------------------ | ------------------------------------------------------ |
| Agent → `/api/mcp` | `Authorization: Bearer <管理 token>` | 全部 MCP 工具                                          |
| 浏览器页面         | 管理 cookie                          | `/api/mcp`（试调）、`/api/integration/mcp`（取 token） |
| 游戏插件           | `X-Chaya-Launch-Token`               | 仅本房间的 `/api/runtime/agent`；**不能**调 `/api/mcp` |
| 任何人             | 无                                   | `/skills/<id>.md`（公开文档）                          |

- `/api/integration/mcp` 在 Edge 返回 `{ available: false }`，绝不返回 token（Edge 下 `mayAccessApi` 全放行，必须自行判 `canUseDisk`）；响应 `no-store`；服务地址固定 `http://127.0.0.1:<port>/api/mcp`（`dev:lan` 监听 0.0.0.0 时也不把局域网地址写进安装链接）。
- `proxy.ts` 只放行 `/skills/` 前缀；`/integration/skills` 页面仍需管理授权。
- `chaya_live_eval` 由 `CHAYA_MCP_EVAL=1` 控制：关闭时不出现在 `tools/list`，也不可调用。
- `chaya_live_call` 只允许 `ChayaEdit` / `ChayaBoost` / `ChayaTrans`，链式调用每一步只能调这些对象列出的方法；`game.eval` 只在本机长轮询且开启 `CHAYA_MCP_EVAL=1` 时执行。
- 破坏性工具在描述里写明「先征得用户同意」，目录里标 `destructive: true`，页面显示 ⚠️。

## 5. 页面

- `app/integration/layout.tsx`：二级导航（Skills / MCP），参照 `app/translate/layout.tsx`；不包 `RequireBoundGame`。
- `/integration/skills/[id]`：`generateStaticParams` + `dynamicParams=false` 限定 id；根布局读 cookie，所以页面按需渲染（`/skills/[file]` 原文路由是构建期 SSG）。服务端用 `marked` 把 Skill Markdown 转 HTML（仓库内可信内容）。左侧列表，右侧正文 + 「安装到 Agent」（Cursor / Claude Code / Codex 三个目标的 `curl` 命令，`CopyField`）。
- `/integration/mcp`：客户端组件读取 `/api/integration/mcp`：
  - 可用：服务地址 + token（`CopyField`）+ 安装按钮 + 试调面板。
  - 不可用（Edge）：提示改用本机 dev / App，文档照常。
  - 工具卡片由 `mcp-catalog` 渲染：参数表从 `inputSchema` 生成。
- 主导航 `AppNav` 增加「集成」，匹配 `/integration/*`。
- `proxy.ts`：`/skills/` 前缀与 `/sh/` 一样公开。

## 6. 安装链接

| 目标        | 形式                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Cursor      | `cursor://anysphere.cursor-deeplink/mcp/install?name=chaya&config=<base64({url, headers})>`         |
| VS Code     | `vscode:mcp/install?<urlencode({name, type:'http', url, headers})>`                                 |
| Claude Code | `claude mcp add --transport http --scope user chaya <url> --header "Authorization: Bearer <token>"` |
| Codex       | `codex mcp add chaya --url <url> --bearer-token-env-var CHAYA_MCP_TOKEN`（并提示导出该环境变量）    |

Skill 安装命令：`mkdir -p <dir>/<id> && curl -fsSL <origin>/skills/<id>.md -o <dir>/<id>/SKILL.md`，`<dir>` 为 `~/.cursor/skills` / `~/.claude/skills` / `~/.codex/skills`。

## 7. 测试

| 层级   | 用例                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 协议   | `initialize` / `tools/list` / `tools/call` / 通知 / 隐藏工具（已有）                                                                                                                                         |
| 目录   | 目录与实现一一对应；名称唯一且符合 `chaya_<group>_<verb>`；`inputSchema` 为 object                                                                                                                           |
| 工具   | `invokeRoute` 解包与报错；library 筛选与裁剪；remark 不切换当前游戏；logs 关键词；catalog 过滤；translate job 参数映射；game 状态裁剪 / 装壳 / 窗口；live 调用与按键校验；cache 查询映射；play_settings 合并 |
| 安装   | 四种安装链接 / 命令格式                                                                                                                                                                                      |
| 鉴权   | `/api/integration/mcp` 在 Edge 不返回 token；插件 token 不能调 `/api/mcp` 与 `/api/integration/mcp`；proxy 放行 `/skills/` 但拦截 `/integration/*`                                                           |
| Skill  | 清单里每个 id 都有 `SKILL.md`，frontmatter `name` 与 id 一致                                                                                                                                                 |
| 端到端 | 本机实例 curl：`tools/list` 数量、`chaya_library_list`、`chaya_logs_query`、`chaya_cache_query`；浏览器：Skills / MCP 页、试调、Edge 提示                                                                    |
| 页面   | 参数表 / 示例参数 / JSON 校验 / `tools/call` 结果解析（`components/integration/mcp/schema.ts`）                                                                                                              |

## 8. 修订

| 日期       | 说明                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | 初稿                                                                                                                                   |
| 2026-10-03 | Review：凭证脱敏、日志先筛后截、透传 signal、工具实现移到 `app/api/mcp/_tools`、补窗口 / 壳卸载 / 游戏内翻译设置、参数枚举、不暴露清单 |
| 2026-10-03 | 开发后 Review：Codex 环境变量提示、真实鉴权与 proxy 单测、各分组工具单测、MCP 内容语言提示、试调显示服务端错误原因                     |
