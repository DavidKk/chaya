# 游戏 Agent 分层任务执行技术方案

> 状态：实施中（P0 度量已接入；P1 插件 batch 路径与 `lib/game-agent/jobs` 已落地，服务端 Host 未接）
> 日期：2026-10-14；文档复核：2026-10-15；开工：2026-10-15
> 关联：[`game-agent.md`](./game-agent.md)（§6.3 历史控制、§6.4 语义判断）、[`game-assistance.md`](./game-assistance.md)（托管循环）、[`../agent-gameplay-trace.md`](../agent-gameplay-trace.md)（操作轨迹）
> 现有实现：`lib/game-agent/runtime/run-turn.ts`、`lib/game-agent/interaction-target.ts`、`plugins/src/agent/interact.ts`、`plugins/src/agent/runtime/host.ts`

## 1. 背景

旅伴与托管目前用同一个模型工具循环（`runAgentTurn`）完成一次请求：观察 → 模型决定 → 调工具 → 回读 → 模型再决定，直到模型回复正文。跨轮次不带历史（按需 `chaya_agent_recall`），但**一轮之内**的工具往返持续累积，并会改写被新观察取代的旧状态；超过 20000 字符后才从最早的工具往返整条丢弃。该阈值只统计消息正文，不包含工具定义与工具调用参数，不是完整请求的 token 上限。

本地 220 次模型调用的轨迹统计（2026-10-14，模型以 `ollama/gemma4:e4b` 为主）：

| 现象                   | 数据                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| 同一轮内输入随步数增长 | 第 1 步中位 5257 token → 第 7 步中位 7629 token                     |
| 耗时随输入增长         | 约 3.9k token 中位 0.6 秒；约 7.2k 中位 4.3 秒；约 9.2k 中位 8.5 秒 |
| 单次最大输入           | 10520 token（`num_ctx` 为 16384）                                   |

以上是当时的观察记录，未附样本清单与聚合脚本；耗时未控制输出长度、模型、冷启动和并发，不能据此认定输入增长是变慢的唯一原因。P0 需保存可复算的样本与配置，再建立性能基线。

主要问题：

1. **上下文先累积再裁剪。** 旧工具结果在达到阈值前一直保留；后续请求包含越来越长的输入，实际预填充成本还取决于缓存复用。
2. **前缀缓存经常失效。** 新地图快照会把历史中的旧快照原地改写为 `{"superseded":true}`，阈值裁剪从开头丢消息，两者都改变已发送过的前缀，会缩短可复用的共同前缀；不能据此断言全部 KV cache 都失效，命中与收益需实测。
3. **可枚举任务也逐步问模型。** 例如「人物、入口之外都帮我交互一下」：目标过滤（`remainingInteractionTargets`）、最近目标（`nearestInteractionTarget`）、完成判定都已由代码完成，但每交互一个目标仍至少需要一次模型调用，代码只用来纠正模型的选择。
4. **目标范围靠正则解析。** `compileInteractionGoal` 用中英文关键词判断「除 / 不要 / 人物 / 入口」，与 [`game-agent.md`](./game-agent.md) §6.4「语义判断交给模型结构化输出」的约定不一致，换个说法就会漏判；`__tests__/lib/game-agent/no-keyword-intent.spec.ts` 当前也因此失败。

## 2. 目标与非目标

| 目标 | 说明                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------- |
| G1   | 可枚举的批量任务中，模型调用次数与目标数量无关（规划 1 次，可选收尾 1 次；独立意图分类另计，总计 2–3 次） |
| G2   | 每次模型调用的输入大小有固定上限，与任务已执行的步数无关                                                  |
| G3   | 世界状态变化（新事件、传送、对话、事件页切换）不需要「回退队列」，边界内重新对账；越界则停止              |
| G4   | 目标理解、异常决策仍由模型给出结构化结果，不新增关键词判断                                                |
| G5   | 玩家可随时停止或修改范围，下一步即生效                                                                    |

非目标：

- 不引入 LangGraph、Temporal、BullMQ 等外部编排或队列框架（理由见 §3）。
- 不做任务跨进程 / 跨页面刷新恢复；任务与现有 Turn 一样只在进程内存活。
- 不自动存档作为回退点；玩家需要时自己发起存档。
- 批量任务不跨地图。
- 不支持并行执行多个 job：单人游戏只有一个输入控制方。

与 [`game-assistance.md`](./game-assistance.md) 的关系：

- 权限白名单、输入租约、停止 / 接管、证据校验等安全语义不变。
- **`batch` 是 operate 下的子策略**，刻意覆盖托管文档中「换图 / 目标消失后最多重规划 4 次」：换图、同图传送越出起始可见区、进入战斗、读档或运行实例变化时，batch **结束并报告进度**，不重新 resolve。
- `single` / `open` 仍走托管循环及其重规划规则；本文不改它们的停止语义。

G1 只约束「无选项、无补判、无改范围」的正常路径模型次数。P1 选项一律交还玩家时，对话框多的地图会多次暂停，不能把 G1 当成用户可见延迟承诺。

## 3. 决策

