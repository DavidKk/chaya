# Agent 活动记录技术方案

> 状态：v2 核心所有权与持久化模型已实现；跨领域索引与完整多实例信令按后续迭代推进
> 日期：2026-10-09 · 方案修订：2026-10-13
> 需求：[`../agent-activity-log.md`](../agent-activity-log.md)
> 关联：[`game-agent.md`](./game-agent.md)、[`game-assistance.md`](./game-assistance.md)

## 1. 决策

扩展现有可恢复 `AgentTask` 事件流，将它作为 Agent 目标、公开决策、工具调用与任务结果的权威来源。游戏事实由插件事件流负责；查询层按关联 ID 将多源事件投影为统一活动时间线，不在写入层复制事件。侧栏、陪玩面板和日志页复用同一查询结果。

只记录可公开的活动摘要。原始隐藏推理不进入协议、存储和 UI。

## 2. 数据契约

在 `lib/game-agent/` 增加无 I/O 的活动契约和脱敏器，运行时事件引用这些类型：

```ts
type AgentActivityKind = 'prompt' | 'model' | 'thought' | 'tool' | 'progress' | 'state' | 'warning'

type AgentThoughtSummary = {
  observation?: string
  decision?: string
  plan?: string
  result?: string
  next?: string
}

type AgentTokenUsage = {
  input?: number
  output?: number
  reasoning?: number
  cachedInput?: number
  total?: number
}
```

事件沿用 `AgentTaskEvent` 的 `seq`、`ts`、`type`、`data`。新增或扩展事件：

| 事件               | 数据                                                 |
| ------------------ | ---------------------------------------------------- |
| `prompt.recorded`  | role、content、source；写入前脱敏                    |
| `model.requested`  | provider、profileId、model、公开请求摘要             |
| `thought.updated`  | `AgentThoughtSummary`、cycle、step                   |
| `tool.started`     | callId、name、sanitized input、startedAt             |
| `tool.completed`   | callId、name、ok、sanitized output/error、durationMs |
| `model.completed`  | response、usage、durationMs                          |
| `usage.updated`    | 本次用量与任务累计用量                               |
| `progress.updated` | 周期结果、继续原因、cycle、steps、toolCalls          |

`AgentTask` 增加入口 `surface`、累计 `usage`、持久化警告和最近公开活动摘要。v1 记录保持只读兼容，由查询层映射到 v2 信封；不回写或猜测缺失身份字段。

### 2.1 v2 事件信封

```ts
type AgentAuditEvent = {
  schemaVersion: 2
  eventId: string
  taskId?: string
  taskSeq?: number
  at: number
  producer: {
    id: string
    kind: 'agent_coordinator' | 'domain_service' | 'game_plugin' | 'cloud_browser'
    domain?: AgentDomain
    epoch: number
    sourceSeq: number
  }
  execution: {
    host: 'local_service' | 'cloud_browser' | 'game_plugin'
    component: string
  }
  classification: {
    domain: AgentDomain
    type: string
    effect: 'read' | 'runtime_change' | 'configuration_change' | 'file_change' | 'external_side_effect'
  }
  targets: AgentTarget[]
  correlation: {
    conversationId?: string
    actionId?: string
    parentActionId?: string
    toolCallId?: string
  }
  outcome?: {
    status: 'started' | 'completed' | 'failed' | 'skipped' | 'rolled_back'
    reason?: string
  }
  data?: unknown
}

type SourceGameEvent = {
  schemaVersion: 2
  sourceEventId: string
  at: number
  producer: {
    id: string
    kind: 'game_plugin'
    epoch: number
    sourceSeq: number
  }
  target: {
    libraryGameId: string
    runtimeInstanceId: string
    pluginInstanceId: string
    connectionId: string
  }
  correlation?: {
    taskId?: string
    actionId?: string
    toolCallId?: string
  }
  data: unknown
}
```

