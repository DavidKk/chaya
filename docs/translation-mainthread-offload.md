# 翻译主线程卸载与多 Tab 共享等待

- **日期**：2026-10-24
- **状态**：现行（P0–P2 主路径已落地；H6 防回归审计可选）
- **目标**：轮询与多 Tab 打开不堵 Next.js 主线程；重活进后台单飞任务；多 Tab 共享同一次等待。
- **适用范围**：本机 Local / App 控制台的 seed 补译、**译文列表 `/translate/list`（`mode: extract-items`）**、sources 作业、共享翻译缓存打开路径；不覆盖 RGSS 写回本体（仍可保持显式同步，另案）。
- **关联**：
  - 调度基线：[translation-scheduling.md](translation-scheduling.md) §13–14
  - 缓存：[translation-cache-optimization.md](translation-cache-optimization.md)
  - 管线：[technical/translation-pipeline.md](technical/translation-pipeline.md)
  - 实现入口：`services/translate/seed-job.ts`、`sources-job.ts`、`scheduler/seed-prepare.ts`、`scheduler/seed-inventory.ts`、`shared-cache/migrate-bg.ts`、`services/extract/list-extract-prepare.ts`、`services/extract/lib/rgss-sources-index.ts`、`app/api/translate`（`extract-items`）
- **按需定位**：热路径与已修项 §2；方案 §3（含 §3.2 列表）；分期与验收 §4–5。

## 1. 背景与原则

### 1.1 已复现问题

打开 `/translate/seed` 或多 Tab 轮询时，Next 主线程曾被同步重活占满（采样可见持续 `RegExp` / 同步库存），导致 `/api/translate`、`/api/status` 与页面同时超时。根因包括：进度轮询误触发 `ensureLoop` + `readSeedInventory`；`progressStamp` 误含 shared SQLite WAL；库存路径上递归 `lookupCachedTranslation`。

**补充（2026-10-24）**：打开 `/translate/list` 同样可冻站。页面挂载即 `POST mode: extract-items`；RGSS 局走同步 `loadRgssTranslationItems`（`loadRgssItems` 全 Data + `loadGameTranslateLookup` + Scripts），与 seed 库存共享同一类主线程成本。原则（页面打开 ≠ 同步全 Data）已覆盖，但初稿未单列该入口，见 H7 / §3.5。

### 1.2 本波已落地（勿回退）

| 项                | 约定                                                        |
| ----------------- | ----------------------------------------------------------- |
| Seed 进度轮询     | 只读内存/磁盘快照；不 inventory、不 `ensureLoop`            |
| 孤儿 `running`    | 进程弹起后降为 `paused`；须显式继续                         |
| HMR handoff       | 不自动 resume；提示继续                                     |
| `progressStamp`   | 仅本局 `seed` + `cache.ndjson` 文件身份；不含 shared WAL    |
| 库存命中          | 精确/归一化 local + numeric；模糊匹配仅 cache-lane worker   |
| Cache worker 缺失 | 软失败，引擎继续；污日志可 scrub；须 `pnpm build:translate` |
| 用户文案          | 不向用户提示「进度可能过期」；开始翻译时再重算即可          |

### 1.3 设计原则（硬）

1. **Poll / 首屏列表 = 不堵主线程**：`mode: progress`、sources `status`、**以及列表首次 `extract-items`** 禁止在 HTTP 处理函数内同步跑完整 RGSS Data / 全量索引迁移。
2. **重活 = 后台单飞**：同一 key 全进程只跑一份；多 Tab 共用同一个 in-flight Promise / job。
3. **显式动作或可取消的准备**：开始/继续翻译、列表冷加载、首次需要可写 shared 时排队；UI 显示「准备中 / 加载列表…」，其它 API 仍可用。
4. **可观测**：后台任务有状态字段（如 `preparing` / `cacheMigrating` / `listPreparing`），失败可重试且不堵死其它 API。

### 1.4 多 Tab 共享等待

