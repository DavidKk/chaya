# 翻译优化与专名短文本技术方案

- 日期：2026-10-24
- 状态：一期已落地，与需求对齐；实机验收与二期全库润色未做
- 需求文档：[翻译优化需求](../translation-optimization.md)（UI §3，入口 §5，MVP §6，差距 §7）
- 关联：[调度基线](../translation-scheduling.md)、[管线](translation-pipeline.md)、[缓存设计](translation-cache-optimization.md)、[引擎秩](../../lib/translate/cache-engine-rank.ts)
- 按需定位：秩与写回 §2；候选构建 §3；调度门闩 §4；API §5；UI §6；测试 §7；现状改造清单 §8。

## 1. 架构总览

```text
[列表「优化名称」/ 原文次入口]
            │
            ▼
    mode: optimize (服务端 only)
            │
   ┌────────┴────────┐
   │  ShortEntity    │  extract-items ⋈ 译文 + category/长度
   │  CandidateSet   │
   └────────┬────────┘
            ▼
   L1 apply-terms (无引擎) ──► live:optimize 写回
            ▼
   L2 short-entities 作业 ──► Agent/离线 + category prompt
            │                 assertOptimizeMayDispatch
            ▼
   shared writeMany(秩) + appendGameNdjson
```

全库 `batch-optimize` 与句子 mask 为二期；同一 OptimizeScheduler 队列内专名优先于 polish。

## 2. 引擎标记与守秩

### 2.1 问题

`cacheEngineRank('manual:optimize') === 0`，`writeCachePairs` 在存在更高秩记录时 `rejected.reason=rank`。因此：

- 无法用 `manual:optimize` 升级已有 `live:*`；
- 后续 `live:*` 反而可覆盖秩 0 优化结果。

### 2.2 一期约定

在 `lib/translate/cache-engine-rank.ts` 增加：

```ts
if (engine === 'live:optimize' || engine?.startsWith('live:optimize:')) return 2
// 保持 live:agent* === 2；普通 live:* === 1；manual:optimize 保留 0 仅兼容读
```

- 新写入一律使用 **`live:optimize`**（术语纠偏与 L2 成功写回相同标记，可用 `live:optimize:terms` / `live:optimize:agent` 子标记，秩同为 2）。
- `isMachineTranslationEngine`：对 `live:optimize*` 视为**已优化**，默认不再进入 L2 候选（除非 force）。
- `manual` / `import*` 仍跳过。
- 禁止新代码写入 `manual:optimize`。

### 2.3 双写

1. `writeMany` / `upsert` 到 shared（秩失败 → stats.skipped，仍可尝试本作 ndjson 若产品选择「本作优先可见」——**一期建议：shared 拒绝则整键 skip，避免 shared/本地长期分叉**；记入 `skippedRank`）。
2. 接受则 `appendGameNdjson`。
3. 控制码校验失败：不写。

## 3. 候选构建（ShortEntityFilter）

### 3.1 数据源

```ts
// 伪代码
const items = loadExtractedItems(contentRoot) // meta.category
const zhBySrc = indexGameTranslations(contentRoot) // seed+ndjson overlay
```

### 3.2 入选

```ts
const NAME_CATS = new Set(['actor','item','weapon','armor','skill','enemy','state','map'])
// actor_nickname：单行且短时可入选
const CHOICE = 'choice'
function isShortEntity(item): boolean {
  const cat = item.meta.category
  if (cat === 'dialogue' || cat === 'story') return false
  if (cat.endsWith('_desc') || cat === 'actor_profile') return false
  if (!(NAME_CATS.has(cat) || cat === 'choice' || cat === 'actor_nickname')) return false
  const core = cat === 'choice' ? peelChoiceMetaShell(item.src).core : item.src
  const logic = /* 去控制码后的可见长度 */
  return logic.length > 0 && logic.length <= SHORT_ENTITY_MAX /* 默认 40 */
}
```

与 UI「名称」筛选对齐；选项单独可选纳入同一次作业（API `includeChoices?: boolean`，列表在性质=选项或用户勾选时传 true）。

### 3.3 Scan 输出

```ts
{
  scope: 'short-entities',
  totalCandidates: number,
  byCategory: Record<string, number>,
  termFixable: number,
  alreadyOptimized: number,
  skippedManual: number,
}
```

## 4. 调度与非阻塞

### 4.1 Live 接线（必须）

