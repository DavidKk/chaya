# 能力补齐与流程可恢复技术设计

> 状态：已定稿，开发中
> 产品需求：[`../capability-supplement.md`](../capability-supplement.md)
> 范围：需求 A–H 与贯穿各项的 R；A–H 和 R 一起交付
> 版本：v1 首版，不读取旧值或旧格式，不实现迁移与兼容入口

---

## 1. 设计目标

本方案同时完成能力补齐和流程可恢复。功能成功只是一个终态；失败、取消、超时、断线、切换游戏与重载也必须进入可解释的终态，并释放页面 busy、ext 操作锁、输入所有权、订阅和计时器。

硬约束：

1. 写命令有稳定请求 ID，并在执行宿主去重。
2. 所有异步等待有有限期限；浏览器原生目录选择器是唯一无法主动取消的例外，但只锁自身入口。
3. 页面状态绑定 `gameId + generation`，旧连接的迟到结果不能修改新状态。
4. ext 是游戏内写操作、地图撤销栈和帮玩任务的权威宿主；网页状态可随时由快照重建。
5. Chaya 不执行静态分析无法证明安全的事件脚本，不在游戏帧回调中做无上限同步工作。
6. 第三方脚本已冻结 JavaScript 主线程时无法在线恢复；重载后必须清除运行锁，并把任务恢复为 `interrupted`。

不做：旧值别名、旧存储迁移、双运行时兼容层、后台静默重放失败写命令。

---

## 2. 总体架构

```text
Web / local console                         Game ext
┌─────────────────────────┐                ┌──────────────────────────┐
│ 页面状态 + generation   │                │ 权威操作状态             │
│ RecoverableRequest      │── GameLink ──▶│ IdempotencyCache         │
│ Host Agent adapter      │── local bridge│ MapOperationCoordinator   │
│ FSA / local API adapter │◀── snapshot ──│ AgentRuntime + adapters   │
└─────────────────────────┘                └──────────────────────────┘
           │                                           │
           └──── Node API / fs.promises ───────────────┘
```

新增纯约定放在 `lib/`；有 I/O 的服务实现放在 `services/`；游戏进程实现放在 `plugins/`。建议落点：

| 职责                           | 落点                                                    |
| ------------------------------ | ------------------------------------------------------- |
| 请求期限、代次、终态与幂等类型 | `lib/runtime/recoverable-operation.ts`                  |
| GameLink 消息                  | `lib/runtime/game-link-protocol.ts`                     |
| 浏览器 FSA 能力与有界读取      | `lib/browser/fsa.ts`、`lib/browser/game-data-reader.ts` |
| 热键同步纯规则                 | `lib/game/hotkeys-sync.ts`                              |
| 本机离线存档读取               | `services/game-saves/offline-list.ts`                   |
| 地图操作协调与撤销             | `plugins/src/cheat/session/map-operations/`             |
| Agent 共享核心                 | `lib/game-agent/runtime/`                               |
| Agent ext 宿主                 | `plugins/src/agent/runtime/`                            |
| Agent Node 宿主                | `services/game-agent/runtime-host.server.ts`            |
| Agent 浏览器宿主               | `components/game-agent/runtime-host.ts`                 |

手写文件目标不超过 600 行；协议、存储、状态机和宿主适配器分别成文件。

---

## 3. R · 可恢复操作底座

### 3.1 操作身份

不强制所有业务共用同一种消息，但语义统一：

```ts
type OperationIdentity = {
  requestId: string
  gameId: string
  generation: number
  deadlineAt: number
}

type OperationState =
  | { state: 'idle' }
  | { state: 'running'; requestId: string; startedAt: number }
  | { state: 'completed'; requestId: string }
  | { state: 'failed' | 'cancelled' | 'disconnected' | 'unknown'; requestId: string; reason: string }
```

- `requestId`：调用方生成 UUID。写操作执行端缓存结果到 `max(deadlineAt + 10 分钟, completedAt + 10 分钟)`；上限 1000 条，未过期结果不得为接收新请求而提前淘汰，容量已满时拒绝新写请求。重复 ID 返回原结果。
- `generation`：页面每次换游戏、换数据源、断线或主动重连递增。回调先比较代次，再更新 UI。
- `deadlineAt`：跨端传递绝对期限；执行端按对应操作的硬上限再次截断，不能信任调用方传入无限期限。收到已过期请求时不开始写操作。
- `finally`：调用端清 pending；执行端释放业务锁。不能只依赖网络回复释放锁。