`AgentDomain` 至少包含 `game_runtime`、`game_launch_configuration`、`game_content`、`game_save`、`game_library`、`plugin_management`、`translation`、`agent_configuration`、`service_configuration`、`global_configuration` 和 `system`。

任务头记录 `coordinator`、`initiatedFrom`、`primaryDomain`、`targets`。`AgentTarget` 按需携带 `libraryGameId`、`runtimeInstanceId`、`pluginInstanceId` 或其它领域稳定 ID；禁止继续让单个 `gameId` 同时表示库游戏、运行进程和插件连接。没有 Agent 任务的来源事件不强行补 `taskId`，只通过 `SourceGameEvent` 保存并按运行实例查询。

## 3. 脱敏

`sanitizeAgentActivity(value)` 在事件持久化和网络发送之前递归处理：

- key 匹配 `authorization|cookie|token|secret|password|api[-_]?key` 时值替换为 `[REDACTED]`。
- Bearer、常见密钥赋值和 URL 凭证替换为 `[REDACTED]`。
- macOS、Linux 与 Windows 绝对用户路径替换为 `<local-path>`，保留必要的文件名或相对尾部。
- 限制字符串、数组、对象深度与序列化总长度；循环引用转为说明文本。

系统提示词允许记录其非敏感正文。调用方不得把 provider token 拼入提示词。UI 展示前再次调用同一纯函数作为防御。

## 4. 写入链路

```text
用户入口
  → AgentTaskController.start（写 prompt / task metadata）
  → RuntimeHost.complete（写 system/user prompts、model.requested）
  → model adapter（返回 message + usage）
  → runTurn（写公开 thought、tool started/completed、model.completed）
  → controller.emit + checkpoint
  → task store（App/local 文件 / Cloud IndexedDB）
```

- 模型适配器返回 `{ message, usage }`，Ollama 从流的最终 NDJSON 项映射 `prompt_eval_count` 与 `eval_count`。
- 工具计时在 Host 调用边界完成，确保失败和取消也写结束事件。
- `runTurn` 只能生成基于阶段和已知结果的公开摘要，不复述模型隐藏 reasoning 字段。
- 持久化采用现有节流 checkpoint；终态、提示词和工具完成事件立即 checkpoint。大体积轨迹不得写入 `localStorage`。
- 存储失败被转为内存 warning 事件并限频，运行循环不等待无限重试。
- Agent 协调服务只写 Agent 任务事件；游戏配置、插件管理、存档、翻译和 Agent 设置的审计由对应领域服务写入。游戏运行事实只由游戏插件生产。服务端托管回路不会把 `player.moveTo` 的返回值直接伪装成 `navigation.completed`；只有插件运行时确认后才进入游戏事实流。
- 本地服务和 Cloud 页面可以作为插件事件的存储代理，但写入时不得替换 `producer`，也不能根据工具返回补造游戏事件。

## 5. API 与恢复

- 现有 `agent.task.status` 与 `agent.task.events` 继续作为插件内权威接口。
- 增加服务端 Agent 活动列表/详情 Route Handler，路由只校验查询参数并委托 `services/game-agent/`。
- 列表同时查询实时任务与长期存储；传入任务、库游戏、运行实例、会话或领域筛选时返回匹配记录。GET 明确动态、不缓存。
- 游戏内侧栏和陪玩面板继续通过 launch-token request adapter 访问相同数据；日志页在本机模式查询已连接游戏的任务。
- 客户端以 `(taskId, seq)` 去重。发现 `gap` 时展示历史缺口，不重置为 loading。

## 6. UI 组件

新增共享功能组件：

- `AgentActivityTimeline`：渲染阶段、公开摘要、工具、用量、警告与终态；工具详情使用可展开行。
- `AgentActivityLogPanel`：负责定时加载、任务选择、空态、错误态和详情滚动。

