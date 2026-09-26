# Chaya 服务形态与能力边界（需求）

- **日期**：2026-09-22
- **状态**：已确认方向，指导后续开发；细节实现可迭代
- **相关**：
  - `docs/方案定稿-2026-09-19.md`（本机 MVP；**多服务形态以本文为准**，定稿中「仅本机」扩展为本方案）
  - `docs/technical/service-modes.md`（技术设计：模块、门禁、迁移）

---

## 1. 目标

明确三种 **服务形态** 各自能做什么、不能做什么，以及主流程，避免把「本机改盘 / 缓存」误做到纯云端，或把云端能力绑死在本机路径上。

**非目标（本文不做细设计）**

- Vercel 接托管数据库做翻译缓存（**以后再做**，见 §7）
- MTool 兼容
- Toolkit App 打包流水线细节（只约定：App ≈ 包装后的本机服务）

**已采纳（浏览器改盘）**：vercel 站点可在 **Chrome / Edge** 用 File System Access 由**用户浏览器**写入本机游戏目录（服务端仍不碰用户盘）。非 Chromium 提示换浏览器。

---

## 2. 三种服务形态

| 形态         | 代号     | 是什么                                          | 与另外两者关系                           |
| ------------ | -------- | ----------------------------------------------- | ---------------------------------------- |
| 本地运行服务 | `local`  | 本机 Node 跑 Next（`pnpm dev` / 本机部署）      | 当前主路径                               |
| Vercel       | `vercel` | 部署在 Vercel 的 Web + API                      | **纯远程**：不读写 **用户盘**（见 §2.1） |
| App          | `app`    | macOS `.app` / Windows 安装包等 **Toolkit App** | **能力同 `local`**，换数据根与启动方式   |

命名区分：

| 名称            | 指什么                                                           |
| --------------- | ---------------------------------------------------------------- |
| **Toolkit App** | Chaya 本机应用（`CHAYA_SERVICE=app`）                            |
| **游戏 NW 壳**  | 启动 RPG Maker 内容的 NW.js（DiskOps）                           |
| **用户盘**      | 用户设备上的游戏内容根、游戏侧 `chaya/`、本机 toolkit `data/` 等 |

局内 **游戏插件**（`plugins/`）**不是第四种服务**：游戏进程内客户端，经 `CHAYA_API_BASE` 连接上述某一种服务的 API。

### 2.1 「不碰盘」指什么（仅约束 vercel）

| 允许                                                   | 禁止                                            |
| ------------------------------------------------------ | ----------------------------------------------- |
| Vercel 构建产物、函数临时目录、以后托管 DB             | **服务端**读写用户机器上的游戏 `www` / `chaya/` |
| 返回下载 URL；同源代理 NW 包供浏览器解压写入           | **服务端**读写用户本机 toolkit `data/`          |
| 浏览器 FSA（Chrome）在用户授权目录写插件 / 统一壳名    | 在云端 Node 替用户选目录 / 启游戏 NW 壳         |
| 本机用 `CHAYA_SERVICE=vercel` **模拟**云形态（测门禁） |                                                 |

### 2.2 如何区分

判定顺序（必须写死）：

1. `process.env.VERCEL === '1'`（或平台等价）→ **强制 `vercel`**（忽略冲突的 `CHAYA_SERVICE=local|app`）
2. 否则读 `CHAYA_SERVICE`：`vercel` | `app` | `local`（非法值视为未设）
3. 未设 → `local`

| 形态     | 典型来源                                                             |
| -------- | -------------------------------------------------------------------- |
| `vercel` | 平台 `VERCEL=1`；或非平台环境显式 `CHAYA_SERVICE=vercel`（本地模拟） |
| `app`    | Toolkit 打包写入 `CHAYA_SERVICE=app`（且非 `VERCEL=1`）              |
| `local`  | 默认 / `CHAYA_SERVICE=local`                                         |

```text
canUseDisk = (serviceMode !== 'vercel')
```

全仓门禁只用 `canUseDisk`，勿散落 `if (vercel)`。

实现：`lib/service-mode.ts`；UI 读服务端下发字段（优先挂在 `GET /api/status`，该接口无绑定游戏时亦可返回 `ready: false` + mode）。

DiskOps API 失败：**HTTP 501** + `code: DISK_UNAVAILABLE`（能力不具备，非鉴权）。

---

## 3. 能力矩阵

图例：✅ 具备 · ❌ 不具备 · ◐ **目标具备，迁移期未拆盘前 vercel 上不可用（501）** · — 以后

| 能力                                                    | local |           vercel            | app |
| ------------------------------------------------------- | :---: | :-------------------------: | :-: |
| 本机选游戏目录（Node DiskOps）                          |  ✅   |             ❌              | ✅  |
| 浏览器 FSA 选目录并写插件（Chrome / Edge）              |   —   |             ✅              |  —  |
| 浏览器写入 NW 壳（Windows 解压写入；mac 给 zip 自解压） |   —   |             ✅              |  —  |
| 注入 Loader / 插件到游戏目录（服务端）                  |  ✅   |             ❌              | ✅  |
| 启动 / 附着游戏 NW 壳                                   |  ✅   |             ❌              | ✅  |
| 抽取 seed、写游戏侧 `chaya/translate/*`                 |  ✅   |             ❌              | ✅  |
| 本机共享翻译库（toolkit `data/translate-cache` 等）     |  ✅   |             ❌              | ✅  |
| 纯文本翻译 API（in→out，**不写用户盘**）                |  ✅   |              ◐              | ✅  |
| 账号 / 清单 / Toolkit 与插件包下载链接                  |  ✅   |             ✅              | ✅  |
| 托管 DB 翻译缓存                                        |   —   |           —（§7）           |  —  |
| 本机 Ollama                                             |  ✅   |             ❌              | ✅  |
| 公网机翻经本服务出口                                    |  ✅   | ❌ 默认关（另案风控后再开） | ✅  |
| 下发已构建的插件 JS（部署包内产物，非注入游戏）         |  ✅   |             ✅              | ✅  |