现有 `edit.cmd.cmdId`、`assist.cmd.reqId`、`saves.cmd.reqId` 保留字段名，只补齐同一语义。Agent 新协议统一用 `requestId`。

### 3.2 超时与取消

默认上限：

| 操作                       |                        上限 | 超时行为                                          |
| -------------------------- | --------------------------: | ------------------------------------------------- |
| 普通 GameLink 命令         |                       10 秒 | 查询一次权威状态；未知则显示失败，不重放写命令    |
| 传送、存读档、单条地图操作 |                       60 秒 | 请求取消；无法确认时标记 `unknown` 并停止后续批量 |
| FSA / 本机数据文件读取     |                单文件 20 秒 | 跳过该文件并允许重试                              |
| IndexedDB 事务             |                       10 秒 | abort 事务并退化或重试                            |
| 模型请求                   | 使用平台配置，硬上限 120 秒 | Agent 失败或进入规定的服务等待态                  |
| 视觉处理                   |                       10 秒 | 跳过本次视觉，继续纯状态观察                      |
| 首次 Agent 授权            |                       60 秒 | 不创建任务                                        |

`Promise.race` 只结束调用方等待，不代表底层已取消。写操作必须满足下列之一后才能继续队列：执行端确认取消、查询到最终结果、或停止当前批次并标记结果未知。

### 3.3 状态校准与清理

- ext 暴露 `operation.status`、`agent.task.status` 和最新序号；页面订阅断开后先查状态再恢复按钮。
- 自动重连最多 5 次，退避 1/2/4/8/16 秒；之后进入 `disconnected`，只保留手动重连。
- 一键清理先清页面 pending、busy、计时器和订阅，再尽力发送 ext stop/clear。重连后再次查询并清理 ext 权威状态。
- 页面卸载不停止允许后台继续的 Agent 帮玩任务，但停止其他页面私有读取和同步操作。

### 3.4 主线程预算

- JSON 文件先 `stat` / `File.size`，单文件上限 64 MiB、单次索引总量上限 512 MiB；超过上限显示该文件不可读，不进入 `JSON.parse`。
- 浏览器地图 JSON 在 Worker 解析；索引构建每批最多 8 张地图后让出事件循环。
- canvas 最大边长沿用 `AGENT_SNAP_MAX_WIDTH=1280`，使用异步 `toBlob`；不在 RPG Maker `update` 回调内编码。
- Chaya 循环必须有计数或时间上限。第三方同步死循环只能通过游戏重载恢复。

---

## 4. A · 命名替换

联合类型先改，随后改字符串调用点：

```ts
type BuildTarget = 'server' | 'cloud' | 'dev'
type ServiceMode = 'local' | 'app' | 'remote'
type RuntimeLane = 'local' | 'remote'
```

实施顺序：

1. 修改 `next.config.ts`、`lib/service-mode/`、`lib/platform/` 的类型和解析。
2. 非空非法 `CHAYA_SERVICE` 抛配置错误；未设置使用本版默认值；`VERCEL=1` 和 cloud 构建强制 `remote`。
3. 重命名 `build:cloud`、`check:cloud`、`scripts/check-cloud-build.mjs`。
4. 修改 API、前端类型、测试夹具和文档。
5. 搜索旧形态代号与旧脚本名；仅保留 Microsoft Edge 浏览器名与平台环境变量 `VERCEL`。

构建失败是明确终态，不允许非法配置静默落到有磁盘权限的模式。

---

## 5. B–C · 浏览器能力与地图授权读盘

### 5.1 能力状态

`lib/browser/fsa.ts` 增加纯检测：

```ts
type DirectoryCapability = { state: 'available' } | { state: 'insecure' } | { state: 'unsupported' } | { state: 'blocked'; reason: string }
```