采用**分层执行**：模型负责理解目标和处理异常，代码负责列目标、排顺序、执行和判定完成。

```text
规划层（模型，1 次）   玩家原话 + 精简状态 → 结构化任务规则 TaskSpec
执行层（代码，循环）   每一步：最新状态 + TaskSpec + 候选账本 → 剩余 job → 选一个 → 执行 → 结果
决策层（模型，按需）   job 遇到本事件选项 / 被挡 → 小上下文决策（P1 只交还玩家）
收尾（代码 / 模型 1 次） 候选均已结算且无失败 / 待续办 → 完成；可选一次小模型调用生成旅伴语气回复
```

**不做队列回退，改为对账。** 游戏操作大多不可撤销（宝箱已开、对话已触发、开关已切），分布式系统的补偿式回退（Saga）不适用。执行层不维护一份「固定任务清单」，而是每一步用 `TaskSpec` 对**起始可见区内的候选集**与最新观察重新推算剩余 job。新出现且仍在起始区域内的对象可加入；消失或变成排除类别的对象自动排除；地图切换、同图传送越界、战斗或其它边界失效时停止并报告进度。对账只重算边界内目标，不自动扩大范围，也不等同于再次调用规划模型。

**不引入框架。** 现有需求是单角色、顺序执行、强实时：

| 类别         | 代表                       | 当前不采用的原因                                                 |
| ------------ | -------------------------- | ---------------------------------------------------------------- |
| Agent 编排图 | LangGraph JS、Mastra       | 能组织代码与模型节点，但当前顺序循环无需额外编排依赖             |
| 持久化工作流 | Temporal、Inngest、Restate | 本期不要求跨进程恢复；引入服务端持久化还需解决游戏侧输入幂等问题 |
| 消息队列     | BullMQ、p-queue            | 排队和重试不能替代状态对账与输入权限校验                         |
| 状态机       | XState                     | 单个 job 的菜单与输入流程复杂后再评估                            |
| 游戏 AI      | 行为树、GOAP、HTN          | 可借鉴条件检查与分层任务思想，本期只实现顺序对账循环             |

这是当前范围下的取舍，不是对这些框架性能或模型调用方式的普遍判断。

## 4. 任务分流

意图分类沿用现有两条入口，但必须扩展到同一套扩展字段，不能只改一边：

| 入口                                                     | 现状                  | 扩展后                                           |
| -------------------------------------------------------- | --------------------- | ------------------------------------------------ |
| 插件 `agent.task.classify`（`lib/game-agent/intent.ts`） | `{ action, operate }` | 增加 `shape`；`operate=true` 时必填              |
| 服务端 `classifyGameIntent`（`managed-goal.server.ts`）  | `{ operate, edit }`   | 保留 `edit`，增加 `shape`；`operate=true` 时必填 |

```ts
type PlayIntent =
  | { action: string | null; operate: false; edit: false }
  | { action: string | null; operate: false; edit: true }
  | { action: string; operate: true; edit: false; shape: 'single' | 'batch' | 'open' }
```

`edit=true` 仍走现有修改数值路径，不进入 `batch`。JSON Schema 与两边的解析器必须同步；缺少 `shape` 的旧客户端输出一律按 `open` 处理（保守，不扩大批量授权）。

| 类型     | 例子                                         | 执行方式                                                                   |
| -------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `chat`   | 「这是哪」「你好」                           | 一次模型调用，状态放在提示词，无写工具                                     |
| `single` | 「打开装备菜单」「和村长说话」               | 现有工具循环；上下文按 §9 固定大小                                         |
| `batch`  | 「人物、入口之外都交互一下」「把箱子都开了」 | 本方案：规划层 → 对账执行 → 按需决策                                       |
| `open`   | 「帮我推进剧情」「去下一个城镇」             | 现有托管循环；上下文按 §9 固定大小；成熟的操作序列沉淀为固定流程（§12 P4） |

分流结果只决定执行方式，不改变权限。

**防误判批量扩大范围（强制）：**

1. 分类输出 `shape=batch` 后，规划层必须再输出 `cardinality: 'one' | 'many'`（或等价字段）。`one` 时不得进入对账批量，改为 `single`，且只能操作规划给出的明确 `includeEventIds`（长度必须为 1）。
2. `shape=batch` 且 `includeKinds === 'all'`、同时又没有非空 `excludeKinds` / `excludeEventIds` / 点名集合时，若请求语气像单目标（分类的 `action` 指向单一对象），Host **补判或问玩家**，不得直接开跑。
3. 退回 `single` / `open` 时，已确认的包含、排除与输入约束必须变成 Host 硬过滤（工具白名单 + 事件 id 守卫），不能只写进 prompt。无法保留硬约束则暂停询问玩家，**禁止**「保不住约束还退回 `open`」。

## 5. 数据结构

### 5.1 TaskSpec（规划层输出）

事件类别以 Host 在观察快照上**统一归一化**后的值为准，规划与执行必须用同一套标签。归一化规则：

