# 部署方式 × 操作系统：优化方案

> 状态：部分实施（逐项状态见 §0，落地记录见 §11；完成后同步 [deployment-platforms.md](deployment-platforms.md)）
>
> 现状与已定决策以 [deployment-platforms.md](deployment-platforms.md) 为准；本文只写要改什么、怎么改、怎么验收。

---

## 0. 总览

| 编号 | 优化项                                        | 优先级 | 状态           | 解决的问题                                             | 依赖          |
| ---- | --------------------------------------------- | ------ | -------------- | ------------------------------------------------------ | ------------- |
| O1   | 浏览器模式日志隔离                            | P0     | **已完成**     | 所有访问者共用日志（隐私）、可被任意灌入               | —             |
| O2   | 能力层：拆分 `canUseDisk`                     | P1     | 待实施         | 一个开关同时管"用户游戏文件"和"服务端存储"             | —             |
| O3   | 服务端「下载 / 升级 NW.js」改后台任务         | P1     | 已完成         | 确认弹窗一直转圈、期间不能操作、卡住最长约 5 分钟      | O2（可选）    |
| O4   | 浏览器模式 Windows 装壳不再锁整张卡片         | P1     | 已完成         | 装壳期间整卡 busy                                      | —             |
| O5   | Windows 装壳增加 PowerShell 命令备选          | P2     | 待实施         | 页面装壳步骤多、无下载进度、非 Chromium 无法装         | —             |
| O6   | 信令：鉴权 + 共享存储 + 部署门禁              | P0     | **鉴权已完成** | 信令无鉴权可被抢连；Vercel 多实例下连不上游戏          | —             |
| O7   | Linux 装壳改终端命令                          | P3     | 待实施         | 只有下载链接，用户需自己解压、`chmod`                  | O5 的脚本框架 |
| O8   | 命名：构建目标 `edge`、形态 `vercel` 改语义名 | P3     | 待实施         | `edge` 被误读为 Next Edge Runtime；自托管也叫 `vercel` | O2、O9        |
| O9   | 部署文档修正                                  | P0     | **已完成**     | 命名混淆、前置条件缺失、Linux 写成已实现、过度承诺     | —             |
| O10  | 浏览器模式前置条件检测与提示                  | P1     | 待实施         | 非 HTTPS / 非 Chromium 时选目录失败且无说明            | —             |

建议顺序：O9（纯文档，先做）→ O6 鉴权 + O1 → O6 共享存储 → O2 → O3 / O4 / O10 → O5 → O7 → O8。

O1 与 O6 必须一起看：实施前，日志若含游戏 id（即信令房间号），而日志又对所有人可见、信令又无鉴权，别人就能拿房间号抢先连上用户的游戏；浏览器模式下游戏具备 Node 文件能力，后果比泄露日志严重。O1 与 O6.2 已消除这条攻击链，Vercel 多实例可用性仍待 O6.3。

---

## 1. O1 浏览器模式日志隔离（P0，已完成：采用 1.3）

### 1.1 实施前问题（已修复）

- 游戏插件把日志 `POST` 到 `CHAYA_LOG_URL`（`buildChayaEnvJs` 写入，等于页面 origin 的 `/api/logs`）。
- `/api/logs`、`/api/logs/stream` 读写同一个进程内缓冲（`services/log/bus.ts`），不区分游戏 / 用户；接口开放跨域（`Access-Control-Allow-Origin: *`）。
- 浏览器模式下，`LogPanel` 与 WebMCP 的日志工具都读这个共用缓冲；因此网页版禁止清空日志。
- 同时 `appendLogToFile` 会尝试写 `logs/plugins/*.ndjson`：Vercel 上失败被吞，自托管时真实写盘。

### 1.2 目标

- 浏览器模式下，一个用户只能看到自己游戏的日志；外部不能往别人的日志里写。
- 浏览器模式不在服务器落盘。
- 服务端模式行为不变。

### 1.3 已采用方案：浏览器模式日志改走游戏连接

浏览器模式下，翻译、修改器已经经 WebRTC 数据通道由游戏执行，日志同样走这条通道，不经服务器。

