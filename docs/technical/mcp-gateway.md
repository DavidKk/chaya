# 统一 MCP 入口（本机网关）技术设计

> 需求真源：[docs/integration.md](../integration.md) §2.1
> 相关：[integration-mcp.md](./integration-mcp.md)（本机 `/api/mcp` 与工具实现）、[webmcp.md](./webmcp.md)（浏览器内 Agent）

- **日期**：2026-10-03
- **状态**：一期已实现（需求流程 Review、双文档 Review 均 PASS）；二期（多游戏登记）未开始

---

## 1. 背景与结论

- Edge 下游戏只与浏览器标签页走 WebRTC；Vercel 函数无长连接、无跨实例状态，**服务端 MCP 触达不到用户的游戏**。
- 目标：Agent **只绑一次**，本机服务 / 只用 Edge / 多个游戏都不用改配置；**不分发任何原生二进制**（避免 macOS 签名 / Windows SmartScreen）。
- 对比过的方案：

| 方案                            | 结论     | 原因                                                     |
| ------------------------------- | -------- | -------------------------------------------------------- |
| Edge 作发现服务 / 中转          | 不做     | MCP 无重定向；中转需 Redis / DO 等有状态设施，数据经云端 |
| stdio 启动器（npx / 二进制）    | 不做     | 无 Node 时只能发原生二进制，绕不开签名                   |
| 每个游戏单独一个 MCP            | 不做     | 每加游戏改配置；N 个固定端口冲突面更大；工具重复占上下文 |
| 本地 socket + `nc` / PowerShell | 备选     | 无端口冲突，但需写命令配置、游戏未开时 stdio 直接断开    |
| **本机固定端口 HTTP 网关**      | **采用** | 填一个 URL、零安装、零签名；冲突面只有一个端口且可检测   |

## 2. 总览

```text
Agent ──HTTP──► 127.0.0.1:<端口，默认 39271>/mcp（网关，谁先起谁占）
                  ├─ 本机服务（dev / App）：HTTP 转发到 /api/mcp → 全部工具（游戏走现有长轮询）
                  └─ 游戏插件 ChayaAgent（只用 Edge 时）：游戏内工具
                        └─（二期）其他游戏随机端口登记 → 按 game 参数转发
浏览器内 Agent ──WebMCP──► Edge / 本机页面（不变）
```

- 网关地址：`http://127.0.0.1:<端口>/mcp`，默认 39271；端口来自用户级端口配置文件（§3.1），所有游戏、本机服务、App 共用。
- **本机服务照旧**：`/api/mcp` 的工具、鉴权、地址都不变；网关只是额外的固定入口。

## 3. 端口归属

| 场景                      | 网关持有者                                | 提供的工具               |
| ------------------------- | ----------------------------------------- | ------------------------ |
| 本机服务运行（dev / App） | 本机服务                                  | `/api/mcp` 全部工具      |
| 只用 Edge，开了一个游戏   | 该游戏的 ChayaAgent                       | 游戏内工具（§5.2）       |
| 只用 Edge，开了多个游戏   | 一期：先启动者；二期：先启动者 + 其余登记 | 一期只有持有者；二期合并 |
| 端口被非 Chaya 程序占用   | 无                                        | 提示改端口               |

### 3.1 端口配置

| 平台    | 端口配置文件                                                                   |
| ------- | ------------------------------------------------------------------------------ |
| macOS   | `~/Library/Application Support/Chaya/mcp.json`                                 |
| Windows | `%APPDATA%\Chaya\mcp.json`（`C:\Users\<用户>\AppData\Roaming\Chaya\mcp.json`） |
| Linux   | `$XDG_CONFIG_HOME/chaya/mcp.json`（未设置时 `~/.config/chaya/mcp.json`）       |

- 内容 `{ "port": 39271 }`；文件缺失或非法按默认 39271。不提供环境变量覆盖：游戏由用户双击启动，读不到本机服务的环境变量，有覆盖就会出现两边端口不一致。
- 落点：路径解析与读写放 `lib/integration/mcp-port.ts`（路径解析为纯函数：平台 + `HOME` / `APPDATA` / `XDG_CONFIG_HOME` → 路径），本机服务（`instrumentation.ts`，§4）与插件（Vite 打包时经 `@/lib` 引入，已有先例）共用。
- 目录名：macOS / Windows 用 `Chaya`，与打包 App（`electron-builder.yml` 的 `productName: Chaya`）的 `userData` 同一目录，App 用户不多出新目录；Linux 按 XDG 惯例用小写 `chaya`。
- 在游戏内（§5.4）或本机「集成 → MCP」（§8）修改：校验 1024–65535 → 试监听新端口 → 写文件（先写临时文件再改名）；被占用则不写。
- 生效：网关持有者用 `fs.watchFile`（轮询 stat，约 2 秒；文件或目录不存在也能监听，`fs.watch` 做不到）发现变化后关旧端口、监听新端口；本机服务同样；其他游戏下次探测即用新端口。
- 不乱放：只用上表一个位置，不在游戏目录、壳目录或其他位置写任何 MCP 配置；文件只有端口一项（几十字节）。
- 按需创建：端口为默认值时不建文件；改回默认等同删除。
- 一键删除：删除 `mcp.json`，若所在目录随之为空也一并删除（目录里有 App 数据时只删文件）；删除后网关回到默认端口。
- 清空：删除文件即恢复默认；游戏内显示完整路径（可复制）。