| 观察事实                                                                    | 归一化 `EventKind` | 说明                                                                 |
| --------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| `kind === 'npc'` 或 `look === 'character'`                                  | `npc`              | 人物                                                                 |
| `kind === 'door'` 或可触摸开门障碍                                          | `door`             | 门                                                                   |
| `kind === 'exit'` 或 `transit === true` 或 `interactionClass === 'transit'` | `exit`             | 入口 / 出口 / 传送；**不再使用旧代码的 `transit` 作为 exclude 标签** |
| `kind === 'pickup'` 或 `interactionClass === 'reward'`                      | `pickup`           | 拾取 / 奖励物                                                        |
| `kind === 'object'` 且可交互                                                | `object`           | 明确的物件                                                           |
| 其它可交互                                                                  | `unknown`          | 未分类                                                               |

`effectiveInteractionKind` 的启发式可继续用于归一化，但结果必须写入规划快照与执行过滤共用的字段（例如 `normalizedKind`），禁止执行时再按 sprite 名临时改判导致与规划不一致。[`game-agent.md`](./game-agent.md) §6.4 约束的是「玩家自然语言范围」不得用关键词；Host 侧对引擎事实字段的归一化不属于该禁令，但仍禁止用事件名 / 台词关键词分类。

```ts
type EventKind = 'npc' | 'door' | 'exit' | 'pickup' | 'object' | 'unknown'

type InteractBatchSpec = {
  kind: 'interact_batch'
  /** 只处理任务开始时绑定的可见区域，不跨地图（§13） */
  scope: 'visible_map'
  /** 'all' 表示除 exclude 外、且通过 §5.1.4 的可交互对象 */
  includeKinds: EventKind[] | 'all'
  excludeKinds: EventKind[]
  /** 玩家点名包含 / 排除的具体事件，id 必须来自规划快照 */
  includeEventIds: number[]
  excludeEventIds: number[]
  /** 规划自检：one 不得进入 batch 执行 */
  cardinality: 'one' | 'many'
  /** 遇到对话选项时：交给玩家选，或由决策层按目标选 */
  onChoice: 'ask_player' | 'decide'
  /** UI 展示：「交互当前地图中除人物与入口外的对象」 */
  summary: string
}

type TaskSpec = InteractBatchSpec // 后续扩展：pickup_all、talk_all 等
```

`TaskSpec` 由模型给出、Host 校验后保存，玩家修改范围时整体替换。它是任务规则，不是授权令牌；地图、战斗实例等边界仍由扩展后的 `TaskBoundary` 约束。

过滤规则必须唯一且可测试：

1. **候选集锚定起始可见区。** 任务开始时 Host 绑定 `runtimeInstanceId`、`startMapId`、`startVisibleBounds`，并建立 `candidates: Map<eventId, Candidate>`（至少含 id、坐标、归一化 kind）。之后每步：
   - 从最新观察合并：仍在 `startVisibleBounds` 内的新事件可加入 candidates；
   - **不得**只用当前镜头下的 `nearbyEvents` 当候选全集——`handlers.ts` 的 nearby 随镜头裁剪，角色移动后远处目标会从观察消失，若直接当全集会导致假完成；
   - 完成判定看的是 candidates 中「应处理且尚未结算」是否为空，不是「当前 nearby 是否为空」。
2. 先校验边界与可交互事实（`interactive !== false`、未 `opened` 等），再按 `includeKinds` 选取；`includeEventIds` 非空时取交集。
3. 最后应用 `excludeKinds` 与 `excludeEventIds`，排除优先；点名 id 不能绕过类别排除或边界。条件冲突且会改变玩家本意时补判或询问。
4. **`unknown` / 不确定对象不得自动触发，也不得因「跳过」而把任务标成全部完成。**
   - `includeKinds === 'all'` 时，`unknown` 记入 candidates，状态为 `deferred:uncertain_kind`；
   - 明确的 `includeKinds` 若不含 `unknown`，则 `unknown` 不进入可执行集合；
   - 可执行剩余为空、但仍有 `deferred:uncertain_kind` 时，任务结果为 `partial` 或暂停问玩家（P1：问玩家是否处理这些未分类对象），**禁止**报 `completed`。
5. 同图坐标传送：若玩家位置离开 `startVisibleBounds`（或地图 id 变化），视为越界，结束 batch，即使 `mapId` 未变、`interact` 未返回 `transferred`。
6. 进入战斗（`scene` 离开地图 / `battle` 出现）→ `world_changed`，结束 batch；不在 batch 内接管战斗（战斗走 `open` / 托管战斗路径）。

### 5.2 Job 与结果