1. **协议**（`lib/runtime/game-link-protocol.ts`）新增 `{ type: 'log.batch'; entries: LogEntry[] }`（游戏 → 页面）。未增加单独的 backlog request；DataChannel 打开时游戏主动补发最近 200 条。
2. **游戏侧**（插件 logger）：
   - 保留环形缓冲（如 2000 条）。
   - 已连接：每 200ms 按约 6000 字符分批发送 `log.batch`；单条消息与 meta 会截断，控制 DataChannel 消息体积。
   - 未连接：只入缓冲；连接后主动补发最近 200 条。
   - 浏览器模式下 `buildChayaEnvJs` 写 `CHAYA_LOG_TRANSPORT = 'link'`、清空 `CHAYA_LOG_URL`，插件不再 `POST` 服务器。
3. **页面侧**：
   - `GameLinkProvider` 收 `log.batch`，写入页面内存日志存储；切换游戏时清空，不持久化到 IndexedDB。
   - `LogPanel` 在浏览器模式读页面日志存储，不连 `/api/logs/stream`；清空只清本地，可放开「清空」。
   - WebMCP `chaya_logs_*` 读页面日志存储；从 `EDGE_UNAVAILABLE_TOOLS` 移除 `chaya_logs_clear`。
4. **服务端**：浏览器模式下 `/api/logs` 的 `POST` 为兼容旧插件返回 200 但静默丢弃，`GET` 返回空；SSE 只保活、不推日志条目。服务端模式不变。

### 1.4 备选：服务端按房间隔离（过渡方案）

若 1.3 工期不允许，先上线最小止血：

- 插件 `POST` 带 `X-Chaya-Game-Id`（取 `CHAYA_GAME_ID`）；服务端按游戏 id 分桶。
- `GET` / `stream` 必须带 `room=<游戏 id>`，只返回该桶；无 `room` 返回 400。
- 浏览器模式下游戏 id 是随机 UUID，持有即授权；不落盘。
- 缺点：仍受 Vercel 多实例影响（O6），只能作为过渡。

### 1.5 涉及文件

`lib/runtime/game-link-protocol.ts`、`components/GameLinkProvider.tsx`、`components/LogPanel.tsx`、`components/webmcp/edge/link.ts`、`components/webmcp/edge/index.ts`（`EDGE_UNAVAILABLE_TOOLS`）、`lib/webmcp/mode-matrix.ts`、`lib/game/plugins-merge.ts`（`buildChayaEnvJs`）、插件 logger（`plugins/src/helpers/...`）、`app/api/logs/route.ts`、`app/api/logs/stream/route.ts`、`services/log/*`。

### 1.6 验收

- 两个浏览器各自连接不同游戏：日志互不可见。
- 浏览器模式下 `curl -X POST /api/logs` 不会出现在任何人的日志面板。
- 游戏先运行、页面后连接：能看到连接前的积压日志（上限内）。
- 自托管 edge 构建运行后，服务器上不产生 `logs/plugins/*.ndjson`。
- 服务端模式日志面板、落盘、清空行为不变。
- 测试：协议编解码、页面日志存储（环形缓冲 / 按游戏分隔）、`buildChayaEnvJs` 浏览器模式不含日志地址。

---

## 2. O2 能力层：拆分 `canUseDisk`（P1）

### 2.1 现状

`canUseDisk = 形态 !== 'vercel'`，同时被用来判断：能否读写用户游戏文件、能否写服务端自己的存储、能否启动游戏、是否要访问授权、界面走哪套逻辑。O1 的日志写盘问题即由此产生。

### 2.2 设计

新增 `lib/service-mode/capabilities.ts`（纯函数，无 fs）：

```ts
export type Capabilities = {
  /** 用户游戏文件由谁读写 */
  gameFiles: 'server' | 'browser'
  /** 服务端能否写自己的存储（配置、日志、共享译文缓存） */
  serverStorage: boolean
  /** 能否运行长任务（下载、批量翻译） */
  longTasks: boolean
  /** 服务端能否启动游戏 */
  launch: boolean
}

export function getCapabilities(mode = getServiceMode()): Capabilities
```

| 能力            | local  | app    | vercel（含自托管 edge 构建） |
| --------------- | ------ | ------ | ---------------------------- |
| `gameFiles`     | server | server | browser                      |
| `serverStorage` | true   | true   | false                        |
| `longTasks`     | true   | true   | false                        |
| `launch`        | true   | true   | false                        |