只在 `remote` 浏览器模式使用。原生 picker Promise 不加伪超时：pending 时只禁用当前按钮；切页或 generation 变化后，返回的 handle 直接丢弃。

### 5.2 授权目录存储

沿用 `lib/browser/cloud-library.ts` 的 IndexedDB handle：

- `queryPermission(read)` 为 `granted`：直接读取。
- `prompt` 或无 `queryPermission`：显示重新授权，点击后调用 `requestPermission`。
- `denied`：显示未授权，不自动再次弹窗。
- `SecurityError`：转换为页面环境禁止提示。

授权操作只恢复 handle，不自动执行此前失败的写命令。

### 5.3 数据读取

`game-data-reader.ts` 接收 `FileSystemDirectoryHandle` 与 `AbortSignal`，读取 `MapInfos.json`、`CommonEvents.json`、`System.json` 和按需地图文件。解析复用 `lib/game/events/`，不复制解释逻辑。

缓存键为 `gameId + 文件名 + size + lastModified`。结果带 generation；游戏连接后递增代次并切回游戏数据源。单图失败记入 `mapsFailed`，不失败整页。

高风险验证：读取中切游戏、授权 picker 悬挂、Worker 超时、游戏中途连接、旧结果迟到。

---

## 6. D · 快捷键双向同步

### 6.1 数据模型

全局表与暂停列表是一个版本域，本游戏覆盖按游戏独立：

```ts
type HotkeySyncSnapshot = {
  version: 1
  global: { revision: number; bindings: HotkeyMap; disabled: string[] }
  game: { gameId: string; revision: number; bindings: HotkeyMap | null }
}
```

网页全局键一个，本游戏键按 `gameId`；ext 全局副本和游戏副本写入游戏侧 v1 文件或 localStorage。只读取该格式。

### 6.2 协议与合并

在 `GameLinkMessage` 增加：

- `hotkeys.cmd(snapshot, expectedGlobalRevision, expectedGameRevision, reqId)`
- `hotkeys.reply(reqId, snapshot | error)`
- `hotkeys.changed(snapshot)`

全局和游戏域分别比较 revision；一个域更新不抬高另一个域。相同 revision 内容不同由游戏侧胜出，并推回网页。网页保存使用 compare-and-set；收到 stale 后取快照，将本次字段修改重放到新底稿并各自 `+1`，最多重试一次。

应用前执行结构、目标 ID、按键和唤出键校验。坏表不应用、不改变 revision；同步失败只显示提示，局内继续使用最后有效表。唤出键最终经 `resolveOpenPanelChord` 回落反引号。

插件删除 `persist.ts` 中“覆盖等于全局即不存在”的推断，显式 `null` 才表示没有本游戏覆盖。

---

## 7. E · 本机离线存档列表

新增管理会话专用只读 API：

```text
GET /api/game-saves/offline?libraryId=<id>
```

路由使用 `requireDisk` 且拒绝启动令牌。服务端从游戏库解析可信游戏根，不接受客户端传任意路径。

`offline-list.ts` 用 `fs.promises` 并行读取：

1. 游戏目录 `chaya/saves/index.json`。
2. 本机目录中 library id 与规范化 `path:<gameRoot>` 两个候选。

不修复、不写回索引。每个来源独立返回 `{ status, reason, entries }`。本机两个 ID 的同一位置按 `place + entry.id` 去重，保留 `savedAt` 较新的条目；时间相同时 library id 优先。缩略图通过单独受限路由按来源和 entry id 获取，不在列表内批量 base64。

页面使用所选游戏 ID 作为 generation。连接游戏时 abort 离线请求并切回在线快照；迟到结果忽略。任一来源失败不影响设置区和另一张卡片。

---

## 8. F–G · 地图撤销与批量

### 8.1 ext 操作协调器

`MapOperationCoordinator` 是所有网页和浮层共享的唯一写入口：

```ts
type MapOperationStatus = {
  operationId: string
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  kind: 'single' | 'batch' | 'undo'
  completed: number
  failed: number
}
```

同一游戏同时只运行一个 single/batch/undo。锁在 `try/finally` 释放，近期操作结果缓存 200 条。页面锁只反映权威状态，不参与互斥。