### 3.2 探测

- 监听前先探测：`GET http://127.0.0.1:<port>/.well-known/chaya-mcp` 返回 `{ chaya: true, role: 'server' | 'game', gameId? }` 即为 Chaya。
  - 是 Chaya：一期记日志「已有 Chaya 提供 MCP」，不再监听；二期改为登记（§6）。
  - 连不上：监听；`EADDRINUSE` 竞态时回到探测。
  - 非 Chaya：游戏日志 + 游戏内状态「端口被占用」。
- 本机服务优先：本机服务起来后若端口被游戏占用，每 5 秒重试；二期由本机服务发带 `X-Chaya-Takeover: server` 头的探测请求，游戏收到后主动释放端口。一期只做重试。

## 4. 本机服务侧

- 落点：Next `instrumentation.ts` 的 `register()`（仅 Node 运行时、非 Edge 构建、非 Vercel；dev 切到 Edge 时 `listen` 回调读 `canUseDisk()` 释放端口）动态引入 `services/integration/mcp-gateway.ts`，用 `node:http` 另开网关端口；dev、`next start`、App（standalone `server.js`）都会执行，无需改 `next-listen.mjs` / `electron/main.cjs`。
- 行为：`POST /mcp` 转发到 `http://127.0.0.1:<PORT>/api/mcp`，附 `Authorization: Bearer ${CHAYA_AUTH_TOKEN}`；`GET /.well-known/chaya-mcp` 返回身份；其余 404。
- 为什么转发而不是进程内调用：instrumentation 与路由是不同的打包产物，模块级状态（日志、配置缓存等）不共享；转发保证与直连 `/api/mcp` 行为完全一致。令牌只在本机进程间传递，不出现在响应。
- dev 热更新会重复执行 `register()`：用 `globalThis.__chayaLocalMcpGateway` 保存实例，已在监听则跳过。启动失败只记日志，不阻塞服务就绪。
- 本机服务模式下游戏插件**不开网关**（`ChayaEnv` 不写开启标记），游戏工具经现有 `/api/runtime/agent` 长轮询，避免同一游戏两份工具。
- 「集成 → MCP」主推网关地址（读 §3.1 实际端口）；`/api/mcp`（3000 / 3927）列为兼容地址。

## 5. 游戏插件侧（ChayaAgent）

### 5.1 开启条件

- 只在 Edge 写入的 `ChayaEnv`（「安装插件」与「连接」都会写）带 `CHAYA_MCP_GATEWAY = true`（与 `CHAYA_LOG_TRANSPORT = 'link'` 同时写入）时开启；端口按 §3.1 读取。
- 需 NW.js Node 上下文（`require('http')`）；纯浏览器运行的游戏没有，记日志跳过。

### 5.2 工具

| 工具                 | 实现                                                 |
| -------------------- | ---------------------------------------------------- |
| `chaya_live_games`   | 返回本游戏（二期：合并已登记游戏）                   |
| `chaya_live_state`   | `runAgentCommand({ method: 'game.state' })`          |
| `chaya_live_plugins` | `plugins.list`                                       |
| `chaya_live_call`    | `plugin.call` / `plugin.tool`                        |
| `chaya_live_press`   | `input.press`                                        |
| `chaya_plugin_*`     | 由 `plugins.list` 声明的插件工具生成，与本机同名同参 |

- 定义取自 `lib/integration/mcp-catalog` 的 live 分组，与本机 `/api/mcp` 同名同 schema；`gameId` 参数保留（一期只接受本游戏 id 或省略）。
- 方法白名单同 `AGENT_LINK_METHODS`，**永不开放 `game.eval`**。
- 游戏库、装壳、缓存、日志、翻译任务等控制台工具不在游戏内；Edge 下由页面 WebMCP 提供。

### 5.3 协议