```text
tab A ──┐
tab B ──┼── await inFlight.get(key) ── 唯一后台任务 ── resolve ── 各 tab 同快照
tab C ──┘
```

建议 key：

| key                           | 用途                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `seed-prepare:${contentRoot}` | Seed 库存 +（可选）RGSS sources 索引                                                                                     |
| `list-extract:${contentRoot}` | 列表 `extract-items`（RGSS items / MV extract+locales）；与 seed-prepare **共享** RGSS Data 解析结果时合并为同一底层任务 |
| `shared-migrate:${dbPath}`    | scrub + sentence index 迁移                                                                                              |
| `sources-run:${jobId}`        | Sources 作业运行（仅显式 start，非 poll）                                                                                |

## 2. 仍存在的高 CPU / 卡死风险

| ID  | 路径                                                             | 触发                              | 风险                                                                                                | 优先级                             |
| --- | ---------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| H1  | Sources `getSourcesJobStatus` → `ensureLoop`                     | sources 状态轮询 + 磁盘 `running` | 与 seed 旧病相同，可再次冻站                                                                        | P0                                 |
| H2  | `startSeedJob` 与 `createSeedFillSession` 双重库存               | 点开始/继续                       | 请求线程双倍扫 seed/RGSS                                                                            | P1                                 |
| H3  | `filterRgssSeedKeys` → `loadRgssItems`                           | 每次库存                          | 同步解析整棵 Data                                                                                   | P1                                 |
| H7  | `/translate/list` → `extract-items` → `loadRgssTranslationItems` | **打开列表页**                    | HTTP 内同步全 Data + lookup + Scripts；多 Tab 叠加；整站 API 超时（2026-10-24 复现，主线程 RegExp） | **P0**（与 H1 同级：首屏即可冻站） |
| H4  | 首次 `openSharedCache`：`scrubDirty`                             | 缺 `scrub_identical_v1`           | 全表扫删，大库秒～分钟                                                                              | P2                                 |
| H5  | 首次 `openSharedCache`：sentence v10 重建                        | 缺 `sentence_index_v10_*`         | 往往最重                                                                                            | P2                                 |
| H6  | 同步 `scanSeed` / `inventoryOnly=false`                          | 遗留 API / 非 nonBlocking         | 主线程 plan 全 corpus                                                                               | P2（防回归）                       |

实测参考（Rei）：`loadRgssItems` ~2s；seed 库存 ~3s。列表页冷开若叠上 lookup/脚本提取，可把 Next 打满直至无响应。Seed 轮询误触发已修；**列表仍为同步请求路径缺口**。

## 3. 方案

### 3.1 P0 — Sources 与 Seed 对齐

- `getSourcesJobStatus`（及同类 status/export 快照）：**禁止**在 `disk.running && !rt.running` 时 `ensureLoop`。
- 孤儿 running → paused（或等价「需继续」态）；仅显式 start/resume API 调用 `ensureLoop`。
- 验收：多 Tab 刷 sources 状态不抬 CPU、API 不超时；中断后点继续才恢复跑批。

### 3.2 P0 — 译文列表 `/translate/list`（`extract-items`）

**覆盖结论**：本需求**应当覆盖**该页；初稿仅写 seed/sources/shared，属范围缺口，以本节补全。

1. **禁止**在 `POST extract-items` 的请求线程内同步执行完整 `loadRgssTranslationItems` / 等价全量提取（MV 路径若同样重，一并纳入）。
2. **后台单飞** `prepareListExtract(contentRoot, langOpts?)`（key：`list-extract:${contentRoot}`）：
   - 与 `seed-prepare` **共用** RGSS Data 解析 / sources 索引层，避免列表与开始翻译各扫一遍。
   - 多 Tab 打开 list 只跑一份；结果可短时缓存（按 Data signature + seed/cache stamp）。
3. **API 形态**（择一，开工钉死）：
   - **推荐**：首次返回 `{ preparing: true, jobId? }`，客户端短轮询轻量 `extract-items-status` / 复用 progress 风格快照，直至 `{ items }`；或
   - SSE / 同连接 chunk（实现成本更高，非必须）。