以后若新增 `node` 形态，只在此表加一列（`gameFiles: browser, serverStorage: true, longTasks: true, launch: false`），业务代码不改。

### 2.3 迁移

| 现用法                                                                             | 改为                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `requireDisk()`（读写游戏文件的接口）                                              | `requireGameFiles()`，语义不变                                                         |
| 只写服务端存储的地方（日志落盘、共享译文缓存）                                     | `requireServerStorage()` / `capabilities.serverStorage`                                |
| `/api/status` 的 `canUseDisk`                                                      | 新增 `capabilities`；`canUseDisk` 保留一个版本作兼容别名（= `gameFiles === 'server'`） |
| Dashboard `browserMode`                                                            | `capabilities.gameFiles === 'browser'`                                                 |
| `GameEditPage` / `useBoundGame` / `LibraryRail` / `ChooseGameGate` 的 `canUseDisk` | 按语义改为 `gameFiles`                                                                 |
| `proxy.ts` 管理授权门禁                                                            | `gameFiles === 'server'` 时启用                                                        |
| `/api/runtime/agent`                                                               | `gameFiles === 'server'`                                                               |
| `services/log/file-store.ts` 落盘                                                  | `serverStorage` 为真时才写                                                             |

- 用 `rg "canUseDisk|requireDisk|browserMode"` 列全清单，逐处按语义归类；不确定的按 `gameFiles` 处理。
- `docs/technical/service-modes.md` §3 与 `deployment-platforms.md` §3 同步改为能力表。

### 2.4 验收

- 能力表单测覆盖三种形态（含 dev 切换器、`VERCEL=1` 强制）。
- 全仓除兼容别名外不再出现 `canUseDisk` 的新用法（可加 ESLint 规则或评审约定）。
- 现有行为不变：`pnpm ok` 通过，edge / server 构建路由数不变。

---

## 3. O3 服务端「下载 / 升级 NW.js」改后台任务（P1，并入下载中心，已完成）

### 3.1 实施前问题（已修复）

`POST /api/shell { fetchLatest: true }` 同步执行：拉版本 → 下载约百兆 → 解压 → 复制到 `data/shell`，全部完成才返回。确认弹窗在 `onConfirm` 里等待，期间弹窗关不掉；下载无超时、无进度、失败后从头再下。

### 3.2 设计

见 [`download-center.md`](./download-center.md) §3：后台任务 + SSE 推进度 + 右上角下载中心；`.part` + Range 断点续传（对齐 bash）、SHA-256 校验、60 秒空闲超时、可取消；安装改为暂存后整体替换（游戏运行中也不会把壳弄坏）；MCP 传 `wait: true` 保持同步语义。

与本节旧稿的差异：进度改为 SSE 推送（不复用 `/api/status` 轮询）；进度显示在下载中心（不在卡片补充信息段）；失败 / 取消保留 `.part`，启动时不清理。

### 3.3 验收

见 `download-center.md` §8。

---

## 4. O4 浏览器模式 Windows 装壳不再锁整张卡片（P1，并入下载中心，已完成）

### 4.1 实施前问题（已修复）

`useCloudLibrary.installShell` 走 `run()`，设置全局 `busy`，装壳期间整张卡片不可操作；进度文字在补充信息段。选压缩包的文件框在 `await` 拉版本之后才弹出，可能超过用户手势有效期。

### 4.2 设计

见 [`download-center.md`](./download-center.md) §4：装壳成为下载中心的浏览器任务，不设全局 `busy`；任务行提供「打开官方下载」「选择已下载的压缩包」两个按钮承接用户手势；按游戏加 Web Locks；可取消，已写文件续写。完成提示补充 SmartScreen 说明（首次运行若提示"已保护你的电脑"，点「更多信息 → 仍要运行」）。

### 4.3 验收

见 `download-center.md` §8。

---

## 5. O5 Windows 装壳增加 PowerShell 命令备选（P2）

### 5.1 目的

页面装壳要"浏览器下载 + 手动选文件"，无下载进度，且依赖 FSA（仅 Chromium）。提供与 macOS 一致的"复制一条命令"方式作为备选。