- MCP Streamable HTTP，只回 JSON（不推 SSE）：`initialize`、`ping`、`tools/list`、`tools/call`；通知回 202；支持批量；`GET /mcp` 回 405。
- 把 `initializer/mcp.ts` 中与 Next 无关的 JSON-RPC 处理抽到 `lib/integration/mcp-protocol.ts`（纯函数：解析 → 分派 → 结果），服务端与插件共用；服务端仍用 `NextResponse` 包装，插件用 `http.ServerResponse`。

### 5.4 游戏内展示

- ChayaAgent 没有界面：由它在 `window.ChayaAgent.gateway` 暴露状态与操作（`status` / `setPort` / `resetPort` / `openFolder` / `openDocs`），局内面板（ChayaEdit）顶栏新增「MCP」页（`components/game-edit/GameEditMcpPane.tsx`，只在局内浮层出现）显示统一地址（可复制）、状态与处理建议：

| 状态                 | 判定                               | 建议文案                     |
| -------------------- | ---------------------------------- | ---------------------------- |
| 已开启（本游戏提供） | 监听成功                           | Agent 可连接                 |
| 由其他 Chaya 提供    | 探测到 `role: 'game'`              | 一期由该游戏响应 Agent       |
| 由本机服务提供       | 探测到 `role: 'server'` 或本机模式 | 无需操作                     |
| 端口被占用           | 端口被非 Chaya 程序占用            | 关闭占用程序，或在此修改端口 |
| 未开启               | 无开启标记或无 Node 上下文         | 在 Edge 重新安装插件         |

- 修改端口：输入框 + 保存（规则见 §3.1）；保存成功后显示新地址与「请在 Agent 中改为新地址或重新安装 MCP」，可复制地址与 `mcp.json` 片段；同时显示端口配置文件完整路径（可复制）。无 Node 上下文时置灰。
- 按钮：
  - 「删除端口配置」：二次确认后执行 §3.1 一键删除，提示「已恢复默认端口 39271，请在 Agent 中改回默认地址」；文件不存在时置灰并显示「未创建（使用默认端口）」。
  - 「打开所在文件夹」：用系统文件管理器打开配置目录（NW.js `nw.Shell.showItemInFolder` / `openItem`）；文件不存在时置灰。
  - 「打开文档」：用系统浏览器打开集成文档（`nw.Shell.openExternal`，固定链接 `https://github.com/DavidKk/chaya/blob/main/docs/integration.md`），不依赖 Edge 或本机服务在线。
- 另显示「最近一次 Agent 请求：xx 秒前」（网关记录最后一次 `POST /mcp` 时间），用于判断 Agent 是否真的连上。
- 不回报 Edge 页面：页面只是静态文档（三步前提、默认端口「以游戏内为准」、各平台端口配置文件位置）。不让页面直接探测 `127.0.0.1:39271`：需放开浏览器跨站请求（与 §7 冲突），且会触发 Chrome 私有网络访问限制。

## 6. 多游戏（二期）

- 跟随者：在 `127.0.0.1` 随机端口开私有入口，`POST <网关>/.well-known/chaya-mcp/register` 登记 `{ gameId, name, port, secret }`，每 5 秒心跳；网关 15 秒无心跳即剔除。
- 网关：`tools/list` 合并（`chaya_live_*` 一份，`gameId` 选目标；插件工具按游戏区分），`tools/call` 按 `gameId` 转发到跟随者，带 `secret`；省略 `gameId` 时用最近活跃的游戏。
- 接手：持有者退出后跟随者每 3 秒重试监听，先成功者成为网关，其余重新登记；期间 Agent 请求失败一次后重试即可。
- 本机服务作网关时也接受登记（Edge 游戏与本机服务同时存在的情况）。

## 7. 安全

- 只绑 `127.0.0.1`。
- 拒绝带 `Origin` 头的请求（浏览器跨站请求必带）；`Host` 必须为 `127.0.0.1:<port>` 或 `localhost:<port>`（防 DNS rebinding）；`POST /mcp` 要求 `Content-Type: application/json`。
- 网关本身不要求令牌（本机 Agent 零配置），与本机 API 免登录一致；`eval` 永不开放。
- 二期跟随者私有入口必须带登记时的 `secret`，只接受网关转发。

## 8. 页面

- 「集成 → MCP」两种形态都展示统一地址、Cursor / VS Code 安装链接、Claude Code / Codex 命令、`mcp.json`：
  - 本机：网关地址为主，`/api/mcp` 为兼容；试调面板不变。
  - Edge：不再提示「改用本机」；静态展示统一地址、安装方式与三步前提（Edge 安装插件 → 打开游戏 → Agent 连接）；不随连接变化；工具卡片中不可用分组标注「需本机服务」。
- 本机页面读实际生效端口生成地址与安装链接，并提供改端口 / 删除端口配置 / 打开所在文件夹（`/api/integration/mcp` 的 `PUT` / `DELETE` / `POST`，`POST` 在 Finder / 资源管理器中显示配置文件）；Edge 页面无法读取本机文件，写明默认值与文件位置。