### 8.2 撤销记录

每步存 `{ summary, before[], after[], reversibleScope }`，最多 10 步。写操作完成后读回实际值作为 `after`，只有确认成功的项入栈。批量成功项合为一步。

撤销前比较 current 与 after；冲突返回差异，由调用方确认后带同一 operation id 继续。部分失败时，已成功还原项从步骤移除，未还原项保留为剩余步骤，允许重试或明确放弃。

触发自动事件后的脱困撤销可在解释器 / 对话运行时先还原触发开关、变量和独立开关；位置传送仍等安全场景。当前对话结束后不再进入下一轮。

### 8.3 事件安全分析

在 `lib/game/events/` 增加 `analyzeExecutionSafety`：

- 展开公共事件调用，最大深度 8、最多 128 个唯一事件；递归视为不安全。
- 明确的无条件循环 / 回跳视为不安全。
- 脚本和插件命令视为不透明，不允许由 Chaya 的“执行 / 开启 / 满足条件”入口启动。
- 关闭触发条件始终允许。

这是预防主线程硬冻结的门禁，不提供运行后强杀解释器。

### 8.4 批量

最多 50 项，按列表顺序。每项执行前重新检查地图、对话、传送和操作锁。某项启动自动事件后停止剩余项。单项超时只有在确认取消或查到终态后才继续；否则整批以 unknown 结束。

断线不由网页擅自释放 ext 锁；ext 自行收尾并保存状态。网页重连查询 `operation.status` 后恢复。

---

## 9. H · Agent 共享运行时

### 9.1 核心与宿主

`lib/game-agent/runtime/` 只依赖接口：

```ts
type AgentHost = {
  model: ModelAdapter
  tools: ToolAdapter
  store: SessionStore
  events: EventSink
  clock: Clock
}

runAgentTurn(host, capability, input, signal): Promise<TurnResult>
```

能力配置是数据，不分叉循环：`play`、`ask`、`companion`。Node、browser、ext 只实现 adapter。现有 `managed-turn.server.ts` 的目标、战斗、无进展和验证逻辑逐段移入纯核心；迁移验收后删除旧托管循环、`turn-runner.server.ts`、`browserTurn.ts` 和重复旅伴请求实现。

工具在 adapter 注册后还必须经过 capability 白名单：`play` 只有观察与游玩输入，不含 edit / eval / 任意插件写工具；`ask` 删除所有按键 / 移动工具，明确写操作继续走现有确认规则；`companion` 只读。白名单默认拒绝，新增工具未归类时不会自动暴露。

| capability  | 宿主                 | 工具与上限                                                                                   |
| ----------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `play`      | 仅 ext               | 现有观察 / 游玩白名单；每轮 80 步、60 次操作、连续 3 次无进展后重置本轮并继续，直到玩家 Stop |
| `ask`       | Node、browser 或 ext | 当前宿主 MCP；无按键 / 移动；最多 8 次工具调用                                               |
| `companion` | 仅 ext               | 只读游戏状态；单轮短回复                                                                     |

每轮由 adapter 获取当时可用工具，再经 capability 过滤。未连接游戏时控制台 ask 只给 `library/game/translate/cache/logs`；连接后加入 `live/edit`，其中按键类仍被 ask 白名单删除。`classifyGameIntent` 只负责在统一输入中选择 play 或 ask，不影响白名单。每个游戏最多一个非终态 Agent 任务，play、ask、companion 使用同一互斥判断。

### 9.2 ext 任务状态机

```text
running ⇄ waiting_user
   ↕
waiting_service

running | waiting_user | waiting_service → completed | stopped | failed
```

- ext 是 play/companion/ext ask 的权威宿主。
- `running` 中仅 play 持有输入所有权；`waiting_user` 与 `waiting_service` 释放输入锁，但所有非终态 capability 都占该游戏唯一 Agent 任务名额。
- `waiting_user` 30 分钟没有回复进入 failed；计时器可被 stop 抢占。
- 所有终态先在 finally 中取消模型与工具、停止计时器、释放输入标记并发布终态；检查点随后异步写入且有超时，不能延迟终态可见性。
- 每次按键或写工具前再次确认 task 仍为 running。
- 运行中只接受显式 stop；旧任务进入终态前不接受新任务。