### 5.2 设计

- 新增脚本 `win-shell.ps1`，与 `mac-shell.sh` 一样经 `/sh/<name>` 提供（`lib/game/` 下生成脚本内容，`app/sh/[name]` 路由分发）。
- 命令形如 `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm <origin>/sh/win-shell.ps1 | iex"`。
- 脚本步骤对齐 macOS：
  1. 弹出文件夹选择（`System.Windows.Forms.FolderBrowserDialog`）选游戏目录；校验 `www/index.html` 或 `index.html` + `js/`。
  2. 拉 `versions.json` 取 stable。
  3. 下载 zip（显示进度；缓存到 `%TEMP%\chaya-nwjs\` 支持续传），校验 `SHA256SUMS`。
  4. `Expand-Archive` 到临时目录，替换 `<游戏目录>\<壳目录>`（旧的改名备份，失败回滚）。
  5. 写 `Chaya启动.bat`；`Unblock-File` 去掉"来自网络"标记，避免 SmartScreen 拦截。
- 界面：Windows 装壳弹窗内两种方式并列，页面安装为默认，命令为备选；非 Chromium 浏览器只显示命令方式。

### 5.3 验收

- Windows 10 / 11 x64、arm64 各跑通一次；已装同版本时跳过；中途断网可续传。
- 安装后双击 `Chaya启动.bat` 不触发 SmartScreen。

---

## 6. O6 信令：鉴权 + 共享存储 + 部署门禁（P0，6.2 鉴权已完成；6.3 / 6.4 待做）

信令是浏览器模式的核心链路：配不上对 = 连不上游戏 = 翻译、修改器全部不可用。不能当普通体验问题处理。

### 6.1 当前状态

- `/api/runtime/webrtc` 的房间仍存在进程内 `Map`（`services/runtime/webrtc-signaling.ts`，10 分钟 TTL），因此只适用于单进程。
- **鉴权已完成**：浏览器模式用按游戏生成的连接令牌；服务端模式沿用管理授权与 launch token。服务器只保存连接令牌的 SHA-256。
- API 必须显式提供 `roomId`；读取 / 应答不会创建房间。插件内部仍用 `'default'` 作“尚未取得游戏 id”的哨兵值，但不会向该房间发请求。
- 浏览器模式日志已经改走 DataChannel，不经过服务端日志总线；房间号会在插件诊断日志中打码，工具输出会过滤 `linkToken`。
- Vercel 上 offer 与 answer 仍可能落在不同实例，冷启动后房间也会消失，因而仍可能连不上游戏；这是 O6.3 尚未解决的核心问题。

### 6.2 鉴权（已完成）

1. **房间令牌**：
   - 浏览器模式：页面在写入 Env 时生成 256 bit `linkToken`，按游戏 id 存在浏览器 `localStorage`，并与 `CHAYA_GAME_ID` 一起经 FSA 写进游戏 Env（`window.CHAYA_LINK_TOKEN`）。服务器仅在房间内存中保存哈希。
   - 服务端模式：复用 `/api/launch` 签发的 launch token（`services/runtime/write-launch-env.ts`）。
2. **校验**：
   - 浏览器模式下页面与游戏的所有信令请求带 `X-Chaya-Link-Token`；服务端模式仍由管理会话或 `X-Chaya-Launch-Token` 进入 API 门禁。
   - 浏览器页面首次 `reset` / `offer` 时记录令牌哈希（SHA-256）；之后读写必须匹配，否则 403。`reset` 清空协商状态但保留令牌绑定。
   - 房间 TTL 保持 10 分钟；令牌随房间过期。
3. **去掉缺省房间**：缺 `roomId` 返回 400；浏览器模式缺连接令牌返回 401、令牌不符返回 403。插件读不到游戏 id 时不发起连接。
4. **来源**：CORS 不是安全边界（非浏览器客户端可直接请求），安全靠令牌；仍可把 `Allow-Origin` 收窄为页面 origin + NW.js 游戏页实际 origin（需实测：`file://` / `chrome-extension://` / `null`）。
5. **容量限制**：房间总数最多 5000，同一来源最多同时持有 20 个未过期房间；来源优先取 `x-real-ip`，再取 `x-forwarded-for` 首段。此限制不是按时间窗口的请求速率限制。
6. **日志脱敏**：日志与 MCP 输出不打印房间号、令牌（`lib/integration/tools/types.ts` 的 `SECRET_KEYS` 加 `linkToken`）。