侧栏把当前回复的活动绑定到 task id。运行中展开；终态和正文出现后默认折叠。陪玩面板复用 `AgentActivityPanel`，用现有 Tab/分段导航切换聊天与活动。日志页复用 `SectionSideNav` 展示二级页面入口，通过 `view=runtime|agent` 查询参数切换内容，并保留各自筛选参数；窄屏完全隐藏页面内二级导航，一级与二级入口统一由右上角导航抽屉提供。

所有页面使用现有 `panelShell`、固定 Header/Body/Footer、`ScrollArea`、`EmptyState` 和加载骨架。窄屏 Tab 可横向滚动，工具 JSON 必须换行且不能撑宽面板。

## 7. 连续任务状态机

`play` 的单周期 `runTurn` 返回原因，不直接决定任务终态：

```text
answered / verified completion → progress.updated → monitoring cycle
waiting_user                 → waiting_user
cycle_limit / tool_limit     → progress.updated → delay → next cycle
unsupported / fatal          → failed
abort                        → stopped
```

每周期重新检查 `AbortSignal` 和当前任务状态。达到周期上限或当前阶段目标完成时只记录进度和下一步，进入低频监看或下一执行周期，不得写 `assistant.completed` 或 `failed`。挂机任务的正常终态只由玩家 Stop 触发。终态写入由 `AgentTaskController` 做幂等保护；SSE 映射层不得再合成相同错误正文。

全局互斥在任务控制器中按 game id 判断所有入口的非终态任务。自动陪玩提示改走 `/api/game-agent/turn`，移除已删除 `/api/game-agent/companion` 的调用路径。

## 8. 失败与降级

| 故障         | 行为                                 |
| ------------ | ------------------------------------ |
| 模型无 usage | 用量显示未知，任务继续               |
| 单次工具失败 | 写失败详情，模型可在下一步调整       |
| 单周期超限   | 写进度并继续下一周期                 |
| SSE 断开     | 任务继续，客户端按 seq 重连          |
| 持久化失败   | 内存继续、显示 warning、终态不被阻塞 |
| 事件损坏     | 跳过该事件并显示记录不完整           |
| 游戏断连     | 任务终止并记录最后已知进度           |
| 重复终态     | 控制器忽略后续终态写入               |

## 9. 测试与验证

- 单元测试：递归脱敏、Ollama usage 映射、活动事件归并、终态幂等、周期上限继续。
- 运行时测试：prompt/system prompt、工具参数/结果/耗时、token 累计、持久化裁剪和恢复。
- UI 测试：侧栏终态折叠、陪玩双 Tab、日志双二级页、工具展开、断线恢复、重复终态抑制。
- 手工检查：桌面与窄屏无溢出；dropdown 打开仍保持面板 hover 态；点击面板与 dropdown 不透传到游戏。
- 提交前执行 `pnpm ok`，并检查 `git diff --check`、敏感字段和生成物。

## 10. 所有权、顺序与幂等

### 10.1 生产者与协调者

- Agent 协调服务为 Agent 事件分配 `taskId` 和任务内 `taskSeq`，负责任务时间线投影排序，不因此成为游戏事实生产者。
- 各来源先生成自身稳定 `sourceSeq`。插件来源事件键为 `pluginInstanceId + producerEpoch + sourceSeq`，Agent 任务事件键为 `taskId + taskSeq`。来源事件进入某个任务时间线后才获得可重建的 `taskSeq`，原始 `sourceSeq` 永不改变。
- 同一来源键和相同内容重复到达时返回幂等成功；同一键内容不同则拒绝，产生技术诊断 `GAME_LOG_EVENT_CONFLICT`。
- 插件重启增加 `producerEpoch`。同一 `pluginInstanceId` 只允许一个活动 writer lease；新 `connectionId` 接管后旧租约不可续写。
- 聚合、筛选和排序只发生在查询/UI 层。存储层不把游戏事件复制为 Agent 事件，也不把 Agent 事件复制到领域审计日志。

### 10.2 跨服务动作