```ts
type Job = {
  /** 任务内标识：同一事件切页后不生成新 job，见 §7.2 */
  key: string
  kind: 'interact'
  mapId: number
  eventId: number
}

type JobResult =
  | { status: 'done'; evidence: InteractEvidence }
  | { status: 'skipped'; reason: 'gone' | 'nothing_to_run' | 'runs_by_itself' | 'uncertain_kind' }
  | { status: 'blocked'; reason: 'no_path' | 'no_reaction' | 'timeout'; blockedBy?: number[]; detail?: unknown }
  | { status: 'needs_decision'; reason: 'choice' | 'input_required'; state: unknown }
  | { status: 'busy_other'; reason: 'other_event_busy'; busyEventId?: number; detail?: unknown }
  | { status: 'stopped'; reason: 'interrupted' | 'effect_unknown' | 'runtime_not_updating'; detail?: unknown }
  | { status: 'world_changed'; reason: 'transferred' | 'transferred_on_the_way' | 'scene_changed' | 'left_start_bounds' | 'battle' }

type InteractEvidence = {
  messages: string[]
  goldChange: number
  inventoryChanges: unknown[]
  historyRange: { fromSeq: number | null; toSeq: number }
  completeness: { messagesTruncated: boolean; historyGap: boolean }
  /** 途中按 spec 合法打开的障碍，必须入账，不能静默 */
  sideEffects?: Array<{ eventId: number; outcome: string }>
}
```

`chaya_live_interact`（`plugins/src/agent/interact.ts`）的 `outcome` 需要结合最新状态、输入是否已派发与事件归属解释，不能只按字符串映射：

| outcome / 情况                                             | JobResult / 处理                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `done`                                                     | 验证目标与事件结束证据后记 `done`                                                                    |
| `gone`、`nothing_to_run`、`runs_by_itself`                 | `skipped`，不声称交互成功                                                                            |
| `no_path`、`no_reaction`                                   | 证实无未结算事件与未知副作用后记 `blocked`；附带 `blockedBy` 供决策，**不得自动打开**                |
| `timeout`                                                  | 尽力回读；事件仍运行或副作用不明 → `stopped: effect_unknown`；仅证实未触发且无未知副作用 → `blocked` |
| `choice`                                                   | 仅当选项属于**当前 job 的 eventId** 时 → `needs_decision`；否则 → `busy_other`                       |
| `input_required`（数字 / 物品选择）且 busy 事件 = 当前 job | `needs_decision: input_required`（P1 交还玩家，不套 `choiceIndex`）                                  |
| `input_required` / 对话忙碌且 busy 事件 ≠ 当前 job         | `busy_other`：等待或交还玩家，**不得**给目标事件建 PendingJob，也不得移动                            |
| `transferred`、`transferred_on_the_way`、`scene_changed`   | `world_changed`，结束 batch                                                                          |
| 同图传送导致离开 `startVisibleBounds`                      | `world_changed: left_start_bounds`，即使顶层 outcome 仍是 `done` / 其它                              |
| 进入战斗                                                   | `world_changed: battle`                                                                              |
| `interrupted`                                              | `stopped`，不得当作普通状态变化后自动继续                                                            |
| `navigation.outcome === 'arrived'`                         | 不是终态；仅表示走到交互位，须继续看顶层 `outcome`                                                   |

**禁止复用默认 `openDoors: true`。** 现有 `trigger(..., openDoors: true)` 会在 `no_path` 时递归交互途中可触摸障碍，这会绕过 `excludeKinds`（例如排除了门却仍把门打开）。batch 的 `JobIo.interact` 必须：

1. 调用时关闭自动开门（或等价地传入 `openDoors: false` / 专用参数）；
2. 若路径被挡，返回 `blocked` + `blockedBy`；
3. 仅当某个 blocker 的归一化 kind **通过当前 spec 过滤**时，才允许把它作为独立 job 入队或由决策层授权打开，并写入 `sideEffects` / 账本；
4. 不得静默打开 out-of-spec 障碍。

消息与历史可能截断；证据必须标注截断或历史缺口，不能推断未观察到的收益或完整剧情。

### 5.3 运行状态

```ts
type Candidate = {
  eventId: number
  mapId: number
  x: number
  y: number
  normalizedKind: EventKind
  /** 未分类对象：不自动执行，见 §5.1.4 */
  deferred?: 'uncertain_kind'
}

type JobRun = {
  spec: TaskSpec
  specVersion: number
  /** 绑定运行实例、起始地图、起始可见区域；继承托管 TaskBoundary 的权限字段 */
  boundary: TaskBoundary & {
    runtimeInstanceId: string
    startMapId: number
    startVisibleBounds: { minX: number; maxX: number; minY: number; maxY: number }
  }
  /** 起始可见区内的候选全集；随观察合并，不随镜头缩小 */
  candidates: Map<number, Candidate>
  /** 全量结算账本；失败与跳过都保留原因，但不等于成功 */
  ledger: Map<string, { status: 'done' | 'skipped' | 'failed'; note: string }>
  failures: Map<string, number>
  /** 当前事件的续办句柄，包含事件归属、等待输入类型与状态 token */
  pending?: PendingJob
  /** 有条数与单条长度上限，仅供模型决策，不能作为总量统计来源 */
  log: Array<{ key: string; status: JobResult['status']; note: string }>
  attempts: number
  deadline: number
}
```

`PendingJob`、`JobIo` 与 `JobOutcome` 是拟实现契约；这里的类型与伪代码用于描述状态转换，不是当前可直接调用的接口。预算累计模型轮次、实际写动作与按键量，复用 Host 统一预算（以 [`game-assistance.md`](./game-assistance.md) §3.1 的 **80 步 / 60 动作 / 5 分钟** 为上限表；文中另出现的「20 轮」等历史数字不适用于 batch）。job 尝试次数另计，不能等同于写动作数。