### 6.3 共享存储（Vercel 生产环境必须）

- `services/runtime/webrtc-signaling.ts` 抽出存储接口：`get(roomId)` / `put(room)` / `delete(roomId)`，带 TTL。
- 默认内存实现（服务端模式、自托管单进程）；配置了 KV（如 Upstash Redis / Vercel Marketplace 的 Redis 环境变量）时用 KV 实现。
- 页面 / 游戏轮询间隔与 KV 读写次数要估算成本，必要时改为长轮询。
- 若 O1 采用 1.4 过渡方案，日志分桶同样接这个存储；O1 采用 1.3（日志走游戏连接）则日志不再依赖服务端。

### 6.4 部署门禁

| 部署              | 在 6.3 完成前                                                           | 6.3 完成后            |
| ----------------- | ----------------------------------------------------------------------- | --------------------- |
| Vercel 生产       | 浏览器模式标为**实验性**，页面提示"连接可能不稳定"                      | 正式支持              |
| 自托管 Node       | 允许，但**必须单进程、单副本**；文档与启动日志明确禁止多副本 / 负载均衡 | 可多副本（需配置 KV） |
| 本地 server / App | 不受影响（单进程）                                                      | —                     |

- 实验性提示的判定：`VERCEL=1` 且未配置信令存储。
- 用自托管时的启动检查：检测到集群 / 多 worker 环境变量时在日志里警告。

### 6.5 验收

- 浏览器模式缺令牌返回 401、令牌错误返回 403；缺 `roomId` 返回 400。
- 两个用户同时连接各自游戏互不影响；第三方拿到房间号也无法写 answer 或重置房间。
- Vercel 生产两台设备"连接 → 启动游戏"20 次全部配对成功（配置 KV 后）。
- 无 KV 配置时，本地 / 自托管单进程行为不变。
- 已有测试：令牌首写绑定、不匹配拒绝、reset 保留绑定、读取 / 应答不建房、房间总量和单来源容量限制、服务端模式门禁分工。
- 待补测试：TTL 过期清理，以及插件在缺游戏 id 时不会发信令请求。

---

## 7. O7 Linux 装壳改终端命令（P3）

- 复用 O5 / macOS 的脚本框架新增 `linux-shell.sh`：`zenity` / `kdialog` 选目录（都没有时要求传参），下载 `.tar.gz`、校验、解压到 `<游戏目录>/<壳目录>`，`chmod +x`，写 `Chaya启动.sh` 并 `chmod +x`。
- 不采用"浏览器写文件"：缺执行权限、需要 tar 解压库，且需确认包内是否含符号链接。
- 现状注意：`writeShellLaunchers` 支持 `'linux'`，但 `installCloudShell` 的 Linux 分支只返回下载链接，从未调用它；O7 落地前文档一律写"仅下载链接"（见 O9）。

---

## 8. O8 命名：构建目标与服务形态改语义名（P3）

现在一个词 "edge" 同时被读成三件事：构建目标 `CHAYA_TARGET=edge`、服务形态 `vercel`、Next.js Edge Runtime。实际云端路由全部是 `export const runtime = 'nodejs'`，没有用 Edge Runtime。目标是三层各用各的名字：

| 概念       | 现在                       | 改为                       | 含义                                   |
| ---------- | -------------------------- | -------------------------- | -------------------------------------- |
| 构建目标   | `server` / `edge` / `dev`  | `server` / `cloud` / `dev` | 是否剔除 `*.server.*` / `*.dev.*` 路由 |
| 服务形态   | `local` / `app` / `vercel` | `local` / `app` / `remote` | 服务的能力边界（再由 O2 映射成能力）   |
| 执行运行时 | Next 路由 `runtime`        | 不变（目前全部 `nodejs`）  | 路由实际在哪种运行时执行               |

