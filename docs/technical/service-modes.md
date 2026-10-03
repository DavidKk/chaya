# 服务形态技术设计

> 状态：设计稿（随实现修订）  
> 需求真源：[docs/requirements-service-modes.md](../requirements-service-modes.md)  
> 适用范围：Next 服务端 / API、本机 DiskOps、局内插件连 API；不含 UI 视觉（`chaya-ui-style-guide.md`）  
> 部署方式 × 操作系统总览（含壳安装、浏览器模式数据、共用组件）：[deployment-platforms.md](deployment-platforms.md)

---

## 1. 目的与用语

落地三形态判定、Route 门禁、渐进迁移。

| 用语            | 含义                                              |
| --------------- | ------------------------------------------------- |
| **用户盘**      | 游戏内容根、游戏侧 `chaya/`、本机 toolkit `data/` |
| **Toolkit App** | `CHAYA_SERVICE=app`                               |
| **游戏 NW 壳**  | 启动 RM 的 NW.js（DiskOps）                       |

不实现 Vercel DB（需求 §7）；预留 `CacheAdapter`。

---

## 2. 架构总览

```text
UI ──HTTP──► app/api
               │
               ├─ DiskOps + assertCanUseDisk() → 501 DISK_UNAVAILABLE
               │     pick / inject / 游戏NW壳 / 用户盘 cache …
               │
               └─ Remote + PureLogic（无用户盘副作用）
                     translateTextsCore（拆分后）/ manifest / 下载 …
```

插件：本地 cache（若有 fs）→ miss → `CHAYA_API_BASE`；仅 Vercel 且无 fs 不保证持久化。

---

## 3. `lib/service-mode.ts`

### 3.1 判定（与需求一致）

```ts
export type ServiceMode = 'local' | 'vercel' | 'app'

export function getServiceMode(): ServiceMode {
  if (process.env.VERCEL === '1') return 'vercel'
  const v = process.env.CHAYA_SERVICE?.trim().toLowerCase()
  if (v === 'vercel' || v === 'app' || v === 'local') return v
  return 'local'
}

export function canUseDisk(mode = getServiceMode()): boolean {
  return mode !== 'vercel'
}
```

| 条件                               | 结果                               |
| ---------------------------------- | ---------------------------------- |
| `VERCEL=1`（任意 `CHAYA_SERVICE`） | 强制 `vercel`                      |
| 非平台 + `CHAYA_SERVICE=vercel`    | `vercel`（**本地模拟云**，测 501） |
| 非平台 + `app` / `local`           | 对应形态                           |
| 未设 / 非法值                      | `local`                            |

### 3.2 暴露给 UI

`GET /api/status` **无绑定游戏时已可返回**（`ready: false`）。首迭代在该响应增加：

```ts
serviceMode: ServiceMode
canUseDisk: boolean
```

不另建 `/api/service-mode`，除非未来 status 被改成强依赖绑定。

### 3.3 门禁

```ts
assertCanUseDisk() // → HTTP 501, code DISK_UNAVAILABLE
```

两层并用：

- **构建期剔除**：整条都是 DiskOps 的路由命名为 `route.server.ts`，edge 构建按 `pageExtensions` 不收录（见 §8）。
- **运行时 501**：混合路由（如 `status` 的 `GET` 可上云、`PUT` 写盘）留在 `route.ts`，写盘分支仍走 `requireDisk()`；`.server` 路由也保留 `requireDisk()`，供 dev 切到 edge 时返回 501。

---

## 4. 模块归类

### 4.1 DiskOps

| 代码                                                     | 说明                               |
| -------------------------------------------------------- | ---------------------------------- |
| `services/game/picker.ts`                                | 选目录                             |
| `services/game/plugins.ts`                               | **注入/清除到游戏目录**            |
| `services/game/shell.ts` / `finder.ts` / `nw-package.ts` | 游戏 NW 壳                         |
| `services/game/config.ts` / `binding.ts`                 | 本机绑定配置                       |
| `lib/game/content-files.ts`                              | 游戏内容根 fs                      |
| `services/translate/shared-cache/`                       | toolkit data sqlite（Drizzle）     |
| `import-cache` / `seed-job` / append ndjson              | 写用户盘                           |
| 读/写游戏侧 switches 文件                                | I/O 属 Disk；类型/默认属 PureLogic |

`constants/paths.ts`：可被任意形态 import；**写入用户盘的调用点** 才算 DiskOps。

### 4.2 DiskOps Route 清单（须 `assertCanUseDisk`）