## 6. 规划层

一次结构化输出调用。输入：玩家原话 + 精简状态。事件条目除 id / 名称 / 归一化 kind / 距离 / routeStatus 外，**必须带** `effects`、`opened`、`interactive`、`interactionClass`、`look`、`transit`（布尔），以便模型区分 pickup / object / unknown；仍默认不放完整队伍、背包、屏幕文字。

```text
system: 固定的规划提示词（稳定前缀）
user:   {"request": "...", "state": {...精简状态...}}
format: InteractBatchSpec 的 JSON Schema
```

Host 校验：

- `includeEventIds` / `excludeEventIds` 必须来自规划快照；无效 id、未知字段、枚举或范围冲突进入补判，不能静默丢弃后声称无目标。执行前再观察，区分已消失的有效目标与规划错误。
- `cardinality === 'one'` → 不进入 batch，改 `single`（§4）。
- 只有通过校验、且没有未解决歧义与未处理 `deferred` 询问的 spec，推算可执行 job 为 0 且无 deferred 时，才回复「当前没有符合条件的目标」。
- 输出无效：补判一次（可启用 `think`）；仍无效 → **暂停询问玩家**。仅当已能把包含 / 排除落实为 Host 硬过滤时，才允许降级为 `single`；**默认不退回 `open`**（避免无硬过滤的开放循环扩大授权）。
- 范围有歧义（例如「那几个」无法定位）：用 `chaya_player_card` 让玩家选择，不猜。

`compileInteractionGoal` 的正则解析由本层取代。事实侧的可达性判断继续复用；排序入口改为只接收结构化规则与归一化 kind，不再把 `spec.summary` 丢进自然语言正则。

## 7. 执行层

### 7.1 对账循环

以下为状态转换伪代码；`io` 必须在内部落实权限、边界、版本、取消与预算检查，不能把循环入口检查当作输入保护：

```ts
async function runJobs(run: JobRun, io: JobIo, signal: AbortSignal): Promise<JobOutcome> {
  for (;;) {
    io.checkAbortAndBudget(run, signal)
    const version = run.specVersion
    const state = await io.observe(signal)
    io.checkAbortAndBudget(run, signal)
    if (version !== run.specVersion) continue
    if (!io.withinBoundary(state, run.boundary)) return io.finish(run, 'out_of_scope')
    io.mergeCandidates(run, state) // 只并入 startVisibleBounds 内的事件

    // 续办正在执行的事件，不重新导航或触发同一个目标。
    if (run.pending) {
      const result = await io.continuePending(run, state, signal)
      io.recordContinuationEvidence(run, result)
      io.checkAbortAndBudget(run, signal)
      if (result.status === 'waiting_user') return io.suspend(run)
      if (result.status === 'stopped') return io.finish(run, 'stopped')
      if (result.status === 'world_changed') return io.finish(run, 'out_of_scope')
      if (version !== run.specVersion) continue
      io.applyContinuation(run, result)
      continue
    }
    if (io.hasActiveEventOrInput(state)) {
      // busy 事件 ≠ 任何可写 pending → 交还 / 等待，不给其它目标建 PendingJob
      return io.suspendForExistingEvent(run, state)
    }

    const jobs = remainingJobs(run) // 基于 candidates ∩ spec ∩ ¬ledger ∩ ¬failures≥max，忽略 deferred
    if (!jobs.length) {
      if (io.hasDeferred(run)) return io.finish(run, 'partial_or_ask', 'uncertain_kind')
      return io.finish(run, io.hasFailures(run) ? 'partial' : 'completed')
    }
    const job = pickNext(jobs, state) // 跳过 failures 未达上限的也可重试；已 fail 的不在 remaining 中
    if (!job) return io.finish(run, 'unreachable', jobs)
    run.attempts++
    // 必须关闭 openDoors；blockedBy 不得自动交互
    const result = await io.interact(job, { version, state, openDoors: false }, signal)
    io.recordEvidence(run, job, result)
    io.checkAbortAndBudget(run, signal)
    switch (result.status) {
      case 'done':
      case 'skipped':
        io.settle(run, job, result)
        break
      case 'blocked':
        if (io.bumpFailures(run, job) >= MAX_JOB_FAILURES) io.fail(run, job, result)
        break
      case 'needs_decision':
        run.pending = io.createPending(job, result, version)
        break
      case 'busy_other':
        return io.suspendForExistingEvent(run, state)
      case 'world_changed':
        return io.finish(run, 'out_of_scope')
      case 'stopped':
        return io.finish(run, 'stopped')
    }
  }
}
```

要点：

