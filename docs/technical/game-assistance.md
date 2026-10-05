# 游戏辅助自主托管技术方案

> 状态：设计稿  
> 日期：2026-10-05  
> 需求：[`../game-assistance.md`](../game-assistance.md)  
> 关联：[`game-agent.md`](./game-agent.md)、[`webmcp.md`](./webmcp.md)

## 1. 决策

在现有 Chaya 助手中扩展通用的托管 Turn。玩家只提交自然语言目标；Host 先观察游戏，模型依据目标与新观察决定下一步，Host 负责工具校验、执行、验证、暂停和终止。不按“代打”“跳剧情”“寻路”等词建立专用工具链或要求玩家选任务类型。

运行策略由 Host 内部决定。只读问题不给写工具；明确要求操作游戏的请求才进入托管循环。判断依据是玩家本轮指令和当前游戏观察，不读取游戏文本作为新的任务指令。无法确定目标或关键选择时询问玩家。通用循环不意味着无限授权：工具白名单、单次动作和总任务边界始终由 Host 执行。

首期托管运行在 App / local 的服务端游戏桥接链路；Edge 的浏览器运行器沿用相同契约，在它具备等价的任务生命周期和游戏连接后接入。模型使用现有 Ollama `tools` / `tool_calls`，不需要模型自带 Agent 循环或额外的“代打”能力。

## 2. 现状与缺口

| 位置                     | 当前实现                                            | 托管所需变化                                                                          |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GameAgentWorkspace.tsx` | 请求固定传 `mode: 'ask'`；展示观察/思考和工具调用。 | 发送自然语言目标，展示推断目标、进展、等待玩家和完成依据；支持重新连接运行中的 Turn。 |
| `turn/route.server.ts`   | 拒绝非 `ask`；SSE 断开即停止。                      | 允许内部托管策略；Turn 生命周期独立于事件订阅；断线后可按事件序号续读。               |
| `turn-runner.server.ts`  | 最多 8 轮工具调用，模型输出正文即可结束。           | 目标建立、短动作循环、证据校验、无进展检测、时间/动作预算、暂停/继续。                |
| `tool-runtime.server.ts` | 提供非破坏性工具并对部分写操作回读。                | 明确读写分级、每轮写动作上限、参数校验、游戏绑定与中止检查；统一返回可比较的观察。    |
| `handlers.ts`            | 状态含场景、地图、队伍、敌人、窗口和对话。          | 补足当前可用指令、目标和代价，以及可识别的战斗实例与结局。                            |
| `history.ts`             | 记录最近 300 条已显示剧情，支持 `afterSeq`。        | 任务起点游标、增量完整性检测；处理重复台词合并导致游标不前进的问题。                  |
| `browserTurn.ts`         | 独立的浏览器工具循环，最多 8 轮。                   | 后续复用相同的任务状态与边界；不能让 Edge 形成另一套游玩语义。                        |

原 [`game-agent.md`](./game-agent.md) 描述的 ask/play、能力探测和 M3 会话恢复仍是上层路线图；本文给出自主托管的增量契约。实现前应同步原文中“模型正文即可完成 Turn”等旧伪代码，以免两份文档表达冲突。

## 3. 运行结构

```text
用户自然语言目标
  ↓
Turn API → 按 gameId 建立任务、读取 game.state 与 game.history 游标
  ↓
Goal resolver → 推断目标、范围、完成证据与是否需要追问
  ↓
通用任务循环：观察 → 模型决策 → Host 校验 → 短动作 → 重新观察
  ├─ 证据满足 → 完成并总结
  ├─ 需要玩家 → 暂停，收到回复后继续同一任务
  ├─ 无进展 / 上限 / 断连 → 结束并说明最后状态
  └─ 玩家停止 → 取消后续动作
```

Goal resolver 不做关键词到“战斗执行器”的映射。它消费玩家原话与首次观察，生成内部任务约束：

```ts
type TaskGoal = {
  request: string // 玩家原话，不允许游戏文本改写
  summary: string // UI 展示的简短目标
  scope: string // 本轮可操作的范围，如“当前这场战斗”
  completionEvidence: string[] // 需要在新状态/历史中核实的事实
  openQuestion?: string // 目标不足时询问玩家
}
```

`TaskGoal` 是模型建议、Host 保存的任务上下文，不是授权令牌。模型可根据观察调整行动计划，但不能自行扩大玩家目标或修改 Host 权限。自然语言完成条件无法完全机械证明；Host 至少要求模型给出可定位于最新状态或本轮历史的依据。缺乏依据时只报告进度或“无法确认完成”。

## 4. Turn 生命周期与接口

### 4.1 请求和状态

沿用 `POST /api/game-agent/turn` 的 Profile、模型、会话和 SSE 格式。新客户端只发送 `prompt`，不要求玩家选择 `ask` / `play`；旧客户端传 `mode: 'ask'` 时继续按只读兼容处理。服务器根据用户意图和首次观察决定是否允许写工具，决策只在 Host 内部生效。

Turn 增加 `goal`、`phase`、`step`、`actionCount`、`deadline`、`lastObservation`、`historyCursor`、`noProgressCount` 和 `pendingQuestion`。一个 `gameId` 同时只有一个活动 Turn。新的 `waiting_user` 状态保留任务上下文，不释放为可并行的新 Turn；玩家回复后恢复同一任务。

```text
starting → observing → planning → acting → verifying → planning ...
                         └──────────────→ waiting_user → observing