协调者为用户意图生成 task，为每个目标和实际执行步骤生成 action。领域服务事件引用 `taskId`、`actionId`、`parentActionId` 和可选 `toolCallId`。批量任务只持久化一份任务，多个目标分别报告结果；聚合终态支持 `partially_completed`。

例如“当前立即全屏，而且以后启动也全屏”包含两个 action：游戏配置服务审计 `libraryGameId` 的持久配置变化，插件记录 `runtimeInstanceId` 的当前窗口变化。两条事件不能互相代写。

## 11. 存储布局与索引

App / local 使用追加文件：

```text
logs/
  agent-activity/tasks/{taskId}.events.jsonl
  agent-activity/tasks/{taskId}.summary.json
  game-activity/{libraryGameId}/{runtimeInstanceId}/events.jsonl
  service-audit/{domain}/events.jsonl
  runtime/{component}/events.jsonl
  indexes/by-domain/
  indexes/by-library-game/
  indexes/by-runtime-instance/
  indexes/by-conversation/
```

索引是可重建派生数据，不是第二份事实源。插件只通过事件上报协议提交 `SourceGameEvent`，不直接打开日志文件；本地服务是本地文件的唯一物理 writer，Cloud 页面是 IndexedDB 的唯一物理 writer。文件追加使用各领域独立 writer 队列和原子 summary 替换，避免插件与服务同时竞争同一文件。

Cloud 使用 IndexedDB，至少包含 `tasks`、`events`、`targets`、`sourceEvents` 四个 object store。组合索引覆盖 `(taskId, taskSeq)`、来源唯一键、`libraryGameId`、`runtimeInstanceId`、`conversationId` 和 domain。`sourceEvents` 可以没有 task 关联，必须按运行实例和来源序号独立查询。升级失败保留旧库只读访问，并显示不可持久化警告；不回退到 `localStorage`。

## 12. 查询、导出与迁移

- 查询服务按任务 `taskSeq` 合并 Agent 事件与已关联的来源事件；未能关联的游戏事实仍可按运行实例查询，不做时间近似归因。投影排序不改变来源事件的 `sourceSeq`。
- 本地 MCP 的 `chaya_logs_query` 在 `view="agent"` 时直接查询文件归档；Cloud WebMCP 复用同名工具从当前页面 IndexedDB 查询。两者返回相同的任务摘要 / 事件投影，默认 `view="runtime"` 保持原有服务与插件日志行为。Agent 查询只读、按 `limit` 截断，并在返回前再次脱敏。
- JSONL 导出保留 schema version、producer、execution、classification、targets 和 correlation，导出前再次脱敏；`secret` 永不落盘，`sensitive` 默认遮盖。
- v1 事件读取时映射现有 `gameId` 到兼容 target，并标记 `identityIncomplete=true`；无法确认的 `runtimeInstanceId` 或 producer 不补默认值。
- 新写入一律使用 v2。迁移可以生成索引和摘要，但不原地重写历史 JSONL；需要回滚时继续以 v1 只读方式打开。
- 100 MB 保留上限按所有长期日志总量计算；达到上限时只清理最旧的已结束任务及其可删除的关联投影，不删除未归因的运行实例来源事件，除非用户按运行实例明确清理。删除 Agent 任务不会默认删除独立游戏来源事件。

## 13. v2 补充验证

- 并发测试：同游戏多运行实例、多插件连接、新租约接管、旧租约拒绝和来源序号重试。
- 冲突测试：相同唯一键相同内容幂等，相同键不同内容产生 `GAME_LOG_EVENT_CONFLICT` 且原事件不被覆盖。
- 所有权测试：工具成功不生成游戏事实；只有插件确认后时间线才出现游戏结果。
- 存储测试：本地多领域并发追加不互相覆盖；Cloud IndexedDB 升级、容量失败、刷新恢复和 JSONL 导出。
- 关联测试：跨服务、多目标和部分成功任务只保存一份任务，并能按库游戏、运行实例、会话和领域查询。