- **候选集 + 账本对账。** 不手工维护目标队列；`remainingJobs` 读 `candidates`，不读「当前 nearby 是否为空」。只有有证据的完成、跳过或失败才进入账本，派发工具调用不等于已处理。
- **`pickNext` / `remainingJobs` 必须排除已 `fail` 的 key，以及 `failures` 已达上限的 key**；未达上限的 `blocked` 可重试，但同一轮优先换其它可达目标，避免 livelock（实现：按失败次数升序，再按路线距离）。
- **禁止 out-of-spec 自动开门**（§5.2）。
- **每次派发前重新校验。** 包括每一小步移动、按键与菜单输入。对话、事件运行、待启动事件、传送、暂停或游戏帧不更新时不得继续导航。途中触发事件立即停步，只有确认归属当前 job 才进入续办。
- **输入沿用玩家操作路径。** 不能改坐标、越过碰撞或绕过事件锁。
- **顺序动态决定。** 提取只接收结构化规则的排序入口；禁止把 `spec.summary` 重新交给 `compileInteractionGoal` / 自然语言正则。
- **未知效果不重试。**
- **待续办保留归属。** 修改范围不能清掉正在运行的事件去改去移动。
- **异步后检查版本与取消。** Host 持有输入租约并校验控制 token。

### 7.2 Job 的语义标识

同一事件在一次任务中只交互一次，切页后也不再交互（§13）。key 只由地图与事件 id 组成：

```ts
const jobKey = (mapId: number, eventId: number) => `${mapId}:${eventId}`
```

已结算的事件无论语义如何变化都不再生成 job。**`batch` 路径必须禁用 `run-turn.ts` 里基于 `interactionEventSignature` 从 `interacted` 集合移除并重开的逻辑**；该 reopen 只属于旧的多目标工具循环。尚未结算的超时或中断不能提前加入账本。尚未处理的事件每一步按最新归一化 kind、`interactive`、`opened` 重新过滤。`interactionEventSignature` 仅写入操作轨迹，不参与 key，也不在 batch 内触发重开。

### 7.3 防死循环

| 情况                              | 处理                                                                        |
| --------------------------------- | --------------------------------------------------------------------------- |
| 同一 job 连续 `blocked`           | 达到 `MAX_JOB_FAILURES`（初值 2）后标为失败，继续其它目标；最终报告部分完成 |
| 连续多步状态指纹不变且无 job 完成 | 沿用 `game-assistance.md` §5.3 的无进展判定，3 次后停止                     |
| 地图切换 / 同图越界 / 战斗        | 结束 batch，报告已完成与未完成（**不**走托管的换图重规划）                  |
| 总量                              | Host 统一预算：80 步 / 60 写动作 / 5 分钟；job 尝试次数另设上限             |

任务截止时间从开始执行任务计算，包含规划、决策、工具与等待；到期取消正在进行的异步调用。是否暂停玩家等待时间沿用 Host 既有策略。

## 8. 决策层

P1 只交还玩家；P2 在 `needs_decision`（本事件选项）或已确认无未知副作用的 `blocked` 时按需调用，并受独立决策次数与总预算限制。`busy_other` 不进决策层。

```text
system: 固定的决策提示词（稳定前缀）
user:   任务 summary
        最近 5 条 run.log（每条一行）
        当前对话框 / 选项 / 输入请求（由 modelGameState 投影，只取 message 与 windows）
format: { action: 'choose' | 'ask_player' | 'stop', choiceIndex?: number, reason: string }
        blocked 单独使用 { action: 'retry' | 'skip' | 'ask_player' | 'stop', reason: string }
```

- `spec.onChoice === 'ask_player'` 时不调模型，直接发 `chaya_player_card`。
- `choose` 由 Host 验证整数索引、选项范围、事件归属、spec 版本与当前窗口 token 后转为输入序列；每个按键前重新校验。选完续办原事件，禁止再次导航触发 `interact`。
- 数字输入、物品选择不套用 `choiceIndex`，交还玩家。正在等待输入的事件不能靠 `skip` 消失。
- `blocked` 的重试只有原目标且证实无未知副作用时有效；若 `blockedBy` 中障碍通过 spec，可授权将其作为独立 job（入账），否则只能 skip / 问玩家 / 停止。
- 决策层不能修改 spec、不能新增超出 spec 的 job。

## 9. 剩余模型调用的上下文规则

规划层、决策层，以及 `single` / `open` 路径按以下顺序构造每次请求，目标是限制大小并保留尽可能长的共同前缀：

| 顺序 | 内容                                   | 变化频率                           |
| ---- | -------------------------------------- | ---------------------------------- |
| 1    | system prompt + 当次可用工具定义       | 同模型、配置、权限与执行路径内稳定 |
| 2    | 玩家目标、结构化规则与边界约束         | 范围修改时变化                     |
| 3    | 工作记忆：最近 K 步「动作 → 结果」摘要 | 按条数及长度预算裁剪               |
| 4    | 最新状态                               | 每步重建，只保留一份               |

规则：