任意活动状态 → completed | stopped | failed | limit_reached
```

新增 `POST /api/game-agent/turn/:turnId/reply`，请求含 `gameId` 与玩家回复。只有该游戏当前 `waiting_user` 的 Turn 可接收，重复回复用 `replyId` 幂等处理。`DELETE /api/game-agent/turn/:turnId` 继续用于停止；停止、回复和读事件都必须校验与启动时相同的游戏绑定和入口权限。

### 4.2 事件与断线

事件增加单调 `seq`，保存一个有界内存事件窗口。`GET /api/game-agent/turn/:turnId/events?after=<seq>` 重放窗口内遗漏事件并继续订阅；`GET /api/game-agent/status` 返回活动 Turn 的 id、阶段和最后事件序号。事件至少包含 `goal.updated`、`phase`、`tool.started`、`tool.completed`、`approval.required`、`turn.completed`、`turn.stopped` 和 `turn.failed`。

SSE 订阅断开仅移除订阅者，不自动取消任务，满足关闭侧栏仍可运行。明确停止、游戏离线/退出、任务超时和服务进程结束才终止执行。事件窗口不足以补齐时，客户端用状态快照重建当前目标和活动工具行，并提示早期细节不可恢复；不能重放写工具。首期任务只在进程内存活，服务重启后不恢复执行。

## 5. 决策与执行

### 5.1 模型输出

首次观察后模型要么给出简短目标和完成依据，要么询问缺失信息；玩家不需为正常目标逐次确认。后续每轮只允许一项写动作，或提出问题，或申请结束。可提供仅在内置 Host 中可见的控制工具 `task.goal`、`task.ask_user`、`task.finish`，与游戏 MCP 工具分开；这些控制工具只表达决策，不直接操作游戏。

模型使用当前观察和本轮历史决定工具，不预生成长按键脚本。读工具可按需调用；写动作执行完由 Host 强制回读。`task.finish` 必须带上最新观察或本轮历史的证据引用。若模型只返回普通正文，Host 不能据此宣称托管完成：先检查完成证据，证据不足则继续观察或以“未确认完成”结束。

### 5.2 Host 循环

```ts
async function runManagedTurn(task, signal) {
  let observed = await observe(task.gameId, task.historyCursor)
  task.goal = await resolveGoal(task.request, observed)
  if (task.goal.openQuestion) return waitForUser(task.goal.openQuestion)

  while (withinBudget(task)) {
    throwIfAborted(signal)
    const decision = await modelDecide(task.goal, observed, task.progress, allowedTools(task))
    if (decision.kind === 'ask_user') return waitForUser(decision.question)
    if (decision.kind === 'finish') return finishOnlyIfVerified(decision, observed, task)
    const action = validateAction(decision, task) // 白名单、schema、游戏绑定、权限、动作长度
    const before = observed
    const result = await executeOneAction(action, signal)
    throwIfAborted(signal)
    observed = await observe(task.gameId, task.historyCursor)
    updateProgress(task, before, result, observed)
    if (task.noProgressCount >= 3) return stopWithProgress(task)
  }
  return stopAtLimitWithProgress(task)
}
```

预算由 Host 计数，至少包含最大模型轮次、写动作次数、累计按键数、单动作时长、总任务时长和连续无进展次数。初值沿用需求文档的 20 轮、单次最多 8 个按键动作、5 分钟和 3 次无进展；实现时以这些值作为上限而非模型可请求的参数。长任务可由玩家在报告当前进度后发起续做，不自动重置预算。

一轮中若模型返回多个写工具调用，Host 只执行第一项，其余返回未执行结果并重新观察；不能把旧观察下的多个动作连成不可中断的计划。`chaya_live_play` 虽允许更长序列，内置 Host 仍收紧为最多 8 步，并在每步前后检查停止与场景状态。模型传入的 `gameId` 被覆盖为 Turn 绑定值。

### 5.3 进展与完成验证

观察指纹使用场景、地图与坐标、活动窗口、对话、队伍/敌人状态、战斗实例、历史游标和关键屏幕文字；忽略时间戳、动画帧和未影响任务的字段。指纹变化是进展线索，不等于完成。相同错误重复两次或连续三次无有效进展后停止，避免在菜单上盲按。

完成判定以“目标 + 可观察证据”为准。通用校验先确认引用来自当前 Turn 且是动作后的观察；领域状态只提供事实，不决定固定操作流程。例如：

- 战斗：`battleInstanceId` 与本次战斗结果对应；胜利、失败或逃跑要分别报告。场景离开战斗但没有结果记录时不得推定胜利。
- 剧情：本轮新增的台词/选项记录与最终状态构成摘要依据；记录缺失只能给部分摘要。
- 移动：目标可唯一定位时，最终地图与坐标达到目标附近；若被传送或目标消失，重新规划或追问。

## 6. 游戏侧观察契约

### 6.1 战斗与交互

在 `game.state` 的现有 `scene`、`battle`、`windows` 基础上补充当前可选择的命令名称/符号、作用角色、可选敌我目标、技能或道具可用性及代价。只读取 RPG Maker MV/MZ 标准 API 和当前可见窗口；无法可靠读取的字段返回 `null`，不据窗口位置猜测选项。引入本次游戏进程内单调的 `battleInstanceId`，将开始与结局记录到状态和 `game.history`，供结局与对应战斗配对。重新加载存档后重新建立实例边界。

战斗状态读取得可保持轻量；大型技能列表按当前窗口和选中角色裁剪。工具执行后等待游戏进入稳定可交互状态，再回读；不能用固定毫秒延迟代替状态检查，等待仍受单动作超时约束。

### 6.2 剧情记录

任务开始时读取 `game.history` 的 `lastSeq` 作为起点；每段短对话操作后读取 `afterSeq` 的新增条目，原样保留到本轮任务缓存，再更新游标。请求上限取 300；若首条新记录的序号大于期望、环形缓冲覆盖起点或本轮缓存超预算，标记 `historyIncomplete`，总结必须显式说明范围。

现有连续相同台词会合并为 `repeat`，可能更新内容却不增加 `seq`。需给每次显示增加单调事件游标，或让增量读取返回合并条目的修订信息，确保任务起点后重复出现的台词可被感知。`afterSeq` 的语义与客户端兼容性在更改前通过协议测试固定。

直接执行跳过/清除事件不会触发全部已显示台词记录，因此此需求使用逐段快进。遇到未授权选项、战斗、商店、读档等场景时由当前观察触发暂停或交还控制，不继续盲按。翻译文本优先使用记录中已有译文；原文和译文都缺失时不生成虚构剧情。

## 7. 权限、暂停与恢复

写工具仍从现有目录与第一方插件声明生成白名单。Host 在调用前再次校验工具名、参数 schema、绑定游戏和危险级别；模型能看到某个工具不等于已获玩家授权。普通按键/移动在明确的托管目标内可执行；消耗稀有资源、剧情分支、存档/读档、传送、修改状态和强制胜败根据现有危险级别及当前后果请求玩家确认，或暂不开放。明确的玩家指令可以提供针对本轮的有限授权，但不能覆盖工具硬禁用项。

`waiting_user` 暂停模型调用和后续写工具，保存问题、选项、最近状态与待执行动作摘要；回复后先重新观察，再决定是否仍适用原计划。暂停期间玩家手动改变游戏状态时，不自动重放旧动作。停止的 `AbortSignal` 在调用模型、执行工具前和回读前检查；已发给游戏的单个原子按键可能完成，UI 报告最后实际读到的状态。

## 8. 分阶段交付与验证

1. **通用托管纵切**：自然语言入口、首次观察与目标建立、Host 预算、一次一写和写后验证、进度事件、停止。用“帮我代打”在已有战斗中验证自主识别与本场结束；非战斗时应追问目标。
2. **交互与证据**：补足战斗观察、战斗实例和剧情增量游标；实现完成证据校验、选项/资源决策的暂停与回复。用战斗、含选项对话、受阻寻路三个不同场景验证同一循环，不添加场景专用执行器。
3. **生命周期与多端**：Turn 与 SSE 订阅解耦、事件续读、侧栏关闭后恢复展示，再接入 Edge 等价运行器；以断线、游戏退出、服务重启和重复回复验证幂等与终止语义。

测试重点是 Host 不执行第二个未经重新观察的写动作、模型提前声明完成时仍要求证据、剧情记录缺口不被当作完整摘要，以及暂停/停止后不再启动新工具。端到端验收使用可控 RPG Maker fixture，同时在真实 MV/MZ 游戏中检查状态字段的兼容性。格式、类型和测试命令沿用仓库的 `pnpm format` / `lint` / `typecheck` / `ok`。