- `liveTranslateTexts` 最外层：`return trackLiveTranslateRequest(() => …)`。
- 默认 `/api/translate` texts、`mode: realtime` 走同一路径即已覆盖；插件经服务端代理的翻译同样覆盖。
- 插件**进程内** google/bing/ollama：一期不计入服务端计数 → UI 在 `getGamePresence().online && 插件 job 运行中` 时警告；`short-entities` 可配置 `requireIdle: true`（默认 true）。

### 4.2 门闩

```ts
assertOptimizeMayDispatch('terms') // 永远 ok
assertOptimizeMayDispatch('short-entities' | 'polish')
// !ok → { pausedReason: 'live' | 'cooldown' | 'busy' }，调用方停派发，不 busy-wait
```

`batchOptimizeTranslations` / 新 `runShortEntityOptimization` **开头与每批边界**检查；失败则返回部分进度 + pausedReason。

### 4.3 队列

- 进程内单一优化队列；`short-entities` 优先于 `batch-optimize`。
- 优化请求 `withEngineCapacity` identity 前缀 `optimize:`，抢占时不再泵优化 waiter（实现可先「停派发 + 低 concurrencyLimit=1」）。

### 4.4 跨进程

一期不做插件→服务端 live 心跳。缓解：

- 默认引擎：仅 L1 或用户选定的 Agent；文案：「补译或游玩时请暂停优化名称」。
- 检测插件 seed job 活跃（若有可读状态）→ `pausedReason: 'plugin-job'` 可选。

## 5. API（`mode: optimize`）

| action           | 行为                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `scan`           | `scope: 'short-entities' \| 'all'`；short 走 §3                               |
| `apply-terms`    | 仅术语；写 `live:optimize:terms`；无引擎                                      |
| `short-entities` | L1（若未先 apply）+ L2；`limit`；`includeChoices`；强制门闩；可 `signal` 取消 |
| `batch-optimize` | 二期；一期可保留但 UI 不暴露或标注实验                                        |
| `idle-status`    | 调试/UI 徽章；**不能**替代服务端门闩                                          |

错误码：沿用 `OPTIMIZE_ACTION`；秩跳过进 stats 不进硬错误。

## 6. UI 接线

| 面             | 文件（预期）                     | 行为                                                                                                    |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 列表主按钮     | `TranslateListContent` / footer  | `natureFilter===name'`（或选项）时强调「优化名称」；调 scan → 确认 → short-entities；轮询或事件显示进度 |
| 原文次按钮     | `TranslateRunPane` / seed 任务条 | 同 API；次要样式                                                                                        |
| 翻译库分段优化 | `CacheOptimizeContent`           | **不改语义**；勿复用「优化名称」文案                                                                    |
| i18n           | `translate.*`                    | `optimizeNames`、`optimizeNamesRunning`、`optimizeNamesPausedLive` 等                                   |

局内 GameEdit 翻译列表若复用同一组件，按钮一并出现；无盘 Cloud 态隐藏或 disabled + 说明。

## 7. 测试矩阵

1. **候选**：含 item/actor，不含长 dialogue；choice 剥壳。
2. **秩**：manual 跳过；live 劣译可被 live:optimize 替换；替换后普通 live 写入因秩失败或需更高权威。
3. **门闩**：track 中 short-entities 不新派发；结束后可继续。
4. **apply-terms**：不调用 `withEngineCapacity`；耗时与记录数近线性、无引擎等待。
5. **双写**：shared 接受则 ndjson 一致；shared rank 拒绝则键跳过且不造成「仅本地优化」。
6. **UI**：名称筛选下按钮可见；与翻译库「优化」文案不同。

## 8. 现状改造清单（开工顺序）

1. `cache-engine-rank.ts`：`live:optimize*` → 2；单测。
2. `optimize-service.ts`：ShortEntityFilter + scan scope；apply/short 写新引擎标记；去掉对新写入 `manual:optimize` 的依赖。
3. `live-translate.ts`：包裹 `trackLiveTranslateRequest`。
4. `short-entities` runner + route action；batch 边界门闩。
5. 列表/原文 UI + i18n。
6. 测试：optimization.spec / optimize-upsert / 组件冒烟。

## 9. 非目标（一期）

- SQLite schema 迁移、全库闲时自动 polish、句子 mask 全路径、插件 live 心跳、engines 页入口、新 Tab。