- 原始结果归档到操作轨迹；模型工作记忆只保留必要证据摘要。若提供商协议要求工具调用与结果配对，摘要请求仍须满足该协议，不能保留悬空的调用 id。
- 每次构造新请求，不原地改写共享历史。工作记忆和最新状态变化仍会改变输入后缀；仅稳定共同前缀，不能保证整个请求缓存命中。
- K 条摘要不是容量上限：每条摘要、状态中的事件数量与文本、工具定义、请求原文和输出保留空间都要有预算。优先保留边界、当前事件和待选项；不能截掉控制字段后继续操作。
- 完整序列化请求须满足模型上下文容量，预留输出与可能的思考 token。能获取 tokenizer 时计 token；不能时使用保守估算与提供商限制，超限裁剪或暂停，不声称字符数与 token 等价。
- 现有 `compactModelMessages` 的 20000 字符阈值只作旧路径兜底，不能当成完整请求的硬上限。批量任务执行进度增长不应扩大模型请求预算。

## 10. 中途干预

| 玩家操作                 | 处理                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 停止                     | 立即取消后续子动作并释放保持按键；不等待 job 完成后才停。用独立的只读回读尽力记录已发生效果，不能撤销既有操作 |
| 修改范围（「箱子别碰」） | 暂停旧输入，重新规划并原子替换 spec、递增版本；账本与 candidates 保留。废弃旧模型回复，不自动扩大边界         |
| 键鼠接管                 | 沿用现有规则，检测到可信玩家输入即终止                                                                        |
| 回复玩家卡片             | 验证任务、运行实例、等待事件、版本与回复幂等键后续办原事件；重复或过期回复不执行                              |

## 11. 收尾与回复

- 完成判定只看代码：无待续办、无未知效果、可执行剩余为空、**且无未解决的 `deferred:uncertain_kind`**。存在失败或仍有 uncertain → `partial`（或问玩家）；剩余全不可达、越界、取消、到期、战斗和等待玩家分别报告，不称全部完成。
- 回复由全量账本与累计证据统计生成，不从被裁剪的 `run.log` 推算总量。收益按事件历史区间去重；`sideEffects` 中的合法开门等副作用单独列出。截断或缺口明确标注。
- 旅伴需要角色语气时，用一次小模型调用把统计结果改写成一两句话；输入只有统计结果与角色设定；模型不得改写事实或完成状态，生成失败则使用代码模板回复。
- `batch` 不使用 `FINISH_CHECK`；旧路径按阶段保留（§12 P1）。

## 12. 分阶段实现

### P0：度量

- 为每次模型请求记录模型与配置、输入 / 输出 token、上下文准备耗时、请求到首个流片段的耗时（可获取时）和完整请求耗时；每次工具调用独立记录开始、结束及结果，续办不能复用整组动作的耗时。
- 保存 Ollama 可用的 `prompt_eval_count`、`eval_count`、`load_duration`、`prompt_eval_duration`、`eval_duration`、`total_duration`，原始纳秒值与 UI 毫秒值明确区分。当前客户端仅提取 token 用量，阶段耗时尚未接入。
- 这些字段用于区分模型加载、输入处理、输出生成与 Host 总耗时；不能将 token 数直接当作缓存命中量。缓存收益用控制变量实验验证。

### P1：批量交互走对账执行（先插件）

- **宿主切线：P1 只接插件 `plugins/src/agent/runtime/host.ts`（旅伴 / 插件 play）。** 服务端 `services/game-agent/`（managed-turn）P1 不接 batch，继续现有托管循环；P1.1 再复用同一套 `lib/game-agent/jobs`。
- 插件与服务端的 classify **契约同时扩展** `shape`（服务端仍保留 `edit`），避免一边有 `shape`、一边没有。
- `batch`：规划层 + 对账执行；`openDoors: false`；candidates 锚定 `startVisibleBounds`；禁用 signature reopen。
- 决策层只支持 `onChoice: 'ask_player'`；`busy_other` 交还玩家。
- `run-turn.ts` 多目标纠偏（目标改写、`TASK_GATE`、`FINISH_CHECK`、signature 重开）在 `shape=batch` 下整段旁路；`single` / `open` 暂不变。

### P2：决策层

- 支持 `onChoice: 'decide'` 与 `blocked`（含合法 blocker 授权）时的模型决策。
- 服务端 Host 接入同一套 jobs（P1.1 若未做则在此完成）。

### P3：固定大小上下文

- `single` / `open` 路径按 §9 改造；去掉快照原地改写。
- 用 P0 验证各步输入均在预算内，增长不随历史步数无限累积；动态状态仍可能导致 token 波动。

### P4：固定流程沉淀

- 从轨迹中找出 `open` 路径反复成功的操作序列（例如开宝箱、存档），沉淀为与 `runChestRoutine` 同类的确定性流程，由模型选择调用。存档流程仅由玩家明确请求调用，不变成批量任务的自动前置动作。

## 13. 已定决策

2026-10-14 确认；2026-10-15 设计评审补充实现约束（见 §4–§7，不改变下表四条产品决定）：

| 问题                                                         | 决定            | 影响                                                 |
| ------------------------------------------------------------ | --------------- | ---------------------------------------------------- |
| 事件切页后是否再交互                                         | 不再交互        | job key 只用地图与事件 id；batch 禁用 signature 重开 |
| 有风险的 job 前是否自动存档                                  | 不自动存档      | 不提供回退点；失败按 `JobResult` 处理并报告          |
| `batch` 是否跨地图                                           | 暂不跨地图      | `scope` 固定为起始 `visible_map`；换图 / 越界即结束  |
| CLI 类 Agent（Cursor / Codex / Claude / Gemini）是否走本方案 | 所有 Agent 一样 | 见下                                                 |