### 9.3 遥控协议

GameLink 和 local bridge 复用同一逻辑消息；`agent.task.start` 必须显式携带 `capability`、`profileId` 与 `model`，执行端不得根据入口默认成 `play`：

- `agent.task.start/reply/stop/status/clear`
- `agent.task.events { taskId, afterSeq }`
- `agent.config.put`

开始、回复、停止带 requestId 并幂等。每任务事件 seq 单调递增，内存保留最近 200 条；缺口返回 `history.gap + snapshot`。终态订阅丢失时客户端查询 status。

浏览器 GameLink 继续使用 `CHAYA_LINK_TOKEN` 配对信令。普通 `/agent` 命令保留 `AGENT_LINK_METHODS` 白名单；任务消息使用独立的精确类型白名单，只接受 `agent.task.start/reply/stop/status/events/clear/classify` 与 `agent.config.put`，不得把 `agent.task` 加进普通命令白名单来绕过授权。首次远程 play 另做游戏内同进程授权。授权拒绝、断线或 60 秒超时均不创建任务。

### 9.4 会话与跨宿主合并

```ts
type ConversationRef = { conversationId: string; gameId?: string }
type ConversationItem = {
  id: string
  conversationId: string
  origin: 'console' | 'game'
  originSeq: number
  createdAt: number
  taskId?: string
  payload: unknown
}
```

- 控制台创建的 play 请求把 `conversationId` 传给 ext；ext 将目标、进展和终态写入同一引用。
- local 控制台记录存 `data/game-agent/conversations/`；remote 控制台记录存 IndexedDB。游戏侧只负责 ext 发起的对话和 play/companion 任务记录。
- 页面打开后按 `conversationId` 拉取 ext 的 `afterSeq`，以 item id 幂等写入控制台存储。展示可按 `createdAt` 排序，但去重和续读只使用 `origin + originSeq/id`，不依赖两宿主时钟完全一致。
- ext 侧栏发起的对话先使用游戏侧 conversation；控制台连接后将其作为独立会话展示，不擅自并入另一段对话。
- 后续 ask 组装上下文时读取已落盘的问答消息和已同步的 play 目标、摘要与终态，不把未同步的临时 UI 文本当作上下文。

### 9.5 模型与配置

- local/app ext 经本机模型代理；API token 只在服务端。
- remote ext 直连模型；网页通过已配对 GameLink 下发 remote 配置。配置写入游戏侧专用文件 / IndexedDB，不写会话日志；只有玩家显式重置 Agent 配置时删除。
- 工具能力不能确定时允许首轮尝试；明确不支持时失败。
- local 模型代理不可达进入 `waiting_service` 子阶段，60 秒内重试，不消耗步骤；超时进入 failed。

启动令牌存 `data/runtime/launch-tokens.json`，以原子写入并在 POSIX 上设置 `0600` 权限，记录游戏身份、issuedAt、lastSeenAt。服务启动先加载；心跳至多每分钟持久化一次 lastSeenAt；24 小时无活动或游戏明确退出时撤销。Agent 一键清理不得删除启动令牌或用户配置，只删除 Agent 任务与会话运行标记。写入失败时明确降级为不支持跨服务重启。

### 9.6 持久化、过程事件与预算

ext 会话 v1 存游戏 `chaya/agent/` 或 IndexedDB。最多 20 个、7 天。创建任务先尝试初始检查点，10 秒超时后退化内存并显示不能跨重载恢复。后续写入节流且不阻塞运行。

恢复时 running / waiting 状态一律改 `interrupted`，不占任务名额。损坏文件跳过。上下文压缩失败时保留目标、边界与最近 5 次观察，截断更早内容。

过程事件只输出目标、阶段（观察 / 思考 / 操作 / 验证 / 等待玩家 / 等待本机服务）、步数、工具摘要、每轮公开进展摘要和停止原因，不输出内部思维链。play 的单轮 `answered` / `limit` / `no_progress` 结果映射为 `progress.updated`，等待一个可取消的短间隔后重新观察；模型明确不支持必需工具时进入 failed，避免无效循环。正常挂机只有 stop、failed 或 interrupted 才结束。`ask` 在 local 服务重启或 remote 页面关闭时中断并写一条 interrupted；play/companion 生命周期仍跟 ext。