4. **UI**：列表骨架 / 「加载原文…」；加载期间 seed/其它页 API 必须仍可用。
5. **验收**：打开 list 时 `/api/status` 与 `mode:progress` 不超时；≥3 Tab 同时开 list 只触发一次 Data 解析。

### 3.3 P1 — Seed 库存去重、后台准备、多 Tab 单飞

1. **去重**：`createSeedFillSession` / scheduled session 接受已算好的 inventory（progress + pending）；构造时不再 `readSeedInventory`。
2. **后台任务** `prepareSeedInventory(contentRoot)`：
   - `inFlight` 单飞；首个请求触发，其余 await 同一 Promise。
   - 完成后写入 job 快照（progress、`progressStamp`、可序列化的 pending 或等价游标）。
3. **Start / Continue 流程**：
   - stamp 新鲜且已有可用快照 → 直接 `ensureLoop`。
   - 否则进入 `preparing`（快照字段或等价），后台 prepare；多 Tab 共享等待；ready 后开跑（服务端自动接续或客户端再点一次，实现时二选一，默认服务端接续以免双点）。
4. **API**：Start 应快速返回（`preparing` / `running`），不得在 HTTP 处理函数内同步跑完整库存。
5. **RGSS sources 索引**（同批或紧随）：
   - 按 Data 目录 signature 落盘（建议 `chaya/translate/rgss-sources.index.json` 或同等路径，落点实现时定）。
   - signature 未变则 `filterRgssSeedKeys` 走索引；变则在 `prepareSeedInventory` 内重建，不堵 poll。

### 3.4 P2 — Shared cache 首开迁移后台化

1. **热路径 open**：只打开 DB、读 meta；若缺 scrub / sentence 迁移标记 → 置 `cacheMigrating`，**不**在 open 内跑全表。
2. **后台** `ensureSharedCacheReady(dbPath)`：单飞；执行 scrub + 缺的 index 迁移；写 meta；完成后清除 migrating。
3. **读写策略**：
   - 迁移中：只读 lookup 尽量可用；写路径排队或短拒（避免半迁移写坏索引），具体策略实现时选更安全的一种并写测试。
   - 优先让现有 **cache-lane worker** 承担迁移执行，主线程只 await ready 标志。
4. **多 Tab**：所有需要 ready 的路径 await 同一 `ensureSharedCacheReady` Promise。

### 3.5 明确不做（本需求）

- 不向用户展示「进度可能过期」类文案；不恢复「刷新进度」按钮为必经路径。
- 不把 stamp 漂移的自动全量重扫加回 poll。
- RGSS 写回/预览不强制本波后台化（可另开需求）。
- 不在本文扩大翻译调度算法（仍以 [translation-scheduling.md](translation-scheduling.md) 为准）。

## 4. 分期与开工顺序

| 步     | 内容                                                              | 依赖                                   |
| ------ | ----------------------------------------------------------------- | -------------------------------------- |
| 1      | P0 Sources poll 去 `ensureLoop` + 孤儿降级                        | 无                                     |
| **1b** | **P0 列表 `extract-items` 后台单飞 + 快返回 / 状态轮询**          | 可与 1 并行；与步 3 共享 RGSS 索引更佳 |
| 2      | P1 Start 库存去重 + `prepareSeedInventory` 单飞 + Start 快返回    | 无                                     |
| 3      | P1 RGSS sources 索引落盘（**seed-prepare 与 list-extract 共用**） | 步 1b / 2 的 prepare 管道              |
| 4      | P2 Shared 迁移后台 + 单飞 + migrating 态                          | 可与步 2 并行设计，落地宜在步 2 后     |
| 5      | 防回归：审计并切断同步 `scanSeed` 热入口                          | 步 4 后或并行                          |

**默认开工顺序：1 → 1b → 2 → 3 → 4 → 5。**（列表冻站与 Sources 同属 P0，1b 紧跟或并行。）

## 5. 验收

### 5.1 功能