所有 Agent 类型共用同一套分流、规划、对账执行与决策流程，差别只在模型调用的传输方式：

- Ollama 用 `format` 传 JSON Schema；CLI 类 Agent 由提示词约定同样的 JSON 结构。
- 两者的输出都经同一个解析与校验函数；无效时补判一次，仍无效则暂停询问玩家；仅在 Host 硬过滤可落实时降级 `single`，默认不退回无硬过滤的 `open`。
- §9 的上下文规则对 CLI 类 Agent 同样适用；Host 只保证同配置下静态前缀稳定，不保证提供商缓存命中。

## 14. 模块落点（拟新增，尚未实现）

| 模块                        | 位置                                  | 说明                                            |
| --------------------------- | ------------------------------------- | ----------------------------------------------- |
| TaskSpec 类型、Schema、校验 | `lib/game-agent/jobs/spec.ts`         | 含归一化 kind 与 cardinality                    |
| 候选集合并与对账            | `lib/game-agent/jobs/reconcile.ts`    | 只依赖 `JobIo`；不读镜头裁剪后的 nearby 当全集  |
| 交互 job 与结果映射         | `lib/game-agent/jobs/interact-job.ts` | `openDoors: false`；`busy_other` 分流           |
| 规划 / 决策提示词           | `lib/game-agent/jobs/prompts.ts`      | 稳定前缀，含结构化输出格式                      |
| 插件宿主接入（P1）          | `plugins/src/agent/runtime/host.ts`   | 按 `shape` 分流，实现 `JobIo`                   |
| 服务端宿主接入（P1.1 / P2） | `services/game-agent/`                | 与插件共用 `lib/game-agent/jobs`；P1 不抢先分叉 |

## 15. 测试

- `reconcile` 单测，用假 `JobIo`：
  - 角色移出镜头后，起始可见区内未处理事件仍在 candidates；不得因当前 nearby 为空报 `completed`。
  - 交互过程中新出现且位于起始可见区域内的事件会被纳入；区域外的不纳入。
  - 目标事件消失，跳过且不报错。
  - 事件变成入口（归一化为 `exit`），按 exclude 排除。
  - 已交互的事件切页后，不再生成 job；signature 变化不重开。
  - 地图切换、同图越出 `startVisibleBounds`、进入战斗 → 停止并报告进度（不重规划）。
  - 同一目标连续被挡，记失败后继续其它目标；`pickNext` 不 livelock 在同一 key。
  - `unknown` 剩余时不得报全部完成。
  - 玩家中途修改 spec，下一步按新规则执行。
  - 取消信号到达后不再派发新的交互。
- `interact-job` 单测：
  - `openDoors: false`：挡路门在 exclude 内时不得被打开；返回 `blocked` + `blockedBy`。
  - blocker 通过 spec 时，打开必须入账为独立结算或 `sideEffects`。
  - `input_required` / 忙碌：busy 事件 ≠ job.eventId → `busy_other`，不建 PendingJob。
  - busy 事件 = job.eventId 的选项 → `needs_decision`；数字 / 物品输入交还玩家。
- `spec` 单测：
  - 无效事件 id 进入补判；有效零目标与规划错误分别处理。
  - `cardinality: 'one'` 不得进入 batch。
  - `includeKinds: 'all'` 无排除且 action 像单目标 → 补判或问玩家。
  - 包含 / 排除优先级、点名 id、`exit` 与旧 `transit` 标签对齐、可见区域边界均有确定结果。
  - 插件与服务端 classify 扩展字段经同一解析；缺 `shape` 按 `open`；无效规划默认问玩家，不退回无硬过滤的 `open`。
- 关键词约束：`__tests__/lib/game-agent/no-keyword-intent.spec.ts` 继续覆盖 `lib/game-agent/jobs`。
- 输入安全与续办：
  - 对话、事件执行或待启动、传送、暂停及帧不更新时不派发移动；途中触发事件立即停步。
  - 选项后续办原事件，禁止重复触发。
  - 在观察、模型等待与子按键之间取消或修改范围，旧 token / 版本不能写入；玩家卡片重复回复幂等。
  - 超时或中断且效果未知时停止，不自动重试，也不提前结算为已完成。
  - 账本统计不受最近 K 条摘要裁剪影响；预算覆盖内部按键与长等待。
- 回放与性能：
  - 当前 `scripts/replay-agent-context.ts` 只比较同一 `runAgentTurn` 的裁剪开关，不能验证新 job 路径。
  - 扩展为按工具参数响应的状态模拟后，再比较新旧执行路径；另做受控实机测试验证移动、事件锁、禁止自动开门与续办。
  - 性能比较固定模型、思考模式、输出上限、上下文容量、初始游戏状态与目标，分别记录冷 / 热启动，多次交错运行，报告调用次数、输入 / 输出 token、分阶段耗时及完成率。