## 9. 清理（一期已完成）

Edge 不再有服务端 MCP，已删除：

- `services/access/api.ts` 中 Edge `/api/mcp` 的 OAuth 分支；`initializer/controller.ts` 的 `WWW-Authenticate`。
- OAuth 全套：`app/oauth/**`、`app/.well-known/oauth-*`、`openid-configuration`、`services/access/oauth/*`、`components/auth/OAuthConsent.tsx`、`lib/integration/mcp-scopes.ts` 的授权部分、`__tests__/services/access/oauth-flow.spec.ts`。
- Edge 登录：`app/login`、`app/auth/**`、`components/auth/{LoginForm,UserMenu,AuthFrame}.tsx`、`services/access/{login,session,jwt,signet,totp}.ts`、`lib/auth-paths.ts` 及相关 i18n、测试、环境变量说明。
- `SwitchToggle` 三态保留（通用组件）。
- 文档：删除 `docs/auth.md` / `docs/technical/auth-oauth.md`；访问控制（本机同源 + `Host` 校验、Edge 公开）只在 [deployment-platforms.md](./deployment-platforms.md) 描述。

## 10. 测试与验证

| 层级     | 用例                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 协议     | `mcp-protocol` 纯函数：初始化、列表、调用、通知、批量、错误码（服务端与插件共用一套）                                                       |
| 网关安全 | 带 `Origin` 拒绝；非回环 `Host` 拒绝；非 JSON 拒绝；`eval` 不在列表且调用被拒                                                               |
| 端口归属 | 空闲 → 监听；Chaya 占用 → 不监听并记日志；非 Chaya 占用 → 报端口被占；竞态 `EADDRINUSE`                                                     |
| 本机网关 | 网关与 `/api/mcp` 的 `tools/list` 一致；凭证不出现在响应                                                                                    |
| 端口配置 | 三平台路径解析（含 `XDG_CONFIG_HOME` 缺省）；非法内容回落默认；默认值不建文件、改回默认即删；删除后空目录一并删除、非空只删文件；占用时不写 |
| 插件     | 工具由 catalog 生成且同名同 schema；`gameId` 不匹配报错；Edge 未写标记时不监听                                                              |
| 端到端   | Cursor / Claude Code / Codex 填同一 URL：本机服务、只用 Edge 两种情况都能 `tools/list` 与 `chaya_live_state`                                |

## 11. 实施步骤

1. 一期：`mcp-protocol` 抽取 → `mcp-port` → 本机网关（`instrumentation.ts`）→ 插件网关（单游戏）→ 游戏内状态、改端口与三个按钮 → 页面 → 清理 OAuth / Edge 登录 → 文档与 skills。
2. 二期：登记、合并、转发、接手；本机服务接受登记。
3. 备选：若反馈端口冲突或遇到只支持 stdio 的客户端，再加本地 socket 入口（`~/.chaya/mcp.sock` / `\\.\pipe\chaya-mcp`，配 `nc -U` / PowerShell），复用同一网关逻辑。

## 12. 修订

| 日期       | 说明                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | 初稿：本机固定端口网关，Edge 由游戏插件提供 MCP，撤 OAuth                                                                                                |
| 2026-10-03 | 精简：Edge 页面与插件只展示固定地址，不做 WebRTC 状态联动、不提供改端口；游戏内显示本游戏网关状态                                                        |
| 2026-10-04 | Edge 写明三步前提；游戏内五种状态附处理建议与最近一次 Agent 请求时间                                                                                     |
| 2026-10-04 | 端口可在游戏内修改，写入用户级端口配置文件（分平台路径），本机服务 / App / 插件共用并热切换；Edge 只做静态文档                                           |
| 2026-10-04 | 端口配置文件只放一处、按需创建；游戏内增加「删除端口配置」「打开所在文件夹」「打开文档」                                                                 |
| 2026-10-04 | Review：本机网关改为 `instrumentation.ts` 进程内分派（不再转发、不需令牌）；目录统一小写 `chaya`；去掉 `CHAYA_MCP_PORT`；`fs.watchFile`；补端口配置测试  |
| 2026-10-04 | 双文档 Review PASS；本机网关回到 HTTP 转发（instrumentation 与路由模块状态不共享）；局内入口为顶栏「MCP」；本机集成页可管理端口；Edge 登录随 OAuth 移除  |
| 2026-10-04 | 一期实现：macOS / Windows 目录对齐 App `productName` 为 `Chaya`；打开文件夹改走 `POST /api/integration/mcp`；Edge 工具卡标注「需本机服务」；删除登录文档 |