- 兼容：`CHAYA_TARGET=edge`、`CHAYA_SERVICE=vercel` 继续接受为别名；`VERCEL=1` 判定不变；`/api/status` 的 `serviceMode` 保留旧值一个版本或同步改前端。
- 改动面：`next.config.ts`、`lib/service-mode/*`、`package.json`（`build:edge` → `build:cloud`，`check:edge` → `check:cloud`，旧脚本保留为别名）、`scripts/check-edge-build.mjs`、dev 切换器文案（Server / Edge → Server / Cloud）、ESLint 规则说明、文档。
- 在 O2 之后做：届时业务代码只看能力，改名只影响 `lib/service-mode` 与展示文案。改名前先由 O9 在文档里说明区别。

---

## 9. O9 部署文档修正（P0，纯文档，已完成）

不改代码，先让文档能作为部署决策依据。

### 9.1 `deployment-platforms.md`

1. **开头声明**：本文的 edge 是项目内部"云端无盘构建目标"的名称，不等同于 Next.js Edge Runtime；云端 API 运行在 Node.js runtime（关键 API 显式声明，其余沿用 Next.js 默认）。§1"不按运行时（Node / Edge）区分"改为"不按部署平台区分"。
2. **改为四层结构**：
   1. 能力模型：游戏文件归属、`canUseDisk`、服务端 / 浏览器模式；
   2. 构建与运行时模型：构建目标 ≠ 执行运行时（O8 的三层表）；
   3. 部署矩阵：增加"运行前提"列；
   4. 实现状态：每项标「已实现并有测试」/「已实现但有部署限制」/「设计方案，未实现」。
3. **部署表"运行前提"列**：

   | 部署方式    | 运行前提                                                                                                                                      |
   | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
   | 本地 server | Node ≥ 22.19.0；局域网访问需管理授权                                                                                                          |
   | App         | 安装包自带运行时                                                                                                                              |
   | Vercel      | HTTPS（平台自带）；Chromium 桌面浏览器；信令多实例问题未解决前为实验性（O6）                                                                  |
   | 自托管 Node | **构建时**设 `CHAYA_TARGET=edge`（只在启动时设无效，目标在构建时写成常量）；Node ≥ 22.19.0；**必须 HTTPS**；单进程单副本；Chromium 桌面浏览器 |

4. **浏览器模式前提写进部署矩阵**（不只放在后文）：
   - 选目录要求安全上下文：HTTPS 或 `localhost`；`http://192.168.x.x` 这类局域网 HTTP 页面无法选目录。
   - 只能拿到目录句柄，拿不到绝对路径。
   - Safari、Firefox、iOS / Android 浏览器不支持当前实现的浏览器模式。
   - 装壳自动化程度按平台不同：Windows 页面安装，macOS 终端命令，Linux 仅下载链接。
5. **自托管 Node 的表述**改为：自托管 Node 使用云端构建目标，只提供浏览器模式；它仍运行 Node.js API，但主动剔除本机磁盘路由。推荐单进程、固定实例，必须启用 HTTPS。
6. **§2.1"远程 Node 与 Edge 能力完全一致"** 改为：两者在"游戏文件由浏览器读写"这一能力边界上相同；运行时稳定性、内存状态、长任务和多实例行为不同（自托管单进程可保留内存状态，Vercel 多实例 / 冷启动不行）。
7. **信令从"已知问题"提升为部署限制**：写明 Vercel 生产在共享存储完成前为实验性；自托管禁止多副本；同时记录 O6.2 已完成鉴权、浏览器模式日志不再依赖服务端 SSE。
8. **壳缓存路径**写准确：`data/shell-cache/[sdk-]<版本>-<fileKey>/extract/`，`fileKey` 含系统与架构（如 `win-x64`、`osx-arm64`）；或改写为"按版本、平台、架构、flavor 缓存"。

### 9.2 `cloud-prepare-strategy.md`

- §C Linux + Chromium 的"原位 + `Chaya/` + `Chaya启动.sh`"改为：**仅给 NW.js 下载链接，用户手动解压、`chmod +x` 并启动**；标注"设计方案见 O7，未实现"。

### 9.3 `service-modes.md`

- 构建目标一节补一句与 9.1 第 1 条相同的声明，避免与 Next Edge Runtime 混淆。

### 9.4 验收