| Route                                     | 说明                                     |
| ----------------------------------------- | ---------------------------------------- |
| `POST /api/pick`                          | 选目录                                   |
| `POST` / `DELETE /api/launch`             | 启停游戏                                 |
| `POST` / `DELETE /api/plugins`            | 注入 / 清除（写游戏目录）                |
| `POST` / `DELETE /api/shell`              | 游戏 NW 壳                               |
| `POST /api/reveal`                        | 打开本机路径                             |
| `PUT` / `DELETE /api/status`              | 改绑定库等（写本机配置）                 |
| `POST /api/extract`                       | 抽取写 seed                              |
| `GET` / `PUT /api/window`                 | 读/改游戏 `package.json`                 |
| `GET` / `POST /api/translate-cache`       | 本机共享库浏览/导入                      |
| `GET /api/game-edit/catalog`              | 读游戏 data + 本地 lookup                |
| `POST /api/runtime/heartbeat`             | 若写回游戏库/配置则属 Disk（实现时核对） |
| `POST /api/logs`（写本机日志文件时）      | 写 toolkit 日志目录则属 Disk             |
| `POST /api/translate` **迁移期全部 mode** | 见 §4.4（未拆前一律 assert）             |

实现时以仓库 `app/api/**` 再扫一眼补漏。

### 4.3 可上云（非用户盘）— Remote 友好