**硬规则**

1. `vercel` **服务端**禁止操作用户盘与启游戏 NW 壳；浏览器 FSA 写盘不算服务端 DiskOps。
2. DiskOps（Node `fs` / 原生选目录）仅 `local` / `app`（及有 Node 的插件写游戏目录）。
3. `app` 与 `local` 共用 DiskOps 实现，只换工具根 / 数据目录 / env。
4. 现状 `live-translate` / seed-job / switches 落盘等 **混有用户盘 I/O**；未拆出无盘核心前，vercel 上这些入口一律 `DISK_UNAVAILABLE`，不得静默失败。矩阵中 ◐ 在拆分完成前不算验收通过项。
5. 浏览器 FSA 仅承诺 Chromium；Safari / Firefox 提示不支持。

---

## 4. 分层

| 层            | 含义                                                   | 形态                              |
| ------------- | ------------------------------------------------------ | --------------------------------- |
| **DiskOps**   | 选目录、注入、用户盘读写、启游戏 NW 壳等               | 仅 local / app                    |
| **PureLogic** | 查表、敏感拆分、补丁算法、引擎纯调用、开关类型与默认   | 全形态                            |
| **RemoteAPI** | 无用户盘副作用的 API（无盘翻译、manifest、下载、鉴权） | vercel 必须；local/app 可提供     |
| **UI**        | 控制台页面                                             | local/app 全量；vercel 仅远程能力 |

评审标签：`DiskOps` | `RemoteOnly`。DiskOps 禁止「先做 Vercel 版」。

---

## 5. 主流程

### 5.1 local / app

```text
本机 UI → 选目录 → 绑定 → 注入 → 抽取/补译（本机 cache + 可选 ndjson）
  → 启游戏 NW 壳 → 插件本地命中 → miss 打本机 API（可选再打远端）
  → 译文写回本机用户盘（Vercel 不持有该副本）
```

### 5.2 vercel

```text
站点（Chrome）→ FSA 选本地游戏目录 → 浏览器写插件（+ 统一壳名：Win/Linux `Chaya/` / mac `Chaya.app`）
  → 用户本机双击 / nw.exe 启动（网页不启进程）
  → RemoteAPI（清单、下载、无盘翻译就绪后）
  → 上传翻译若有：一次性，结果随响应；不充当用户游戏 cache
```

服务端仍不读写用户盘。深度改库 / 共享 cache / 一键启动 → 用 app 或 local。

### 5.3 局内插件

```text
已由 local/app 注入后随游戏启动
  → 读本地 cache（有 Node fs）→ miss → CHAYA_API_BASE
```

| 场景                       | 译文持久化               |
| -------------------------- | ------------------------ |
| 插件 → local/app API       | 可靠（服务端或双写）     |
| 有 fs → 仅 Vercel 无盘 API | 可靠（插件本地 append）  |
| 无 fs 且仅 Vercel          | **不可靠**；不作为主路径 |

---

## 6. 翻译与缓存

| 形态        | 缓存                                                            |
| ----------- | --------------------------------------------------------------- |
| local / app | 权威在用户盘：`data/translate-cache` + 游戏 `chaya/translate/*` |
| vercel 当前 | 不落用户盘；无盘 API 无状态（或仅请求内）                       |
| vercel + DB | §7；仍非用户本机 `chaya/`                                       |

- **Ollama**：仅 local / app
- **公网机翻出口**：local / app 可用；vercel 默认关

敏感拆分、限流等策略与形态无关，在 **具备该引擎** 的形态上共用 PureLogic。

---

## 7. 以后：Vercel DB（不做本迭代）

意向：托管 DB 存去重 KV；约 500MB 量级通常够译文表；与本机 cache 分离，同步另开需求。  
本阶段不做：建表、迁移、计费、多租户细规。

---

## 8. 验收标准

**里程碑 A（服务形态门禁）**

1. `serviceMode` / `canUseDisk`；`VERCEL=1` 强制 `vercel`。
2. DiskOps API → **501 `DISK_UNAVAILABLE`**；UI 隐藏或禁用。
3. `GET /api/status`（无游戏绑定时亦可）返回 mode 字段。
4. `app` 无第二套 inject/cache。
5. §7 不作阻塞。

**里程碑 B（vercel 无盘翻译）**

6. 拆出无盘翻译核心后，vercel 上纯文本翻译可用（矩阵 ◐ → ✅）；此前不把现状 `/api/translate` 当 RemoteAPI 验收。

---

## 9. 决策摘要

| 决策            | 结论                       |
| --------------- | -------------------------- |
| 三形态          | `local` / `vercel` / `app` |
| App             | Toolkit，对齐 local        |
| 用户盘          | vercel 不读写              |
| Env             | `VERCEL=1` 强制 vercel     |
| Disk 错误       | 501 + `DISK_UNAVAILABLE`   |
| 无盘翻译        | 目标有；迁移期 501         |
| Vercel 公网机翻 | 默认关                     |
| DB              | 以后                       |

---

## 10. 修订

| 日期       | 说明                                          |
| ---------- | --------------------------------------------- |
| 2026-09-22 | 初稿                                          |
| 2026-09-22 | CR：env、用户盘、壳命名、引擎、落盘、501      |
| 2026-09-22 | 再 CR：矩阵 ◐、验收分里程碑、用语与模拟云形态 |