- 三份文档中不再出现"edge = Edge Runtime"的暗示；Linux 浏览器模式在所有文档中描述一致。
- 部署表能直接回答：自托管要满足什么、哪些浏览器能用、Vercel 当前是否保证连接。

---

## 10. O10 浏览器模式前置条件检测与提示（P1）

### 10.1 现状

非安全上下文或非 Chromium 浏览器打开云端页面时，选目录按钮直接失败或无反应，用户不知道原因。

### 10.2 设计

- 新增纯函数 `detectBrowserModeSupport()`（`lib/browser/fsa.ts`）：返回 `{ ok, reason?: 'insecure-context' | 'no-fsa' | 'mobile' }`，依据 `window.isSecureContext`、`'showDirectoryPicker' in window`、UA。
- 浏览器模式首页 / 选游戏入口：不满足时显示空状态说明并给出办法：
  - `insecure-context`：请用 HTTPS 或 `localhost` 打开。
  - `no-fsa` / `mobile`：请用桌面版 Chrome / Edge 打开。
- 信令实验性提示（O6.4）在同一位置展示。
- 文案进 i18n（zh / en / ja / ko）。

### 10.3 验收

- `http://局域网IP` 打开云端构建：显示 HTTPS 提示，不出现无反应的按钮。
- Firefox / Safari 打开：显示浏览器提示。
- 测试：`detectBrowserModeSupport` 各分支。

---

## 11. 实施记录

| 日期       | 编号    | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | O9      | 完成：`deployment-platforms.md` 重排为四层并补运行前提 / 状态 / 信令部署限制；`cloud-prepare-strategy.md` Linux 改为仅下载链接；`service-modes.md` 补 edge ≠ Edge Runtime 声明                                                                                                                                                                                                                                                            |
| 2026-10-03 | O6.2    | 完成：房间令牌鉴权（`X-Chaya-Link-Token`，服务端存 SHA-256，首个 Web `reset` / `offer` 绑定，`reset` 保留绑定）；去掉 `'default'` 房间；读取 / 应答不建房；房间上限 5000（503）、同一来源最多 20 个房间（429，取 `x-real-ip`）；插件日志里房间号打码；`SECRET_KEYS` 加 `linkToken`。服务端模式沿用原有的管理授权 + launch token 策略。未做：`Allow-Origin` 收窄                                                                           |
| 2026-10-03 | O1      | 完成（1.3 方案）：游戏 DataChannel 打开后补发最近 200 条再批量推送 `log.batch`（未单独设 `log.backlog.request`；单条消息截断、按约 6000 字符分批，与翻译 RPC 一样控制在 16 KiB 内）；Env 写 `CHAYA_LOG_TRANSPORT = 'link'` 且不写 `CHAYA_LOG_URL`；页面 `lib/log/link-log-store.ts` 去重 / 清空 / 切游戏重置；`LogPanel`、WebMCP `chaya_logs_query` / `chaya_logs_clear` 读页面存储；服务器在浏览器模式丢弃上报、读取返回空、SSE 不推条目 |
| 2026-10-03 | O1 / O6 | 行为变化：浏览器模式「连接」会同时刷新插件文件（旧插件不带令牌，否则上线后连不上）。已在用的浏览器模式用户需重新点一次「连接」并重启游戏                                                                                                                                                                                                                                                                                                  |
| 2026-10-03 | O3 / O4 | 完成（下载中心）：`services/downloads` 任务表 + `/api/downloads(/stream)` SSE；`.part` + Range 续传、SHA-256、60 秒空闲超时、可取消（安装阶段除外）；`installShell` 暂存替换 + `recoverOldIfNeeded`（安装 / 启动 / 状态前），顺带修复 Linux 装壳 / 启动；前端 `lib/downloads` 存储 + 右上角 `DownloadCenter`；浏览器 Windows 装壳改为下载中心任务（Web Locks、页面内 IO 串行、选文件按钮承接手势）；MCP `shell_install` 传 `wait: true`   |

---

## 12. 修订

| 日期       | 说明                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | 初稿：O1–O8                                                                                                     |
| 2026-10-03 | 按评审补充：O6 升为 P0（信令鉴权、去缺省房间、部署门禁）；O8 扩展为三层命名；新增 O9 文档修正、O10 前置条件检测 |
