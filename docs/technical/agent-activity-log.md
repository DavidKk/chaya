# Agent 活动记录技术方案

> 状态：已实现
> 日期：2026-10-09
> 需求：[`../agent-activity-log.md`](../agent-activity-log.md)
> 关联：[`game-agent.md`](./game-agent.md)、[`game-assistance.md`](./game-assistance.md)

## 1. 决策

扩展现有可恢复 `AgentTask` 事件流，将它作为 Agent 活动的唯一事实源。运行 Host 在行为发生处写结构化事件；侧栏、陪玩面板、日志页通过同一查询与事件流构建不同视图。不会把 Agent 活动复制到通用文本日志，也不会建立第四套浏览器状态。

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

`AgentTask` 增加入口 `surface`、累计 `usage`、持久化警告和最近公开活动摘要。旧数据不做迁移或兼容分支，第一版直接使用新结构。

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
  → task store（Node 文件 / browser localStorage）
```

- 模型适配器返回 `{ message, usage }`，Ollama 从流的最终 NDJSON 项映射 `prompt_eval_count` 与 `eval_count`。
- 工具计时在 Host 调用边界完成，确保失败和取消也写结束事件。
- `runTurn` 只能生成基于阶段和已知结果的公开摘要，不复述模型隐藏 reasoning 字段。
- 持久化采用现有节流 checkpoint；终态、提示词和工具完成事件立即 checkpoint。
- 存储失败被转为内存 warning 事件并限频，运行循环不等待无限重试。

## 5. API 与恢复

- 现有 `agent.task.status` 与 `agent.task.events` 继续作为插件内权威接口。
- 增加服务端 Agent 活动列表/详情 Route Handler，路由只校验查询参数并委托 `services/game-agent/`。
- 列表返回已连接游戏中的任务记录；传入 `gameId` 与 `taskId` 时返回单个任务详情。GET 明确动态、不缓存。
- 游戏内侧栏和陪玩面板继续通过 launch-token request adapter 访问相同数据；日志页在本机模式查询已连接游戏的任务。
- 客户端以 `(taskId, seq)` 去重。发现 `gap` 时展示历史缺口，不重置为 loading。

## 6. UI 组件

新增共享功能组件：

- `AgentActivityTimeline`：渲染阶段、公开摘要、工具、用量、警告与终态；工具详情使用可展开行。
- `AgentActivityLogPanel`：负责定时加载、任务选择、空态、错误态和详情滚动。

侧栏把当前回复的活动绑定到 task id。运行中展开；终态和正文出现后默认折叠。陪玩面板复用 `AgentActivityPanel`，用现有 Tab/分段导航切换聊天与活动。日志页通过 `view=runtime|agent` 查询参数切换二级页面，保留各自筛选参数。

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