- [x] Sources：多 Tab 轮询 status 不启动作业；显式继续才跑（`resumeSourcesJob`）。
- [x] **List：打开 `/translate/list` 不堵死其它 API；多 Tab 只跑一份 extract**（`list-extract-prepare` + `preparing` 轮询）。
- [x] Seed：多 Tab 同时点开始，本局库存只执行一次（`prepareSeedInventory` 单飞）。
- [x] Start/Continue HTTP 在库存未就绪时快速返回 preparing，不卡死其它 API。
- [x] 二次 Start / 二次打开 list（Data signature 未变）走 `rgss-sources.index.json` / list ready 缓存。
- [x] Shared open 不跑 scrub/v10；`scheduleSharedCacheHeavyMigrate` 后台单飞（Jest 同步）。
- [x] Cache worker 缺失时仍可引擎补译；污日志 scrub。

### 5.2 性能（本机大作参考）

- [ ] `/api/translate` `mode:progress` 常态 &lt; 50ms（无 preparing 竞争时）— 需本机大作复测。
- [ ] **打开 list 加载期间** `/api/status` 与 `mode:progress` 不出现数秒级超时 — 需本机复测。
- [ ] 故意并行打开 ≥3 个 `/translate/seed` 或 `/translate/list` Tab，CPU 不为 N 倍 Data 解析 — 需本机复测。

### 5.3 测试

- [x] Sources / seed-job：poll 不 inventory；stamp 不含 WAL（既有用例）。
- [x] Seed prepare 单飞：并发两次 prepare 只跑一次 inventory（`seed-prepare.spec.ts`）。
- [x] List extract 单飞：request + poll 共享 flight（`list-extract-prepare.spec.ts`）。
- [x] Shared migrate 单飞：并发 `scheduleSharedCacheHeavyMigrate` 同一 Promise（`migrate-bg.spec.ts`；Jest 默认同步路径另测）。
- [x] 回归：seed-job poll 仍不 inventory；sources orphan → paused。

## 6. 实现落点（预留，开工时再钉）

| 职责                      | 预期落点                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Seed 准备单飞             | `services/translate/`（seed-job 旁或 `scheduler/seed-prepare.ts`）                                                                |
| List extract 单飞         | `services/extract/list-extract-prepare.ts`；RGSS 走 `native/bin/chaya-rgss-extract-worker.mjs`（file IPC，主线程不 parse 大数组） |
| Sources 快照语义          | `services/translate/sources-job.ts` + `resumeSourcesJob`                                                                          |
| RGSS sources / items 缓存 | `rgss-sources-index.ts` → 局内 `chaya/translate/rgss-sources.index.json`                                                          |
| Shared 迁移单飞           | `shared-cache/migrate-bg.ts`（open 只 schema；scrub/v10 后台；Jest 同步）                                                         |
| 状态字段                  | `preparing`（seed / extract-items）                                                                                               |

路径以开工 PR 为准；超 600–800 行按结构约定拆文件。

## 7. 修订记录

| 日期       | 说明                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-24 | 初稿：记录已修项、剩余热路径、P0–P2 方案与多 Tab 单飞约定；未开工。                                                                                                                 |
| 2026-10-24 | 补 H7 / §3.2：`/translate/list`→`extract-items`→`loadRgssTranslationItems` 纳入范围与 P0；开工顺序加 1b。                                                                           |
| 2026-10-24 | 落地：Sources orphan/resume；list extract 单飞；seed prepare；RGSS sources 磁盘索引；shared migrate-bg。状态改为现行。                                                              |
| 2026-10-24 | list RGSS 改 worker + 文件 IPC；修 Scripts `DRAW_RE` ReDoS；跳过 FileSystem/Animations/Tilesets 非文案 Data。本机 Rei：prepare 期间 status/progress &lt; 100ms，约 3s 出 1.7 万条。 |
| 2026-10-25 | jobs 薄层接入 sources orphan；seed runLoop 禁无 bundle 同步库存；seed-prepare / list-extract / migrate-bg 单飞测试；downloads 标明不进 jobs。                                       |
