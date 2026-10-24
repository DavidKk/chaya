# 旅伴功能优化记录

- **日期**：2026-10-24
- **状态**：历史排查记录；下文建议不再作为独立实施清单，统一归入整体方案 T0–T9
- **关联**：[`game-agent.md`](./game-agent.md)、[`capability-supplement.md`](./capability-supplement.md)、[`agent-cli-providers.md`](./agent-cli-providers.md)、[`technical/game-agent.md`](./technical/game-agent.md) §6.4、[`technical/capability-supplement.md`](./technical/capability-supplement.md) §9

> 历史排查线索，不是全部已复现的缺陷清单。输入框无响应、角色会话串扰和 CLI 调用成本等判断需在实现任务中重新验证；本地轮询次数不等于模型调用次数。下文保留最初观察，目标行为与实施方向以 [`companion.md`](./companion.md)、[`technical/companion.md`](./technical/companion.md) 为准，自动反应采用本地路径，物件类别只使用可靠事实。

## 1. 范围

旅伴 = 共享 `runAgentTurn` 核心上的 `companion` 能力配置。本文覆盖从面板到运行时核心的实现链路，不包含其余 Agent 能力（托管 / 问答）。

## 2. 问题清单（按优先级）

### P1 — 全局冷却把不同类型的主动提示互相吞掉

- 位置：`lib/game-agent/companion.ts:40,68,76,83`
- `CompanionTracker` 只有一个 `lastSpokeAt`，battle / danger / chest 三种 cue 共用同一个 12s 冷却。
- 后果：刚说过「战斗开始」，紧接着刷出的宝箱或队友掉到危险血线会被静默跳过；时效性最强的 `danger` 最容易被压住。
- 建议：按 cue 类型拆分冷却（`danger` 至少独立计时，battle / chest 各自计时），保留一个总限频上限。

### P1 — 「companion 只读、不可按键」与实现不符

- 位置：`lib/game-agent/runtime/capabilities.ts:41-44`
- 文档契约：`docs/capability-supplement.md:375,459,465`、`docs/technical/capability-supplement.md:299` 明确旅伴「只读游戏状态、不可按键、不可修改数据」。
- 实际：`companion` 的 `allowTool` 放行了 `group(tool,'player')` 与 `group(tool,'live')` 的全部工具，只排除 `WRITE_TOOL` 正则命中的 edit/eval 等与 `quit`。`chaya_live_press/play/tap/move_to/interact/save` 等输入 / 存档工具对 companion 都可见，与「托管按键独占、companion 不可按键」冲突。
- 建议：二选一并落码 + 落文档：收紧 companion 白名单为「只读观察 + player-card」，或承认 companion 可代玩家操作并同步更新「按键独占」判定。

### P2 — 主动提示覆盖窄，且自动 cue 的 prompt 几乎为空

- 位置：`components/game-agent/CompanionPanel.tsx:231-270,299-321`；`lib/game-agent/companion.ts:83-92`
- 只有 battle / danger / chest 三种触发，缺剧情对话、任务点、危险机关等提示。
- 自动触发走 `ask('', cue, id)`：模型拿到的「用户请求」是空串 + `触发场景：{cue}`，而系统 Prompt 强调「最新用户请求是唯一意图来源」，结果基本靠 fallback 文案兜底，宝箱之外没有陪玩感。
- 建议：自动 cue 传入结构化当前状态摘要（场景、附近事件事实、队伍血量）作为上下文，而不是空 prompt。

### P2 — 普通陪聊生成期间输入框可输入但发送无响应

- 位置：`components/game-agent/CompanionPanel.tsx:503-506,744,770`
- `send()` 在 `running && !question && !waitingCard` 时直接 `return`，但输入框只对 `autopilot` 禁用，普通陪聊生成期间仍可交互；打字点发送会静默失败。
- 建议：普通生成期间禁用输入或给「正在回复中」提示，或改为排队发送。

### P3 — 宝箱探测用硬编码距离与 `!` 前缀，有误报 / 漏报

- 位置：`lib/game-agent/companion.ts:47-48,86`
- `distance <= 6` 与 `sprite.startsWith('!')` 均写死。火把 / 闪光点等同样以 `!` 开头且带 gold/item effect 的 object 图会被当成宝箱（`__tests__/lib/game-agent/companion.spec.ts` 中 `!Flame + gold` 被判为 chest）；反过来 `distance` 缺失或 7 格外的真宝箱又不提示。距离 6 格不感知墙 / 门隔断。
- 建议：参数化阈值，或继续按 `docs/technical/game-agent.md` §6.4 把「是否宝箱」交给模型基于事实字段判断。

### P3 — 切换旅伴角色未重置会话，存在上下文串扰风险

- 位置：`components/game-agent/CompanionPanel.tsx:173`；`docs/agent-cli-providers.md:196,220`
- `refreshStatus` 只在 `!sessionId` 时设置 `sessionId`，切换角色 / 「新对话」不清空。CLI 约定「切换角色时 contextKey 变化应新开会话」，本地 Ollama 与 CLI 两条路径是否串上下文需要验证。

## 3. 次要观察

- 陪聊仍跑满 16 步工具循环（`lib/game-agent/runtime/capabilities.ts:41-42`），回复 `slice(0,240)` 截断（`components/game-agent/CompanionPanel.tsx:263`）。
- 每个可见游戏固定 2s 轮询状态 + 2s 轮询观察（`components/game-agent/CompanionPanel.tsx:27,192,319`），CLI 实例下每次陪聊起会话耗订阅额度（`docs/agent-cli-providers.md:238`），常驻成本偏高。

## 4. 建议实施顺序

1. 修 P1：拆分 cue 冷却（尤其 `danger` 独立）；对齐 companion 工具白名单与「不可按键」契约。
2. 修 P2：自动 cue 带状态上下文；修输入框静默无响应。
3. 再议 P3：宝箱探测参数化 / 交给模型事实字段、角色切换重置会话。