| Route / 能力                                   | 说明                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/status`                              | 带 `serviceMode`；无绑定也可                                            |
| `GET /api/plugins/:name`                       | 读 **部署包内** `plugins/dist`（含 Loader）；vercel 可供浏览器 FSA 写入 |
| `GET /api/remote/nw-meta`                      | NW 版本元信息 + 官方 CDN 直链（各端自行下载，本站不代理包）             |
| 静态/对象存储上的 Toolkit、插件包 URL          | RemoteAPI                                                               |
| 拆分后的无盘 `POST /api/translate`（仅 texts） | §4.4                                                                    |

### 4.4 PureLogic

`lib/translate/*`、`lib/game/content-paths.ts`（仅相对路径约定）、`sensitive-text`、`text-classify`、engine 开关 **类型与默认**、局内 `plugins/src/translator/patch/*`（IIFE，不进 Server 业务路径）。

### 4.5 `/api/translate` 迁移（写死，不二选一）

**现状**：`live` / `seed` / `job` / `switches` / `progress` 均可能触用户盘或绑定根。

**迁移期（adapter 未落地）**

| 形态        | 行为                                                          |
| ----------- | ------------------------------------------------------------- |
| local / app | 维持现状                                                      |
| vercel      | **整个** `POST /api/translate` → `assertCanUseDisk` → **501** |

**拆分后（目标）**

1. `translateTextsCore(texts, deps)` — 引擎 + PureLogic
2. local/app：`DiskCacheAdapter` 包装后走原 `POST /api/translate` 的 texts 路径
3. vercel：同一 `POST /api/translate`，**仅允许** `{ text|texts }` 且 **不挂** Disk 适配器；`seed` / `job` / `switches` 写盘 mode 仍 501
4. 以后 `DbCacheAdapter` 可挂在 vercel texts 路径

不另开第二套「无盘专用 path」，避免双路由分叉；用 **mode + 形态** 收窄。

**引擎**

|              | local | app | vercel |
| ------------ | :---: | :-: | :----: |
| Ollama       |  ✅   | ✅  |   ❌   |
| 公网机翻出口 |  ✅   | ✅  | 默认关 |

---

## 5. App vs local

|                 | local            | Toolkit App                                                                       |
| --------------- | ---------------- | --------------------------------------------------------------------------------- |
| `CHAYA_SERVICE` | 默认/`local`     | `app`                                                                             |
| 工具根          | 仓库             | 安装/resources                                                                    |
| `DATA_DIR`      | `<repo>/data`    | 平台约定（macOS Application Support / Windows `%AppData%` / Linux XDG，实现时定） |
| UI              | 浏览器或 webview | webview 为主                                                                      |

禁止复制 inject/cache；只换 `toolkitRoot`。代码层不按 `app` 分支，App 与 local 共用 server 构建（§8）。

---

## 6. 插件

|                   |                           |
| ----------------- | ------------------------- |
| `CHAYA_API_BASE`  | local / app / vercel 原点 |
| `tryNodeFsPath()` | 有则读写游戏侧 cache      |

注入只来自 DiskOps（local/app）或 **浏览器 FSA**（vercel + Chrome）；vercel 服务端只提供 **部署包内插件下载**（`GET /api/plugins/:name`）与 NW 代理。

---

## 7. UI 门禁

- `canUseDisk === false`：隐藏选目录、注入、开游戏、本机 cache 写、seed 补译任务等。
- vercel：下载、文档；无盘翻译入口仅在里程碑 B 后打开。
- `/`：edge 为官方介绍页（`MarketingHome`）；local / app 重定向 `/game`。
- mode 只信 status（等）服务端字段。

---

## 8. 构建

> **edge 是项目内部「云端无盘构建目标」的名称，不等同于 Next.js Edge Runtime**：edge 构建只在构建时剔除 `*.server` / `*.dev` 路由，云端 API 仍全部运行在 Node.js runtime（`export const runtime = 'nodejs'`）。三层概念（构建目标 / 服务形态 / 执行运行时）见 [deployment-platforms.md](deployment-platforms.md) §2。

URL 在所有形态下相同（无 `/app`、`/edge` 前缀）。构建目标只有两个：**edge** 与 **server**；App 是 server 产物的打包变体，不是第三套路由。

| 命令                        | 构建目标 | 收录路由                    | 说明                                                                                                                   |
| --------------------------- | -------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                  | dev      | 全部 + `*.server` + `*.dev` | 右上角 dev 切换器（Server / Edge）热切换，整个 dev 进程生效、整页刷新，无需重启                                        |
| `pnpm build` → `pnpm start` | server   | 全部 + `*.server`           | 本机 Node 服务                                                                                                         |
| `pnpm build:app` / `dist:*` | server   | 同上                        | 同一产物 + `output: 'standalone'` + Electron；`CHAYA_DATA_DIR` 等由 Electron 运行时注入，不进构建判断                  |
| `pnpm build:edge` / Vercel  | edge     | 不含 `*.server` / `*.dev`   | `VERCEL=1` 自动视为 edge；自托管须在**构建时**设 `CHAYA_TARGET=edge` 再 `next start`（前提见 deployment-platforms §3） |
| `pnpm check:edge`           | edge     | —                           | edge 构建后校验 manifest 中没有 `*.server` / `*.dev` 路由                                                              |

实现要点：

- `next.config.ts` 按阶段算出目标，设置 `pageExtensions` 并注入 `NEXT_PUBLIC_CHAYA_TARGET`（`dev` / `edge` / `server`）。
- `lib/service-mode/target.ts` 的 `BUILD_TARGET` 在构建产物里是常量：edge 构建内 `getServiceMode()` 恒为 `vercel`，dev 专用代码（`DevTargetSwitch`、`/api/dev/target`）在生产包中被摇掉。
- dev 下 `getServiceMode()` 读开关：edge → `vercel`；server → `CHAYA_SERVICE=app` 时 `app`，否则 `local`。`pnpm dev:edge`（`CHAYA_SERVICE=vercel`）只是以 edge 起步，仍可切换。
- ESLint `no-restricted-imports`：非 `*.server` / `*.dev` 文件不得引用这两类模块，也不得引用 `app/api/mcp/_tools`（共享常量放 `lib/integration`）。
- 新增「整条都要本机磁盘」的路由时命名为 `route.server.ts`；Electron App 专属能力放 `electron/` 或 preload 暴露的标记，不新增构建目标。

CI 以 server 全量为准；改动路由归属时跑 `pnpm check:edge`。

---

## 9. 迁移步骤（对齐需求里程碑）

**里程碑 A**

1. `lib/service-mode.ts` + status 字段
2. DiskOps 清单 `assertCanUseDisk`
3. UI 按 `canUseDisk` 收敛

**里程碑 B**

4. 拆 `translateTextsCore` + Disk 适配器；vercel 打开 texts-only 无盘翻译
5. App 只配环境（可与 A 并行）

**以后**

6. `DbCacheAdapter` + 同步协议

---

## 10. 测试

| 用例                               | 期望                           |
| ---------------------------------- | ------------------------------ |
| 默认                               | `local`，`canUseDisk`          |
| `VERCEL=1`                         | `vercel`，`!canUseDisk`        |
| `VERCEL=1` + `CHAYA_SERVICE=local` | 仍 `vercel`                    |
| 非平台 + `CHAYA_SERVICE=vercel`    | `vercel`（模拟），Disk API 501 |
| 非平台 + `app`                     | `app`，`canUseDisk`            |
| 非法 `CHAYA_SERVICE`               | 回落 `local`                   |
| status 无绑定                      | 仍含 `serviceMode`             |
| PureLogic                          | 不碰真实用户盘                 |

---

## 11. 需求对照

| 需求                   | 本文      |
| ---------------------- | --------- |
| §2 形态 / env / 用户盘 | §1、§3    |
| §3 矩阵 ◐              | §4.5 迁移 |
| §8 里程碑 A/B          | §9        |
| §7 DB                  | §1、§9.6  |

---

## 12. 修订

| 日期       | 说明                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| 2026-09-22 | 初稿                                                                                             |
| 2026-09-22 | CR：强制 vercel、501、清单、迁移、方案 A                                                         |
| 2026-09-22 | 再 CR：修正 `content-files` 路径、补全 Route、translate 单一路径、里程碑、模拟云、插件 GET 归属  |
| 2026-10-03 | 构建期剔除落地：`route.server.ts` + `pageExtensions`；edge / server 两个构建目标；dev 热切换开关 |
| 2026-10-03 | 声明 edge 构建目标 ≠ Next Edge Runtime；补自托管构建时设目标；dev 切换器位置更正为右上角         |