视觉使用异步 canvas adapter；超过尺寸、时间或频率预算就跳过本次视觉，不阻塞停止。

---

## 10. 失败与恢复矩阵

| 场景                 | 权威端            | 终态 / 恢复                                      |
| -------------------- | ----------------- | ------------------------------------------------ |
| picker 长期 pending  | 浏览器            | 只锁 picker；代次变化后丢弃结果                  |
| FSA / fs / IDB 超时  | 当前 I/O 宿主     | 失败或降级，释放页面 loading                     |
| 页面切换游戏         | 页面 generation   | 旧结果丢弃，新游戏独立加载                       |
| GameLink 断开        | ext               | 页面 disconnected；ext 操作按业务收尾            |
| 批量单项结果未知     | ext               | 停止剩余，保留已确认撤销记录                     |
| 自动事件进入对话循环 | ext undo          | 先还原触发条件，当前段结束后退出循环             |
| 模型请求挂起         | ext/控制台宿主    | 超时或 stop；迟到结果丢弃                        |
| 终态事件丢失         | ext status        | 页面查询并校准终态                               |
| 本机服务重启         | ext + token store | 60 秒内恢复；超时 failed 并释放锁                |
| 游戏 F5 / 热更新     | 持久化            | 重开标 interrupted，清输入锁                     |
| 第三方同步死循环     | 游戏主线程        | 宿主重载；重开清锁，Chaya 不主动启动已知风险事件 |

---

## 11. 实施顺序

1. R 底座与 A 改名：先确定协议公共语义和新类型。
2. B/C：FSA 状态、Worker 读盘、generation 切源。
3. D/E：热键 CAS 同步和只读离线列表。
4. F/G：ext 操作协调器、事件安全分析、撤销与批量。
5. H1：共享核心和 ext adapter，先跑通 play。
6. H2：ext/local/remote 遥控、配置和模型代理。
7. H3/H4：持久化、续读、状态校准、视觉与过程 UI。
8. 三宿主验收通过后，同一提交删除 Agent 旧循环。

每步同时交付对应 R 测试，不接受先写功能、最后统一补超时。

---

## 12. 测试与门禁

### 12.1 单元测试

- recoverable operation：超时、abort、generation、重复 requestId、迟到终态。
- hotkeys：两个 revision 域、相同版本冲突、stale rebase、非法唤出键。
- events：递归、无条件循环、脚本 / 插件命令、安全关闭条件、部分撤销。
- saves：双 gameId 合并、索引损坏、缩略图缺失、路径越界拒绝。
- Agent：状态机、stop race、replace race、waiting_user 解锁、event gap、恢复 interrupted。

### 12.2 集成测试

- GameLink 重复包、乱序终态、断线重连、状态查询。
- FSA picker pending 后切游戏；Worker 和 IDB 人为挂起。
- 批量第 N 项超时、自动事件启动、网页断线。
- 模型流不结束时 stop；终态 SSE / DataChannel 包丢失。
- 本机服务重启前后 launch token 可用与 60 秒超时。

### 12.3 构建与人工回归

```text
pnpm format
pnpm lint
pnpm typecheck
pnpm build:cloud
pnpm check:cloud
pnpm ok
```

人工覆盖 local、app、dev Cloud 和实际 cloud；逐条执行需求 §11 的正常验收与 N1–N25。性能验收记录固定存档下的基线与 Agent 运行时 P95 帧时间；目标为 P95 增幅不超过 20%，且无超过 100 ms 的 Chaya 同步任务。

---

## 13. 完成判定

以下条件缺一不可：

1. A–H 正常能力通过。
2. N1–N25 恢复场景通过。
3. 页面不存在无法通过超时、断线、本地清理或重载退出的 Chaya 中间态。
4. ext 不残留操作锁、输入标记或运行任务假状态。
5. Agent 旧运行时已删除，三个宿主使用同一核心。
6. 代码与文档只使用 v1 新名称和格式。
