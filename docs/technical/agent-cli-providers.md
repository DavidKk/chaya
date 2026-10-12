# Agent 实例接入 Cursor / Codex / Claude / Gemini 技术方案

> 状态：待开发（方案评审稿）
> 日期：2026-10-11 · 二次评审：补对话上下文（§7.12）、授权变更收尾（§6.8）、多进程锁（§6.9）、Run 鉴权与归属（§7.1）、网页询问工具对齐（§7.4）、无进展 / 截断 / 阶段事件（§7.3）、Cursor 本机配置隔离与系统 Prompt 投放（§5.2）、并发上限与进程树（§5.5）
> 需求：[`../agent-cli-providers.md`](../agent-cli-providers.md)
> 基线：[`game-agent.md`](./game-agent.md)（Agent 配置、Turn Runner、事件）、[`game-assistance.md`](./game-assistance.md)（托管运行策略）、[`integration-mcp.md`](./integration-mcp.md)（本机 MCP）
> 参考实现：工单系统 `~/Develop/sl-ai/ticket-janitor`（文件位置见需求 §11）

## 1. 决策

1. **CLI 跑完整一轮，工具走 MCP**。四个 CLI 都是自带工具循环的 Agent，不提供单步补全接口；本机服务为每个 CLI 会话挂一个会话专用的 Chaya MCP 端点。
2. **任务归属不变，只替换「模型」这一段**。游戏内任务仍由插件 `AgentTaskController` 管理；CLI 发来的工具调用由本机服务**转交回任务归属方执行**。输入占用、玩家卡片、操作确认、停止后拒绝执行全部沿用现有实现，不在服务端重写。
3. **插件与服务之间只用短请求和长轮询**。桌面游戏（`file://`）里 `chayaFetch` 走 Node `http` 兜底，会把整个响应缓冲完才返回，读不了流式响应。CLI 运行和授权进度都用「发起 + 长轮询」，模式同 `services/runtime/agent-bridge.ts` 的 `pollAgentCommands`。
4. **会话可跨轮复用**。托管周期与旅伴陪聊复用同一个 CLI 会话，所以 MCP 端点和令牌绑定会话，不绑定单轮；每轮开始时把「本轮」挂到会话上，没有进行中的一轮时拒绝所有工具调用。
5. **授权按类型二选一**：Cursor 用本机登录（只检测、登录与退出，不碰凭证）；Codex / Claude / Gemini 用远程授权，凭证由 Chaya 加密保管，运行时解密到临时目录。
6. **每个远程授权实例只有一份运行时凭证目录**。refresh token 会轮换，同一实例的两份明文副本各自刷新时，后刷新的那份会拿着已作废的 refresh token 失败。同一进程内的并发会话共享一份目录（引用计数），最后一个会话释放时回写并删除。
7. **同步结构不分叉**。CLI 类型沿用现有 `AgentSyncProfile` 字段（Ollama 专属字段存默认值、运行时忽略），只放宽 `provider` 校验；旧插件由服务端过滤后照常同步（§4.3）。

## 2. 总体架构

```text
游戏内面板（旅伴 / Agent 侧栏 / 托管）            Chaya 网页侧栏（询问）
  │ direct-request → 插件任务控制器                 │ POST /api/game-agent/turn
  ↓                                                ↓
plugins/src/agent/runtime/host.ts                 services/game-agent/turn-runner.server.ts
  │ Ollama：completeFor → /api/game-agent/model    │ Ollama：runAgentTurn + streamOllamaChat
  │ CLI：cli-run.ts                                │ CLI：runCliAskTurn
  │   POST   /api/game-agent/cli/runs              │   （进程内直接调用 CLI Run，不走 HTTP）
  │   POST   /api/game-agent/cli/runs/:id/poll ←───┼── 事件 + 待执行的工具调用（长轮询）
  │   DELETE /api/game-agent/cli/runs/:id          │
  ↓                                                ↓
services/game-agent/cli/
  ├─ run-registry      CLI Run：本轮绑定、事件队列、工具调用转交、上限、存活检测
  ├─ session-pool      CLI 会话：创建、复用（托管 / 陪聊）、空闲关闭
  ├─ mcp-bridge        会话 MCP 端点：令牌校验、tools/list、tools/call → 当前 Run
  ├─ acp-session       ACP 会话（Cursor / Claude / Gemini）
  ├─ codex-session     Codex SDK 会话
  ├─ auth/             Cursor 本机登录、远程授权适配器、授权尝试
  └─ credentials/      密文存储、运行时目录、刷新回写、Claude 钥匙串搬运
        │
        ├─ 子进程：agent acp / claude-agent-acp / gemini --acp / codex
        │     └─ HTTP → /api/game-agent/cli/mcp/:sessionId（Bearer 会话令牌）
        └─ 工具执行：游戏内任务 → 转交插件；网页询问 → executeGameAgentTool
```

## 3. 模块落点

新增文件都控制在 600 行内；超出按 `$chaya-structure` 再拆。

```text
lib/game-agent/
  providers.ts                     # GameAgentProvider、isCliProvider、类型元数据（授权方式、显示名、CLI 名）；前后端与插件共用
  cli-run-protocol.ts              # CLI Run 请求 / 轮询 / 事件类型与校验；插件与服务共用

services/game-agent/cli/
  resolve-cli.server.ts            # 复用 services/integration/mcp-clients.ts 的 findCli；版本探测与缓存
  session-pool.server.ts           # CliSession 接口、复用键、空闲关闭、进程退出清理
  acp-session.server.ts            # @agentclientprotocol/sdk 客户端：initialize / session/new / prompt / cancel / 权限
  acp-providers.server.ts          # Cursor / Claude / Gemini 的启动命令、环境变量、内置工具关闭参数
  codex-session.server.ts          # @openai/codex-sdk：startThread / resumeThread / runStreamed
  run-registry.server.ts           # CliRun：本轮状态机、事件队列、长轮询、工具转交、上限与存活
  mcp-bridge.server.ts             # 会话 MCP：McpServerConfig 生成、令牌校验、调用转交
  event-map.ts                     # ACP / Codex 更新 → CliRunEvent；纯函数便于测试
  errors.ts                        # 错误分类：未安装 / 未登录 / 授权失效 / 额度 / 模型 / 超时
  classify.server.ts               # CLI 意图分类
  cooldown.server.ts               # 按实例的额度冷却
  auth/
    cursor-local.server.ts         # agent status / about / login，全机锁
    remote-adapter.ts              # RemoteAuthAdapter 接口
    codex-device.server.ts         # Codex App Server 设备码
    claude-oauth.server.ts         # Claude OAuth + 回填码
    gemini-antigravity.server.ts   # Gemini：Antigravity（agy）在伪终端里登录，回填 Google 授权码
    attempts.server.ts             # 授权尝试注册表：每实例一把锁、长轮询、45 秒无人轮询即取消
  credentials/
    store.server.ts                # 每实例密文文件、generation、原子写
    runtime-dir.server.ts          # 运行时目录租约（引用计数）、回写、启动清理
    claude-keychain.server.ts      # macOS 钥匙串搬运

app/api/game-agent/cli/
  runs/route.server.ts             # POST：开启一轮
  runs/[runId]/route.server.ts     # DELETE：停止
  runs/[runId]/poll/route.server.ts # POST：上报工具结果 + 长轮询事件
  mcp/[sessionId]/route.server.ts  # POST：会话 MCP 端点（handleMcpPost）
  status/route.server.ts           # GET：CLI 可用性与授权摘要（插件 direct 模式使用）
  classify/route.server.ts         # POST：意图分类（插件使用）

app/api/game-agent/auth/
  route.server.ts                  # POST：发起登录 / 授权；DELETE：注销
  [attemptId]/route.server.ts      # GET：长轮询进度；DELETE：取消
  [attemptId]/code/route.server.ts # POST：回填授权码

plugins/src/agent/runtime/
  cli-run.ts                       # 插件侧 CLI Run：发起、轮询、执行转交的工具、映射事件

components/settings/
  AgentAuthSection.tsx             # 授权状态行与操作按钮
  AgentAuthDialog.tsx              # 登录链接 / 用户码 / 回填码弹窗
```

修改的现有文件：

| 文件                                                                    | 改动                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `lib/game-agent/settings-sync.ts`                                       | `provider` 放宽到五种；CLI 类型 `endpoint` 允许为空；读者过滤（§4.3）                            |
| `services/game-agent/settings.ts`、`components/settings/agent-types.ts` | Profile 类型、默认值、校验、迁移                                                                 |
| `services/game-agent/secrets.ts`                                        | 导出按 AAD 加解密的内部函数，供凭证存储复用同一把密钥                                            |
| `plugins/src/agent/runtime/host.ts`                                     | `execute` 与 `agent.task.classify` 按 `isCliProvider` 分流到 `cli-run.ts`                        |
| `plugins/src/agent-ui/direct-request.ts`                                | `/api/game-agent/status` 对 CLI 实例改问服务 `/api/game-agent/cli/status`                        |
| `plugins/src/agent-ui/request.ts`                                       | 同步请求声明 `features: ['cli-providers']`                                                       |
| `services/game-agent/turn-runner.server.ts`                             | `runAskTurn` 按类型分流到 `runCliAskTurn`                                                        |
| `services/game-agent/managed-goal.server.ts`                            | `classifyGameIntent` 按类型分流到 `classify.server.ts`                                           |
| `app/api/game-agent/status/route.server.ts`                             | 返回 CLI 实例的可用性与授权摘要                                                                  |
| `app/api/integration/game-agent/route.server.ts`                        | 删除 / 切换类型时收尾（§6.8）；现有 `POST` 测试接口按类型分流（§6.7），不另开测试路由            |
| `lib/game-agent/runtime/run-turn.ts`                                    | 导出 `resultText`（结果截断）与无进展判定，供 CLI 路径复用                                       |
| `components/game-agent/browserRequest.ts`、`browserTurn.ts`             | Cloud / 浏览器运行时遇到 CLI 实例直接报 `LOCAL_ONLY`；浏览器侧 Agent 管理工具不允许创建 CLI 类型 |
| `services/game-agent/profile-tools.server.ts`                           | 助手管理 Agent 工具可建 / 改 CLI 类型，不暴露授权操作                                            |
| `components/settings/AgentSettingsView.tsx`                             | 类型选择、按类型显示字段、嵌入授权区                                                             |
| `lib/i18n/messages/parts/*`                                             | 类型名、授权状态、错误文案                                                                       |

## 4. 数据模型与同步

### 4.1 Profile

```ts
// lib/game-agent/providers.ts
export const GAME_AGENT_PROVIDERS = ['ollama', 'cursor', 'codex', 'claude', 'gemini'] as const
export type GameAgentProvider = (typeof GAME_AGENT_PROVIDERS)[number]
export type CliAgentProvider = Exclude<GameAgentProvider, 'ollama'>
export type AgentAuthMode = 'none' | 'local_login' | 'remote'

export const PROVIDER_META: Record<GameAgentProvider, { auth: AgentAuthMode; cli?: string; runtime: 'ollama' | 'acp' | 'codex' }> = {
  ollama: { auth: 'none', runtime: 'ollama' },
  cursor: { auth: 'local_login', cli: 'agent', runtime: 'acp' },
  codex: { auth: 'remote', cli: 'codex', runtime: 'codex' },
  claude: { auth: 'remote', cli: 'claude-agent-acp', runtime: 'acp' },
  gemini: { auth: 'remote', cli: 'agy', runtime: 'antigravity' },
}

export const isCliProvider = (provider: string): provider is CliAgentProvider => provider !== 'ollama' && provider in PROVIDER_META
```

- 字段：`label`、`provider`、`endpoint`、`defaultModel`、`temperature`、`keepAlive`、三个超时、`proxy`（空串 = 不设，见 §5.4）。`proxy` 由 `normalizeAgentProxy`（`lib/game-agent/proxy.ts`）校验并规范为 `协议://[凭据@]主机[:端口]`；同步文档里缺该字段的旧记录按空串读，字段 stamp 记 0，旧读者回写不会清掉新读者设置的代理。
- CLI 类型：`endpoint` 存空串，`temperature` / `keepAlive` 存默认值且运行时忽略；`modelRequestTimeoutMs` 不显示、不使用；`modelTimeoutMs` 作为「单轮总时长」，`gameCallTimeoutMs` 照旧。
- `defaultModel` 为空表示 `auto`（Cursor / Claude / Gemini 交给 CLI 默认；Codex 用受控列表第一项）。
- 授权状态**不进** Profile 与同步文档，由服务端按 `profileId` 查询（§6）。

### 4.2 类型切换

编辑已有实例时允许改类型：从远程授权类型改走时，保存成功后注销并删除该实例凭证；改成远程授权类型后状态为「未授权」。确认弹窗提示「切换类型会清除该实例的授权」。

### 4.3 同步兼容

现状：`parseAgentSyncDocument` 只要有一条记录 `provider !== 'ollama'` 就整份返回 `null`，旧插件会报「服务返回了无效的 Agent 同步数据」并停止接收服务端修改。

方案：**按读者能力过滤**。

1. 新插件在 `PUT /api/integration/game-agent` 请求体里带 `features: ['cli-providers']`；网页设置页同样声明。
2. 服务端照常合并（输入里的记录永远按 id 并集，旧插件发来的文档里没有 CLI 记录也不会删掉它们，因为删除只认 tombstone）。
3. 响应时，若请求方没声明 `cli-providers`，从 `agents` 里去掉 CLI 记录，并从 `order.ids` 去掉对应 id（order 的 stamp 不变）。
4. 物化顺序时，不在 `order.ids` 里的未删除 Agent 按原相对顺序追加到末尾。这样旧插件改了排序（带着缺 CLI id 的列表和更新的 stamp）也不会让 CLI 实例消失。
5. 新插件的 `RUNTIME_CONFIG_KEY` 运行时配置与 `agent.config.put` 校验同步放宽。
6. 插件把同步文档同时写入每用户共享文件 `<Chaya 用户目录>/game-agent.json`（与 `mcp.json` 同目录，`0600`，`plugins/src/agent/shared-settings.ts`）。每次同步先合并该文件，写回前再与磁盘内容合并后原子替换；新游戏的 `localStorage` 为空时运行时从该文件读取。因此一个游戏里配好的实例，其它游戏离线也能直接使用。

需要补的单测：旧读者收到过滤后的文档且可解析；旧读者改排序后 CLI 实例仍在列表末尾；旧读者删除 Ollama 实例与新读者编辑 CLI 实例同时发生时两边都保留。

## 5. CLI 会话

### 5.1 统一接口

```ts
// services/game-agent/cli/session-pool.server.ts
export type CliSessionKey = { profileId: string; model: string; scope: string; toolsetHash: string; contextKey: string }

export interface CliSession {
  readonly id: string
  readonly key: CliSessionKey
  /** 发送一轮输入；事件经 onEvent 回调，resolve 于本轮结束 */
  prompt(input: { text: string; signal: AbortSignal; onEvent: (event: CliSessionEvent) => void }): Promise<CliPromptResult>
  cancel(): Promise<void>
  dispose(): Promise<void>
}

export type CliSessionEvent =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool.native'; name: string; status: 'requested' | 'rejected' }
  | { type: 'usage'; usage: AgentTokenUsage }

export type CliPromptResult = { text: string; stopReason: 'end_turn' | 'cancelled' | 'max_tokens' | 'refusal' | 'error'; usage?: AgentTokenUsage }
```

- 复用键 `scope`：托管为 `task:<taskId>`；旅伴陪聊为 `companion:<gameId>`；其它（询问、分类、测试）为 `once:<runId>`，用完即关。
- `toolsetHash` 是本轮工具名与 schema 的哈希。MCP 端点不发 `tools/list_changed`（`lib/integration/mcp-protocol.ts` 只做 JSON 响应），工具集合变了就必须新开会话。
- `contextKey` 是系统 Prompt（含旅伴角色、语言）与对话标识的哈希，由调用方给出（§7.1 `contextKey`）。玩家「新对话」、清空历史、切换角色时它会变，从而新开会话，不沿用旧上下文。
- 每个会话的工作目录是 `os.tmpdir()/chaya-agent/<pid>/<sessionId>/cwd`（空目录，`0700`），会话关闭时删除。

### 5.2 ACP（Cursor / Claude / Gemini）

依赖 `@agentclientprotocol/sdk` 的 `ClientSideConnection`，子进程 stdio 传 NDJSON。

| 步骤                         | 做法                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 启动                         | Cursor `agent acp`；Claude `claude-agent-acp`；Gemini 不走 ACP，见下方 Antigravity 说明。环境变量见 §5.4                                   |
| `initialize`                 | `clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }`，不给 Agent 任何客户端侧文件 / 终端能力       |
| `session/new`                | `cwd` 为空目录；`mcpServers: [{ type: 'http', name: 'chaya', url, headers: [{ name: 'Authorization', value: 'Bearer <token>' }] }]`        |
| 选模型                       | 有 `models` / `configOptions` 时设置；`auto` 或空时不设                                                                                    |
| `session/prompt`             | 每轮一次；新会话的首轮带系统 Prompt、历史与目标，复用会话只带增量（§7.6、§7.12）                                                           |
| `session/update`             | `agent_message_chunk` → `text`；`agent_thought_chunk` → `thought`；`tool_call` / `tool_call_update` 只用于识别内置工具；用量通知 → `usage` |
| `session/request_permission` | 来自 `chaya` MCP 的工具调用选允许；其它一律选拒绝（`reject_once`），并发 `tool.native: rejected`。识别不了来源的按拒绝处理                 |
| `session/cancel`             | 停止时发送；2 秒内 `prompt` 未返回则 `SIGTERM`，再 1 秒 `SIGKILL`                                                                          |

内置工具关闭（按锁定版本验证，见 §13）：

- Cursor：用只读模式（若 ACP 暴露 ask / plan 模式且仍可调 MCP），并依赖权限拒绝兜底。
- Claude：`session/new` 的 `_meta.claudeCode.options` 传 `disallowedTools`（Bash、Edit、Write、WebFetch、WebSearch 等）；钥匙串见 §6.6。
- Gemini：在运行时主目录的 `settings.json` 写 `tools.core: []` / `excludeTools`。

玩家本机配置隔离：

- 每个 CLI 都用 Chaya 自己的固定目录做 `HOME`，不读玩家的 `~/.cursor`、`~/.codex`、`~/.agents`、`~/.claude`、`~/.gemini` 里的全局 skills、规则、MCP、插件；游戏 agent 需要的说明与工具只由 Chaya 提供（`services/game-agent/cli/cli-home.server.ts`）。
  - Cursor：`HOME=DATA_DIR/game-agent/cli-home/cursor`。目录里只放指向本机登录的链接（macOS 链接 `~/Library/Keychains`，令牌在钥匙串 `cursor-access-token`，另链 `~/.cursor/auth.json`；Linux 设 `XDG_CONFIG_HOME` 并链 `cursor/auth.json`；Windows 的 `%APPDATA%` 保持不变），不复制凭证。`.cursor/skills-cursor` 用只读空文件占位，挡住 CLI 启动时自装的技能包；`.cursor/cli-config.json` 写 `permissions.deny = Shell(*) / Read(**) / Write(**) / WebFetch(*) / Mcp(*:*)`；会话记录目录（`acp-sessions` / `chats` / `projects`）每个 Chaya 进程启动后清一次。
  - Codex：`CODEX_HOME` 是凭证运行时目录，`HOME=DATA_DIR/game-agent/cli-home/codex`（Codex 还会读 `~/.agents` 的 skills 与插件）；`config.toml` 加 `[skills.bundled] enabled = false` 关掉内置技能。
  - Gemini（Antigravity）：`HOME` 就是凭证运行时目录（令牌只能明文落在临时目录），settings 由 Chaya 生成；工作目录在系统临时目录下，向上没有仓库，不会发现项目 `.agents/`、`AGENTS.md`、`GEMINI.md`。
- 实测（向各 CLI 询问已加载内容）：Cursor、Codex 的 skills / 规则 / MCP 均为空；Gemini 仍带两个内置技能 `agy-customizations`、`antigravity-guide`（只注入名称与描述，内容是 Antigravity 产品说明），`skills.json` 的 `exclude` 不作用于内置技能，暂无法关闭；运行时加 `--disable-slash-commands`，玩家输入不会展开技能。
- 已知限制：Cursor 的 `Grep` / `Glob` 不受 `Read(**)` 约束，`cli-config.json` 也不支持 `Grep(**)` / `Glob(**)`；ACP `ask` 模式加 Chaya 拒绝全部权限请求是唯一兜底。

系统 Prompt 投放：

- ACP 没有 system 角色。首轮 `session/prompt` 用一个文本块，先放 `<chaya-instructions>` 包住的系统 Prompt，再放历史与目标。支持自定义系统 Prompt 的 CLI 优先用其参数（如 Claude 的 `_meta.claudeCode.options.systemPrompt` 追加模式），实施时逐个验证（§13）。
- Codex 用线程级开发者指令配置（按锁定版本核对键名），不行再退回首条输入前置。

### 5.3 Codex

依赖 `@openai/codex-sdk`（调用玩家机器上的 `codex` CLI，`codexPathOverride` 指向 `findCli('codex')`）。

```ts
const codex = new Codex({
  codexPathOverride,
  env: { ...baseEnv, CODEX_HOME: runtimeHome, CHAYA_MCP_TOKEN: token },
  config: {
    mcp_servers: { chaya: { url, bearer_token_env_var: 'CHAYA_MCP_TOKEN', tool_timeout_sec: 900 } },
  },
})
const thread = codex.startThread({ model, workingDirectory: cwd, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never' })
const { events } = await thread.runStreamed(input, { signal })
```

- `item.*`：`agent_message` → `text`；`reasoning` → `thought`；`mcp_tool_call` 只做识别（实际执行经 MCP 端点）；`command_execution` / `file_change` 记为 `tool.native`，出现即说明内置工具没关干净，记警告。
- `turn.completed.usage` → `usage`；`turn.failed` / `error` → 错误分类（§9）。
- 托管周期复用同一个 `thread`（`resumeThread` 用于进程内复用失败后的恢复）。
- `config.toml` 由运行时目录写入：`cli_auth_credentials_store = "file"`、`forced_login_method = "chatgpt"`，以及关闭 shell / web search 的选项（按锁定版本核对键名）。

### 5.4 子进程环境

- 基础环境：仅透传 `PATH`（补 GUI 启动缺失目录）、`HOME`、`LANG`、`TMPDIR`、代理变量；不透传 Chaya 自身的密钥类变量。
- Cursor：`CURSOR_API_KEY=''`，`HOME` / `USERPROFILE` 指向固定目录（§5.2「玩家本机配置隔离」）。
- Codex：`CODEX_HOME=<运行时目录>`，`HOME` / `USERPROFILE` 指向固定目录。
- Claude：`CLAUDE_CONFIG_DIR=<运行时目录>`，`ANTHROPIC_API_KEY` 置空。
- Gemini：CLI 主目录变量指向运行时目录，`GEMINI_API_KEY` / `GOOGLE_API_KEY` 置空。
- stderr 只进环形缓冲（最近 16 KB），用于错误分类；写日志前统一脱敏（§10），代理 URL 里的凭据替换为 `***`。
- 代理（`services/game-agent/proxy/agent-proxy.ts`）：实例设了 `proxy` 时 `agentProxyEnv` 覆盖 `HTTP(S)_PROXY` / `ALL_PROXY`（大小写两套）并设 `NO_PROXY=localhost,127.0.0.1,::1`；未设时沿用透传的系统代理变量。覆盖所有起 CLI 的地方：Cursor `status` / `about` / `login` / `logout` / `acp`，Codex app-server（设备码授权、注销、测试、运行）。
  - 实测（Clash 混合端口）：Codex 原生支持 HTTP 与 SOCKS5；Cursor `agent` 只支持 HTTP（原生 SOCKS 下读不到套餐）；Claude Code 文档只支持 HTTPS 代理。
  - 因此 SOCKS 代理一律经 `socks-bridge.ts`：每个上游一个 `127.0.0.1:随机端口` 的 HTTP 代理（CONNECT 隧道 + 绝对 URI 转发），用 `socks` 包连上游，目标主机名交给代理解析；入口要求 `Proxy-Authorization: Basic chaya:<随机口令>`，防止本机其它进程借用。进程内常驻，`unref`。实测 Cursor / Codex 均会带上 URL 里的口令。
  - Ollama：服务端请求（列表、对话、托管、看图、AI 翻译）用 `ollamaFetch(profile)`，即 undici `ProxyAgent`（SOCKS 同样指向桥）；端点是本机地址时直连。浏览器 / 游戏内直连 Ollama 的路径不受影响。
  - Cursor 状态缓存按代理分键；授权尝试与注销读取已保存实例的 `proxy`，测试使用请求体里草稿的 `proxy`。

### 5.5 会话池

- 进程级 `Map<sessionId, CliSession>` 与 `Map<keyString, sessionId>`。
- `companion:*` 空闲 5 分钟关闭；`task:*` 随任务结束关闭；`once:*` 本轮结束关闭。
- 同一实例的所有会话共享一个运行时凭证租约（§6.5）。
- **并发上限**：全进程同时最多 4 个 CLI 会话。满了先按最近最少使用关闭空闲的 `companion:*`；仍满则 `POST /cli/runs` 返回 `429 AGENT_CLI_BUSY`。
- `closeSessionsForProfile(profileId, reason)` / `closeSessionsForProvider('cursor', reason)`：取消进行中的 Run（错误码 `AGENT_AUTH_CHANGED`）并关闭会话，供授权变更收尾使用（§6.8）。
- **进程树**：
  - POSIX 以 `detached: true` 启动并按进程组结束（`process.kill(-pid)`），因为 `claude-agent-acp`、`codex` 会再起子进程；
  - Windows 通过 `findCli` 找到的 `.cmd` / `.ps1` 垫片需经 `cmd.exe /d /s /c` 启动，结束用 `taskkill /pid <pid> /T /F`。
- **残留清理**：
  - `process.on('exit' | 'SIGTERM')` 时同步结束所有子进程组；
  - 子进程 pid 写进 `DATA_DIR/game-agent/cli-pids.json`，Chaya 启动时结束其中仍存活且命令行匹配的进程（应对 App 被强杀）；
  - 启动时清理 `os.tmpdir()/chaya-agent/` 下 pid 已不存在的目录。

## 6. 授权

### 6.1 接口

所有授权接口在 `!canUseDisk()`（Cloud）时返回 `404 LOCAL_ONLY`，鉴权与 `/api/integration/game-agent` 相同（网页与游戏内配置页都能用）。

| 方法与路径                                  | 作用                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/game-agent/status`                | 原有状态 + 每个 CLI 实例 `{ cli: { found, version }, auth: AgentAuthStatus }`                               |
| `POST /api/game-agent/auth`                 | `{ profileId }` → 等到挑战（≤30 秒）返回 `{ attemptId, challenge }`                                         |
| `GET /api/game-agent/auth/:attemptId`       | `?waitMs=25000` 长轮询 → `{ state: 'pending' \| 'completed' \| 'failed' \| 'cancelled', account?, error? }` |
| `POST /api/game-agent/auth/:attemptId/code` | `{ code }`：Claude / Gemini 回填码                                                                          |
| `DELETE /api/game-agent/auth/:attemptId`    | 取消                                                                                                        |
| `DELETE /api/game-agent/auth?profileId=`    | 注销（仅远程授权类型）                                                                                      |

状态接口的开销：`CompanionPanel` 每 2 秒轮询一次 `/api/game-agent/status`（游戏内经 `direct-request` 转到 `/api/game-agent/cli/status`），所以状态必须只读缓存：

- `findCli` 与 `--version` 结果缓存 60 秒；
- Cursor 登录状态缓存 30 秒；
- 远程授权状态读内存里的凭证元数据（写入时更新）。

插件侧对 CLI 状态再缓存 10 秒，不每 2 秒打一次服务。

```ts
export type AgentAuthStatus =
  | { mode: 'local_login'; state: 'signed_in' | 'signed_out' | 'unknown'; account?: AgentAccountSummary }
  | { mode: 'remote'; state: 'authorized' | 'unauthorized' | 'expired'; account?: AgentAccountSummary; updatedAt?: number }

export type AgentAccountSummary = { emailHint?: string; plan?: string }

export type AgentAuthChallenge =
  | { kind: 'browser_link'; url: string; expiresAt: number } // Cursor
  | { kind: 'device_code'; url: string; userCode: string; expiresAt: number } // Codex
  | { kind: 'callback_code'; url: string; expiresAt: number } // Claude / Gemini
```

授权尝试注册表（`auth/attempts.server.ts`）：

- 远程授权按 `profileId` 加锁；Cursor 全机一把锁。冲突返回 `409 AGENT_AUTH_IN_PROGRESS`。
- 45 秒没有任何轮询 / 回填视为页面已关闭，取消尝试并结束子进程。
- 整个尝试 10 分钟超时。结束后结果保留 60 秒供最后一次轮询读取，然后删除。
- 挑战、回填码只存在内存里的尝试对象中，不写日志。

### 6.2 Cursor 本机登录

- **状态**：`agent status --format json` 读 `isAuthenticated`；`agent about --format json` 读邮箱与套餐。5 秒超时，结果缓存 30 秒；登录完成清缓存。
- **登录**：
  - 以 `NO_OPEN_BROWSER=1`、`CURSOR_API_KEY=''` 启动 `agent login`；
  - 逐行扫描 stdout / stderr，用正则提取 `https://cursor.com/...` 登录链接作为 `browser_link` 挑战；
  - 进程退出码 0 视为成功，随后刷新状态读取账号；
  - 取消时结束进程。`agent login` 在成功前不会清掉原登录，所以取消不影响本机已有登录（实施时按锁定版本复核）。
- 参考 `ticket-janitor` 的 `local-auth-readiness.ts`、`local-cursor-reauthorization.ts`。

### 6.3 远程授权适配器

```ts
// services/game-agent/cli/auth/remote-adapter.ts
export interface RemoteAuthAdapter {
  provider: 'codex' | 'claude' | 'gemini'
  /** 需要持久化的凭证文件（相对运行时目录） */
  credentialFiles: readonly string[]
  start(input: { stagingDir: string; signal: AbortSignal }): Promise<RemoteAuthAttempt>
  /** 能调提供方注销的（Codex）在删除密文前调用；失败不阻塞删除 */
  logout?(input: { runtimeDir: string; signal: AbortSignal }): Promise<void>
}

export interface RemoteAuthAttempt {
  challenge: AgentAuthChallenge
  submitCode?(code: string): Promise<void>
  /** resolve 时 stagingDir 里已有完整凭证 */
  completed: Promise<{ account: AgentAccountSummary }>
  cancel(): Promise<void>
}
```

| 类型   | 实现要点                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex  | staging `CODEX_HOME` 先写 `config.toml`（文件存储、强制 ChatGPT）；起 `codex app-server`，JSON-RPC `account/login/start { type: 'chatgptDeviceCode' }` 拿链接与用户码，等 `account/login/completed`，再 `account/read` 取账号。凭证文件 `auth.json`。接口字段不匹配时报 `AGENT_CLI_VERSION_UNSUPPORTED`，不解析终端输出                                                                                                                                |
| Claude | staging `CLAUDE_CONFIG_DIR`；按 `claude-code-auth-adapter.ts` 启动官方登录，取授权链接作为 `callback_code` 挑战，`submitCode` 把回填码写进登录进程。凭证文件 `.credentials.json`；macOS 需钥匙串搬运（§6.6）                                                                                                                                                                                                                                           |
| Gemini | 与工单系统 `gemini-auth-adapter.ts` 相同：在伪终端（`@lydell/node-pty`）里无参数启动 `agy`，`HOME` 指向 staging 并带 `NO_BROWSER` 与 `SSH_CONNECTION`（令牌落文件而非钥匙串）；出现「Select login method:」回车选 Google，抓取 `redirect_uri=https://antigravity.google/oauth-callback` 的授权链接，玩家回填码后写回终端。`.gemini/antigravity-cli/antigravity-oauth-token` 出现且 `agy models` 成功即完成；只加密保存该文件。回填码只接受可打印 ASCII |

完成流程（`attempts.server.ts`）：

1. `completed` resolve 后，再次读取 Profile，确认实例仍存在且类型未变；否则丢弃并返回 `AGENT_PROFILE_CHANGED`。
2. 读 staging 里 `credentialFiles`，交给凭证存储写入新 generation（§6.4）。
3. 清理 staging（无论成败），清空该实例的模型列表缓存。

### 6.4 凭证存储

```text
DATA_DIR/game-agent/credentials/<profileId>.json   # 0600，目录 0700
```

```ts
type CredentialDocument = {
  version: 1
  provider: 'codex' | 'claude' | 'gemini'
  generation: number
  account: AgentAccountSummary
  updatedAt: number
  state: 'active' | 'expired'
  files: Record<string, { iv: string; tag: string; data: string }>
}
```

- 密钥复用 `services/game-agent/secrets.ts` 的 `secret.key`。把现有 `encrypt` / `decrypt` 改为接收 AAD 字符串并导出给内部模块；凭证文件的 AAD 为 `cred:<profileId>:<provider>:<relPath>`，与 Agent Token 的 AAD（`profileId`）不会混用。
- 写入走临时文件 + `rename`，同 `secrets.ts` 的 `writeDocument`。
- `generation` 每次授权 / 回写 +1。
- 注销与删除实例时删除文件；运行中的租约在释放时发现文件已删除则直接丢弃明文。
- 状态接口只读 `account`、`state`、`updatedAt`，不解密。

### 6.5 运行时目录与刷新回写

```ts
// services/game-agent/cli/credentials/runtime-dir.server.ts
export function acquireCredentialLease(profileId: string): Promise<{ dir: string; generation: number; release: () => Promise<void> }>
```

- 每个实例同时最多一份运行时目录 `os.tmpdir()/chaya-agent/<pid>/cred-<profileId>/`（`0700`），引用计数共享。
- 首个租约：解密 `files` 写入目录，记下 `baseGeneration` 与每个文件的 SHA-256。Codex 同时写 `config.toml`，Gemini 写 `settings.json`。
- **回写时机**：每轮结束、会话关闭、最后一个租约释放时各尝试一次。读目录里的凭证文件，哈希未变就跳过。
- **回写规则**（按实例一把异步锁串行化）：
  - 存储里的 `generation` 大于 `baseGeneration`（期间被重新授权）：丢弃运行时副本，不覆盖新授权；
  - 否则写入新 generation，更新 `baseGeneration` 与哈希；
  - 写入失败或文件被 CLI 清空：`state` 标为 `expired`，后续运行报 `AGENT_AUTH_EXPIRED`。
- 最后一个租约释放：回写后删除目录。

### 6.6 Claude 钥匙串（macOS）

Claude Code 在 macOS 上把凭证写进钥匙串，服务名按配置目录区分。参照 `claude-credential-backend.ts`：

- 租约建立时：把解密出的 `.credentials.json` 用 `security add-generic-password -U` 写入该配置目录对应的钥匙串项；
- 回写时：用 `security find-generic-password -w` 读回作为最新凭证；
- 最后一个租约释放时：删除钥匙串项。

钥匙串操作失败按 `AGENT_AUTH_EXPIRED` 处理并提示重新授权，不退回读本机 `~/.claude`。

### 6.7 测试与模型列表

- 测试：沿用配置页现有的 `POST /api/integration/game-agent` 测试动作，按类型分流。CLI 类型开 `once:` 会话，不挂 MCP，发一句只读提示（如「回复 OK」），30 秒超时，返回模型名、耗时与模型列表；错误走 §9 分类。
- 模型列表：
  - ACP 类型取 `session/new` 返回的模型选项，失败退回 `['auto']`；
  - Codex 用受控列表；
  - 按 `profileId` 缓存（`services/game-agent/model-cache.ts` 现按 endpoint 失效，需为 CLI 类型改用 `provider:profileId` 作为失效键）；授权 / 登录完成或手动刷新时清空。

### 6.8 授权变更收尾

以下操作先收尾再改凭证，避免旧会话带着旧凭证继续跑或回写覆盖：

| 操作                     | 收尾                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| 远程授权成功（重新授权） | `closeSessionsForProfile`，等租约释放（回写会因 generation 落后被丢弃）后再写入新凭证 |
| 注销                     | `closeSessionsForProfile` → 适配器 `logout` → 删除密文与运行时目录                    |
| 删除实例 / 切换类型      | 同注销；配置保存成功后执行                                                            |
| Cursor 登录成功          | `closeSessionsForProvider('cursor')`                                                  |

被收尾的 Run 以 `error(AGENT_AUTH_CHANGED)` 结束，游戏内任务失败并显示「该实例授权已变更」。

### 6.9 多进程

进程内锁只在一个 Chaya 进程里有效。开发服务与 App 指向同一 `DATA_DIR`（如都设了同一个 `CHAYA_DATA_DIR`）时，两边可能同时使用同一份远程凭证，refresh token 轮换会互相作废。

- 取凭证租约时，用 `O_EXCL` 创建 `credentials/<profileId>.lock`，内容为 `pid` 与启动时间；最后一个租约释放时删除。
- 锁文件存在且 pid 仍存活：返回 `409 AGENT_CREDENTIAL_LOCKED`（「该实例正在另一个 Chaya 中使用」）。pid 已死：视为残留，接管。
- 授权尝试与凭证写入用同一把文件锁；Cursor 登录的全机锁同样落成 `game-agent/cursor-login.lock`。

## 7. 运行

### 7.0 当前实现：CLI 作为文本模型

询问、旅伴陪聊、托管与意图分类已对所有 CLI 类型开放。**实际落地的方案比 §7.1–§7.5 的 Run / MCP 桥更简单**：CLI 只充当「一轮模型调用」，工具循环、玩家卡片、操作确认、上限与无进展判定仍由 `runAgentTurn` 负责，与 Ollama 完全同一条路径。

- **入口**：`completeAgentModel(profile, …)`（`services/game-agent/model-complete.server.ts`）按类型分流到 Ollama 或 `completeWithCli`。`/api/game-agent/model`（插件游戏内任务与分类）、`runAskTurn`（网页侧栏）与 `classifyGameIntent` 都走它。
- **协议**：`lib/game-agent/cli-tool-protocol.ts`。`renderCliPrompt` 把 system、工具清单（JSON Schema）与整段对话（含工具结果，单条截断 12k 字符、长 base64 替换为 `[binary omitted]`）渲染成文本，要求模型只回 `{"reply", "tool_calls"}`；`parseCliReply` 解析为 Ollama 形状的 `RuntimeMessage`，非信封输出按纯文本最终回复处理。没有工具时允许按调用方要求的格式输出（分类用 JSON）。
- **CLI 不拿任何工具**：Cursor 用 ACP `ask` 模式且拒绝全部权限请求；Codex 线程 `sandbox: read-only`、`approvalPolicy: never`，并用 `config` 关闭 `shell_tool` / `apply_patch_freeform` / `view_image_tool` / `web_search`，`baseInstructions` 换成 Chaya 的说明；Gemini（Antigravity）用 `plan` 模式、`--disable-slash-commands` 加 settings 的 deny 列表（`command` / `read_file` / `write_file` / `read_url` / `execute_url` / `mcp` / `unsandboxed`）。工作目录是空的临时目录；全局配置隔离见 §5.2。Antigravity 一次运行没有以 SUCCESS 结束、又归不到授权 / 额度 / 模型错误时（实测如模型偶发输出空的原生函数调用），同一轮重跑一次；每次运行都是新进程，重跑不带状态。
- **常驻进程**（`warm-pool.server.ts`）：Cursor（ACP 客户端，每轮 `session/new`）与 Codex（app-server，每轮新开 ephemeral 线程，结束后 `lease.sync()` 回写）每个实例保留 1 个空闲进程，空闲 5 分钟关闭；失败的回合不放回；授权变更时关闭空闲进程，并用 epoch 防止变更时正忙的进程被放回。Gemini 每轮一个进程。实测 Cursor 冷启动约 27 秒，常驻后约 7–10 秒。
- **模型**：空的 `defaultModel` 在状态接口里报告为 `auto`（`CLI_AUTO_MODEL`），运行时不设置模型。服务端状态接口按授权与 CLI 是否安装给出 `online` 与原因；插件 direct 状态不查服务，授权问题在运行时以明确错误返回。
- **超时**：插件对 CLI 实例的单次请求超时取 `modelTimeoutMs`（不用 Ollama 的短请求超时）；托管周期间隔最少 5 秒。远程网关模式（`CHAYA_MCP_GATEWAY`）下 CLI 实例直接报错。
- **代价**：每轮重发完整对话，不复用 CLI 侧上下文；以后需要更低延迟或流式输出时，再按 §7.1–§7.12 引入 Run / MCP 桥。

### 7.1 CLI Run 协议

```ts
// lib/game-agent/cli-run-protocol.ts
export type CliRunStart = {
  profileId: string
  model: string
  capability: AgentCapability
  gameId: string
  taskId?: string // 游戏内任务；托管复用会话的依据
  scope: 'once' | 'task' | 'companion'
  contextKey: string // 系统 Prompt + 对话标识的哈希，变了就新开会话（§5.1）
  system: string // 新会话首轮使用；复用会话时忽略
  history: { role: 'user' | 'assistant'; content: string }[] // 新会话首轮使用，窗口与 Ollama 路径相同
  prompt: string
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
  limits: { maxToolCalls: number; maxDurationMs: number }
}

export type CliRunEvent =
  | { seq: number; type: 'text'; text: string }
  | { seq: number; type: 'thought'; text: string }
  | { seq: number; type: 'usage'; usage: AgentTokenUsage }
  | { seq: number; type: 'tool.call'; callId: string; name: string; input: Record<string, unknown> }
  | { seq: number; type: 'phase'; phase: 'thinking' | 'acting' | 'verifying' }
  | { seq: number; type: 'done'; text: string; reason: 'answered' | 'limit' | 'no_progress' | 'unsupported'; toolCalls: number; usage?: AgentTokenUsage }
  | { seq: number; type: 'error'; code: string; message: string }

export type CliRunPoll = {
  afterSeq: number
  results: { callId: string; ok: boolean; output: unknown }[]
  waitMs: number // ≤ 25_000
}
```

- `POST /api/game-agent/cli/runs`：校验 Profile 是 CLI 类型、CLI 已安装、授权有效、未在冷却期、未超并发上限；返回 `{ runId, runSecret }`，CLI 会话在后台准备。
- `POST /api/game-agent/cli/runs/:runId/poll`：先把 `results` 交给等待中的 MCP 调用，再返回 `afterSeq` 之后的事件；没有新事件时挂起到 `waitMs`。
- `DELETE /api/game-agent/cli/runs/:runId`：停止（§7.8）。
- **鉴权与归属**：
  - 三个接口与 `/api/game-agent/cli/classify`、`/cli/status` 的鉴权同现有 `/api/game-agent/model`（插件带 `X-Chaya-Launch-Token`，走同一套 `defineApiRoute` 规则）；
  - poll 与 DELETE 还要求 `X-Chaya-Run-Secret` 等于开启时返回的 `runSecret`（32 字节随机，`timingSafeEqual`），防止其它页面读取事件或伪造工具结果；
  - `results` 里只接受本 Run 已下发且未完成的 `callId`，重复提交忽略。
- **存活检测**：30 秒没有收到 poll 视为任务归属方已离开（游戏关闭、重载），按停止处理。

### 7.2 Run 状态机

```text
preparing → running ⇄ waiting_tool → done | failed | stopped
```

- `preparing`：取凭证租约、从会话池拿会话（新建或复用）、把 Run 挂到会话的 MCP 端点。
- `running`：`session.prompt()` 进行中；CLI 更新经 `event-map.ts` 转为 `CliRunEvent` 入队。
- `waiting_tool`：有 MCP 调用在等结果；可以有多个并发调用。
- 结束时：解绑 MCP 端点；`once` 会话关闭，`task` / `companion` 会话放回池；凭证回写；未决的工具调用全部以「本轮已结束」失败返回给 CLI。
- 事件队列上限 2000 条，超出丢弃最早的 `text` / `thought`（`tool.call` 与终态永不丢）。

### 7.3 会话 MCP 端点

`POST /api/game-agent/cli/mcp/:sessionId`：

1. `!canUseDisk()` → 404；请求来源不是回环地址 → 403（Chaya 监听局域网时也只给本机 CLI 用）。下发给 CLI 的 URL 用服务实际监听端口拼 `http://127.0.0.1:<port>`，不取请求的 Host。
2. 校验 `Authorization: Bearer <token>`（`timingSafeEqual`；令牌 32 字节随机，会话创建时生成、关闭即作废）。
3. 取会话当前绑定的 Run；没有 Run 时 `tools/list` 返回空列表，`tools/call` 返回 MCP 错误「当前没有进行中的任务」。
4. 用 `handleMcpPost(config, request)`，`config.tools` 由 Run 的 `tools` 生成：

```ts
const toMcpTool = (run: CliRun, tool: CliRunStart['tools'][number]): McpTool => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  run: (args, { signal }) => run.callTool(tool.name, args, signal),
})
```

`run.callTool` 负责：

- 计数，超过 `maxToolCalls` 返回 `{ ok: false, error: 'LIMIT_REACHED' }` 并在本次调用返回后取消会话、Run 以 `done(reason: 'limit')` 结束；
- 超过 `maxDurationMs`（扣除等待玩家卡片的时间）同样处理；
- 调用前后入队 `phase`（`acting` / `verifying`），`session.prompt()` 开始与每次工具返回后入队 `thinking`，让状态栏与插件 `controller.checkpoint` 照常工作；
- 交给执行器（§7.4），等待结果，用 `run-turn.ts` 导出的 `resultText` 截断后按 MCP `content` 格式返回（文本 JSON，图片沿用 `isMcpImageResult`），截断长度与 Ollama 路径一致；
- 托管（`play` 能力）下沿用 `runAgentTurn` 的无进展判定：`[name, input, result]` 签名连续 3 次相同，则本次返回「操作已停止：连续三次没有观察到新的进展」，取消会话，Run 以 `done(reason: 'no_progress')` 结束。

MCP 客户端的工具调用超时：玩家卡片可能等很久。Codex 用 `tool_timeout_sec: 900`；Claude 用 `MCP_TOOL_TIMEOUT`；Gemini 在 MCP 配置里设 `timeout`；Cursor 不可配置时，卡片工具在 50 秒时返回 `{ answered: false, waiting: true, cardId }`，并额外暴露 `chaya_player_card_wait({ cardId })` 继续等待（同一张卡片不重复弹出）。

### 7.4 工具执行器

```ts
type CliToolExecutor = (call: { callId: string; name: string; input: Record<string, unknown> }, signal: AbortSignal) => Promise<{ ok: boolean; output: unknown }>
```

| 任务来源     | 执行器                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 游戏内任务   | **转交**：入队 `tool.call` 事件，等插件在下一次 poll 里带回 `results`；超时以 `gameCallTimeoutMs` 为准，玩家卡片与操作确认不设超时（随停止结束） |
| 网页侧栏询问 | **本地**：`executeGameAgentTool`，工具集合与 `runAskTurn` 的构造逐条一致（见下）                                                                 |

网页侧栏 `runCliAskTurn` 必须复用 `runAskTurn` 的这些行为，建议先把它们从 `runAskTurn` 抽成共用函数再分流：

- 工具不按玩家原话的关键词增减，问候、闲聊是否调用工具由模型按系统提示判断；未连接游戏（含 `chaya-console`）时游戏工具返回离线；
- 工具来自 `createGameAgentTools(gameId, profile.gameCallTimeoutMs)`，分类 `edit=false` 时只保留 `readOnly` 与 `chaya_agent_*`（Agent 管理工具）；
- `collectSecretValues(args)` 收集参数里的密文，事件经 `sanitizeAgentActivity`、历史经 `redactSecretText` 脱敏；
- `appendLog` 记录 `tool.started` / `tool.completed`；
- 结果写回 `session.messages`（保留最近 200 条）；它不进入提示词，只供本会话的 `chaya_agent_recall` 读取（§7.12）；
- 服务端询问没有玩家卡片工具。

### 7.5 游戏内 Host 接入（`plugins/src/agent/runtime/cli-run.ts`）

`host.ts` 的 `execute` 在 `task.routine` 分支之后判断：

```ts
if (isCliProvider(profile.provider)) return executeCliTask({ task, signal, controller, tools, profile, showPlayerCard })
```

`executeCliTask` 做的事：

0. `window.CHAYA_MCP_GATEWAY === true`（插件经远程网关、直连 Ollama 的模式）时直接以 `LOCAL_ONLY` 失败。
1. 工具清单与 Ollama 路径相同：`tools.definitions` 经 `capabilityConfig(task.capability).allowTool` 过滤，加上 `PLAYER_CARD_TOOL`。
2. 系统 Prompt 与首轮输入与 Ollama 路径相同（托管用 `playSystem` + `playModelPrompt`；询问 / 陪聊用 `buildAskMessages` 的 system 与本句），都不带之前的轮次（§7.12），照常发 `prompt.recorded`。
3. `POST /cli/runs`，然后循环 poll：
   - `tool.call`：并发执行，复用 `host.ts` 现有的 `call` 逻辑（状态检查 → 卡片 → 实现 → `ACTION_REQUIRES_CONFIRMATION` 转 `waitForUser`），前后发 `tool.started` / `tool.completed`；结果放进下一次 poll 的 `results`。
   - `text`：累积为本轮回复；`thought` → `thought.updated`；`usage` → `usage.updated`。
   - `phase` → `phase` 事件；`thinking` 时调用 `controller.checkpoint(task.id)`，与 Ollama 路径一致。
   - `done`：
     - 先 `controller.appendMessages(task.id, [{ role: 'user', content: storePrompt }, { role: 'assistant', content: text }])`，与 `runAgentTurn` 的 `store.append` 一致，后续询问与任务详情才有历史；
     - 询问 / 陪聊再发 `assistant.completed`；托管发 `progress.updated` 并进入下一周期（§7.6）。
   - `error`：抛出带 `code` 的错误，按现有失败路径结束任务。
4. 工具执行期间 poll 不中断（工具执行与 poll 并发），否则卡片等待会触发服务端 30 秒存活检测。
5. `signal` abort 时先 `DELETE /cli/runs/:id`，再结束本地等待。
6. poll 请求失败：按 `requestModel` 现有的重试节奏重试，累计 20 秒仍失败则以 `AGENT_SERVICE_DISCONNECTED` 结束任务（服务端此时已按存活检测停掉 Run）。

插件侧不经过 `modelGate`：额度冷却在服务端按实例判断（§7.9）。

### 7.6 托管周期

- `scope: 'task'`，会话复用键含 `taskId`。
- 每个周期都只发 system + `playModelPrompt(goal, cycle)` 的「目标 + 当前状态」，不重放之前的周期；需要时模型用 `chaya_agent_recall` 读取。
- `waitForNextPlayCycle` 对 CLI 实例改为：最小 5 秒；本周期 `toolCalls === 0` 时间隔加倍，最长 60 秒；有工具调用后重置为 5 秒。
- 任务停止、失败或重载时关闭该会话。

### 7.7 意图分类

- 总则见 [`game-agent.md`](./game-agent.md) §6.4「语义判断不用文本匹配」。
- 插件分类 Prompt 与输出结构在 `lib/game-agent/intent.ts`：模型先填 `action`（要执行的游戏动作或 null），再填 `operate`；Ollama 用 JSON schema（`format`）约束，经 `/api/game-agent/model` 透传。只要布尔值时，`gemma4:e4b` 等小模型对「帮我交互 / 保存一版」也几乎都答 false。
- 是否操作游戏只由模型分类决定，不按玩家原话的动词、关键词短路成托管或固定例程。固定例程（存档、读档、打开菜单）只来自界面按钮显式传入的 `routine`。
- 回合内也不按原话关键词追加催促；`runAgentTurn` 只在托管能力「读完状态未行动」「全程没有调用工具」时提示继续，这两条只看工具调用情况。
- 地图事件只提供事实：`effects`（当前页指令的作用：text、choice、common_event、gold、item、weapon、armor、transfer、battle、shop）与 `interactive`；NPC、怪物、宝箱、门、任务入口由模型结合 `name`、`sprite`、`hint` 判断。
- 插件 `agent.task.classify` 与服务端 `classifyGameIntent` 遇到 CLI 实例时，分别调用 `POST /api/game-agent/cli/classify` 与 `classify.server.ts`。
- 输出结构与现有一致：服务端要 `{ operate, edit }`（`edit` 决定 `runAskTurn` 是否只给只读工具），插件要 `{ operate }`。分类 Prompt 复用两处现有的 system 文本（去掉 Ollama 专用的 `/no_think`）与 `intentState(state)` 输入。
- 服务端先保留现有短路：游戏未连接时直接返回 `{ managed: false, edit: false }`，不调 CLI。
- 实现：不借用 `companion:` 会话。分类 Prompt 会进入它的上下文，污染后续陪聊；而且陪聊会话带着 MCP 工具。始终开不挂 MCP 的 `once:` 会话。冷启动延迟见需求 §12。
- 20 秒超时、解析失败、冷却期内：返回 `ask`（服务端 `edit=false`）。
- 不把分类对话写进任务历史。

### 7.8 停止、超时与断线

| 情况                          | 处理                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 玩家停止 / `DELETE /runs/:id` | Run 置 `stopping`，新的 MCP 调用立即拒绝；`session.cancel()`；2 秒未返回 `SIGTERM`，再 1 秒 `SIGKILL`；关闭会话（不复用被取消的会话） |
| 单轮超时                      | 同停止，Run 以 `error(AGENT_CLI_TIMEOUT)` 结束                                                                                        |
| 30 秒无 poll                  | 同停止，Run 以 `error(AGENT_SERVICE_DISCONNECTED)` 结束                                                                               |
| 子进程意外退出                | Run 以 `error(AGENT_CLI_CRASHED)` 结束，附脱敏后的 stderr 末尾                                                                        |
| Chaya 服务退出                | 结束全部子进程；插件 poll 失败后按 §7.5 第 6 条结束任务                                                                               |

停止后插件侧任务状态由 `AgentTaskController` 现有流程置为 `stopped`，输入占用随之释放，不需要新逻辑。

### 7.9 额度冷却

- `cooldown.server.ts`：按 `profileId` 记录 `until`。`AGENT_QUOTA_EXCEEDED` 时设为 `now + 60s`（提供方错误里带重试时间时用它）。
- 冷却期内 `POST /cli/runs` 直接返回 `429 AGENT_QUOTA_EXCEEDED`，分类返回 `ask`。
- 旅伴陪聊与托管周期遇到冷却：陪聊跳过本次触发；托管任务以失败结束并提示，不在冷却中空转。

### 7.10 事件映射

| 来源               | 插件任务事件（游戏内）                     | 服务端 Turn 事件（网页询问）      |
| ------------------ | ------------------------------------------ | --------------------------------- |
| `text`             | 累积，结束时 `assistant.completed`         | `assistant.delta`                 |
| `thought`          | `thought.updated`（截断摘要）              | `thought.updated`                 |
| `tool.call` + 结果 | `tool.started` / `tool.completed`          | `tool.started` / `tool.completed` |
| `usage`            | `usage.updated`                            | `model.completed.usage`           |
| `done`             | `assistant.completed` / `progress.updated` | `turn.completed`                  |
| `error`            | 任务失败（现有路径）                       | `turn.failed { code, message }`   |

游戏内事件经现有 `ext-task.server.ts` 的 `mappedEvent` 到达网页，旅伴面板、侧栏、思考时间线不改。

### 7.11 旅伴陪聊

- `scope: 'companion'`，复用键 `companion:<gameId>` + 实例 + 模型 + `toolsetHash`。
- 空闲 5 分钟关闭（参数见 §14）。
- 触发冷却与「同时只跑一个」沿用 `CompanionPanel` 现有逻辑；服务端同一会话的第二个 Run 返回 `409 AGENT_SESSION_BUSY`，插件按现有失败退避处理。

### 7.12 对话上下文

提示词只有 system 与本句，所有提供方（Ollama 与 CLI）一致；之前的轮次既不带入，也不截断或摘要。

| 场景              | 发什么                                                                |
| ----------------- | --------------------------------------------------------------------- |
| 游戏内询问 / 陪聊 | `buildAskMessages` 的 system + 本句（玩家原话在前，精简状态在后）     |
| 游戏内托管        | `playSystem` + `playModelPrompt(goal, cycle)`（每周期都不带上一周期） |
| 网页侧栏询问      | `buildAskMessages` 的 system + 本句                                   |

- 需要之前的内容时，由模型自己调用 `chaya_agent_recall`（MCP 目录 `agent` 组，`lib/game-agent/recall.ts`）：不传 `query` 返回上一轮，传 `query` 按任一关键词搜索请求与回复，`offset` 往前翻页；返回完整轮次，不截断。
  - 游戏内：读同一 `conversationId` 的任务消息（含当前托管任务的早先周期）；外部 MCP 客户端经 `agent.task.recall` 读该游戏的全部任务。
  - 网页侧栏 / 浏览器回合：读本会话的 `session.messages`。
- 写回历史只写玩家原话与最终回复（同 `storePrompt` 语义），不写工具调用与 CLI 的中间输出。
- 同一轮的工具循环过长时，按整条消息丢弃最早的工具往返（至少保留最近 4 条），system 与本句始终保留。

## 8. 配置页

- `AgentSettingsView` 新增「类型」选择：Ollama / Cursor / GPT（Codex）/ Claude / Gemini。
- CLI 类型隐藏服务地址、Temperature、Keep Alive、Token、单次模型请求超时。
- 表单顺序：平台 → 名称 → 授权（Ollama 为服务地址）→ 默认模型 → Temperature / Keep Alive → 各项超时 → 代理 → 操作栏。
- `AgentAuthSection`：按 `AgentAuthStatus` 显示状态行与按钮（需求 §5.1 的状态表）。Cursor 额外显示「所有 Cursor 实例共用本机登录」。
- `AgentAuthDialog`：
  - `browser_link` / `device_code`：显示链接（可复制）与用户码，提示「可在任意设备打开」；
  - `callback_code`：额外显示回填输入框；
  - 弹窗打开期间长轮询；关闭即 `DELETE` 尝试。
- Cloud 模式下 CLI 类型选项禁用，并说明需要 App / 本机服务。
- 本机不可用的类型直接禁用，选项后缀写原因：`GET /api/game-agent/auth` 返回 `providers`（`cliProviderAvailability`），Chaya 尚无授权适配器为「暂不支持」，CLI 不在搜索路径为「本机未安装」。不展示安装命令；已选中的实例保留当前值以便改回其它类型。
- 新类型在游戏内配置页同样可用（授权接口不依赖流式响应）。
- UI 细节按 `$chaya-ui` 与 `docs/technical/chaya-ui-style-guide.md` 实施。

## 9. 错误码

| 代码                            | HTTP | 场景                              | 文案方向                           |
| ------------------------------- | ---- | --------------------------------- | ---------------------------------- |
| `LOCAL_ONLY`                    | 404  | Cloud                             | 需要 App / 本机服务                |
| `AGENT_CLI_NOT_FOUND`           | 424  | `findCli` 找不到                  | 未找到 X CLI + 安装说明            |
| `AGENT_CLI_VERSION_UNSUPPORTED` | 424  | 版本低于锁定版本、协议字段不匹配  | 请升级 X CLI 到 ≥ 版本             |
| `AGENT_AUTH_REQUIRED`           | 401  | Cursor 未登录 / 远程未授权        | 到配置页登录 / 授权                |
| `AGENT_AUTH_EXPIRED`            | 401  | 刷新失败、回写失败、提供方撤销    | 授权已失效，请重新授权             |
| `AGENT_AUTH_IN_PROGRESS`        | 409  | 授权锁冲突                        | 已有授权 / 登录进行中              |
| `AGENT_PROFILE_CHANGED`         | 409  | 授权完成时实例已删除或改类型      | 请刷新后重试                       |
| `AGENT_QUOTA_EXCEEDED`          | 429  | 额度用尽 / 限流 / 冷却中          | 额度不足，X 秒后可重试             |
| `AGENT_MODEL_UNAVAILABLE`       | 422  | 模型不存在或套餐不支持            | 请更换模型                         |
| `AGENT_SESSION_BUSY`            | 409  | 同一会话已有进行中的一轮          | 正在回答上一句                     |
| `AGENT_CLI_BUSY`                | 429  | 全进程 CLI 会话数已满             | Agent 会话过多，稍后再试           |
| `AGENT_CREDENTIAL_LOCKED`       | 409  | 另一 Chaya 进程占用该实例凭证     | 该实例正在另一个 Chaya 中使用      |
| `AGENT_AUTH_CHANGED`            | —    | 授权变更收尾（Run 事件）          | 该实例授权已变更                   |
| `AGENT_CLI_UNSAFE_TOOL`         | —    | 出现非 Chaya 工具调用（Run 事件） | Agent 尝试使用未授权的工具，已停止 |
| `AGENT_CLI_TIMEOUT`             | —    | 单轮超时（Run 事件）              | 本轮超时                           |
| `AGENT_CLI_CRASHED`             | —    | 子进程退出（Run 事件）            | X CLI 异常退出                     |
| `AGENT_SERVICE_DISCONNECTED`    | —    | 存活检测 / 插件 poll 失败         | 与 Chaya 本机服务断开              |

`errors.ts` 按提供方维护「错误信息 / stderr 片段 → 代码」的正则表，未命中归为 `AGENT_CLI_CRASHED`（进程退出）或原样透传消息（ACP / SDK 错误）。正则表随锁定版本一起更新。

## 10. 安全

- **凭证**：静态只存密文（§6.4）；明文只在 `0700` 运行时目录里，随最后一个租约删除；Chaya 启动时清理残留目录。
- **不碰本机登录**：远程授权类型的子进程环境总是显式指向运行时目录；Codex 强制文件存储；Claude 钥匙串项按配置目录区分并在释放时删除。
- **Cursor**：Chaya 不读取其凭证存储，只运行 `status` / `about` / `login` / `logout` / `acp`。`logout` 仅由配置页「退出」触发（确认框说明会退出本机 CLI），先结束所有 Cursor 会话再执行。
- **MCP 端点**：仅本机模式；会话令牌 32 字节随机、`timingSafeEqual` 比较、会话关闭即作废；工具清单只来自本轮 Run；无 Run 时拒绝。
- **CLI 内置能力**：客户端不声明 fs / terminal 能力；非 `chaya` 的权限请求一律拒绝；能关闭的内置工具在启动参数 / 配置里关闭；工作目录为空临时目录。
- **脱敏**：
  - 日志、活动记录、错误消息复用 `lib/integration/tools/types.ts` 的 `redactSecrets` / `redactSecretText`，并补充规则：去掉 `Bearer …`、`sk-…`、JWT 形态、URL 查询里的 `code=` / `token=`；本会话令牌与进行中的用户码作为已知密文传给 `redactSecretText`；
  - 授权挑战与回填码不进日志、聊天记录与同步文档；
  - stderr 只存内存环形缓冲。
- **助手管理工具**：`profile-tools.server.ts` 可建 / 改 CLI 类型，不提供授权、注销、读凭证的工具；返回结果里的授权信息只有 `auth.state`。

## 11. 依赖与版本

| 依赖                       | 用途                      | 说明                                                                                                                                                                                                                                |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agentclientprotocol/sdk` | ACP 客户端                | **未引入**：ESM-only 且要求 `zod` peer；Phase 1 用自写的 `jsonrpc-stdio.server.ts` + `acp-session.server.ts`（initialize / session/new / set_mode / set_model / prompt / cancel / 拒绝权限请求）。Phase 2 需要更多 ACP 能力时再评估 |
| `@openai/codex-sdk`        | Codex 会话                | **未引入**：SDK 只包装 `codex exec`，没有设备码登录、账号读取与模型列表；改为直连 `codex app-server`（`codex-app-server.server.ts`），授权、测试与运行共用一套协议                                                                  |
| `@lydell/node-pty` 1.1.0   | Gemini（Antigravity）授权 | 已引入，与工单系统同版本（自带预编译二进制）。`agy` 登录必须有 TTY。`serverExternalPackages` 排除打包、首次授权时才加载；App 安装包（standalone 追踪平台包、mac 双架构）待打包验证                                                  |
| `socks`                    | SOCKS5 代理桥             | 纯 JS；配合已有的 `undici` `ProxyAgent`（§5.4）                                                                                                                                                                                     |

- Chaya 不捆绑任何 CLI，由玩家自行安装；配置页给出安装命令。
- `resolve-cli.server.ts` 探测版本（`--version`），低于锁定的最低版本报 `AGENT_CLI_VERSION_UNSUPPORTED`。最低版本在实施时按验收通过的版本写进 `PROVIDER_META`。

## 12. 测试

单测（jest）：

| 文件                                                     | 覆盖                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/lib/game-agent/settings-sync.spec.ts`         | 五种类型校验；读者过滤；旧读者改排序 / 删除时 CLI 实例保留                                                                            |
| `__tests__/services/game-agent/cli/run-registry.spec.ts` | 状态机、长轮询、工具转交、上限、卡片等待不计时、30 秒存活、停止后拒绝调用；`runSecret` 校验、未知 `callId` 忽略；无进展判定；结果截断 |
| `__tests__/services/game-agent/cli/mcp-bridge.spec.ts`   | 令牌校验、非回环拒绝、无 Run 拒绝、工具清单只来自 Run                                                                                 |
| `__tests__/services/game-agent/cli/session-pool.spec.ts` | 复用键（模型 / 工具集 / `contextKey` 变化新开）、并发上限与 LRU 关闭、按实例 / 类型收尾                                               |
| `__tests__/services/game-agent/cli/run-cli-ask.spec.ts`  | 网页询问工具集合与 `runAskTurn` 一致（只读过滤、`chaya_agent_*`、无游戏不挂工具）、脱敏、历史写回                                     |
| `__tests__/services/game-agent/cli/event-map.spec.ts`    | ACP 与 Codex 更新 → `CliRunEvent`                                                                                                     |
| `__tests__/services/game-agent/cli/errors.spec.ts`       | 各提供方错误样本 → 错误码                                                                                                             |
| `__tests__/services/game-agent/cli/credentials.spec.ts`  | 加解密 AAD、generation、回写跳过与覆盖规则、重新授权期间的回写丢弃；跨进程锁文件占用 / 残留接管                                       |
| `__tests__/services/game-agent/cli/attempts.spec.ts`     | 锁冲突、45 秒无轮询取消、Profile 变更丢弃、取消不动旧凭证                                                                             |
| `__tests__/services/game-agent/cli/cursor-local.spec.ts` | status / about 解析、登录链接提取、全机锁                                                                                             |
| `__tests__/plugins/agent/runtime/cli-run.spec.ts`        | 插件侧：工具并发执行 + poll 不中断、卡片回传、停止发 DELETE、断线结束、托管间隔退避；历史写回、`phase` 触发 checkpoint、网关模式拒绝  |

假 CLI：`__tests__/fixtures/fake-acp-agent.mjs`（实现 ACP 的最小子集：会话、prompt、按脚本调用 MCP 工具、权限请求、取消）与 `fake-codex` 事件流，用于不依赖真实账号的集成测试。

手动验收按需求 §10 各 Phase 与 §13 清单，用真实账号逐个类型执行；Claude / Gemini 额外验收一次 token 刷新后的回写。

## 13. 实施前验证项

在锁定版本上逐项验证，结论回填本节：

| 项                  | 要确认的事                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor ACP          | 只读模式下能否调 MCP；HTTP MCP + headers 是否支持；是否需要额外参数信任 MCP；模型选项字段                                                     |
| Cursor 重新登录     | `agent login` 成功前是否保留原登录；输出里链接的格式                                                                                          |
| Claude 内置工具     | `_meta.claudeCode.options.disallowedTools` 是否生效；权限拒绝后是否会改用其它内置工具                                                         |
| Claude 钥匙串服务名 | 自定义 `CLAUDE_CONFIG_DIR` 时的钥匙串项命名规则（以工单系统实现为准）                                                                         |
| Gemini 选型         | 已定：与工单系统一致用 Antigravity（`agy`），授权见 §6，测试为 `agy models` + 一轮 `stream-json`（`--mode plan`）；真实 Google 账号授权待验收 |
| Codex 关闭内置工具  | `config.toml` 里关闭 shell / web search 的键名；`read-only` 沙箱下是否仍有 `command_execution`                                                |
| MCP 工具超时        | 各 CLI 的工具调用超时上限与配置方式；Cursor 不可配时启用 `chaya_player_card_wait`                                                             |
| 用量字段            | 各 CLI 是否上报 token 用量；没有时 `usage` 留空                                                                                               |
| Cursor 本机配置     | `agent acp` 是否加载 `~/.cursor/mcp.json`、用户规则、项目外的 `AGENTS.md`；有无开关关闭                                                       |
| 系统 Prompt 投放    | 各 CLI 自定义 / 追加系统 Prompt 的方式；首轮前置时旅伴角色与「只用游戏工具」的遵守程度                                                        |
| Windows             | `.cmd` 垫片启动、进程树结束、`node-pty` 打包；Cursor / Codex 在 Windows 上的登录与凭证位置                                                    |

## 14. 参数

| 参数                         | 值                                  |
| ---------------------------- | ----------------------------------- |
| Cursor 状态检测超时 / 缓存   | 5 秒 / 30 秒                        |
| 授权：拿到挑战超时           | 30 秒                               |
| 授权：整体超时               | 10 分钟                             |
| 授权：无轮询取消             | 45 秒                               |
| 授权 / Run 长轮询 `waitMs`   | 25 秒                               |
| Run 无 poll 视为断开         | 30 秒                               |
| 插件 poll 失败累计放弃       | 20 秒                               |
| 取消宽限 / `SIGTERM` 后      | 2 秒 / 1 秒                         |
| 意图分类超时                 | 20 秒                               |
| 托管周期间隔                 | 5 秒起，无动作加倍，最长 60 秒      |
| 旅伴常驻会话空闲关闭         | 5 分钟（待确认）                    |
| 额度冷却                     | 60 秒或提供方给的重试时间（待确认） |
| 测试连接超时                 | 30 秒                               |
| 卡片等待分段（不可配超时时） | 50 秒                               |
| Run 事件队列上限             | 2000 条                             |
| 全进程 CLI 会话上限          | 4                                   |
| CLI 查找 / 版本缓存          | 60 秒                               |
| 插件侧 CLI 状态缓存          | 10 秒                               |
| stderr 环形缓冲              | 16 KB                               |

## 15. 实施顺序

对应需求 §10 的三个 Phase：

1. **Phase 1：类型与授权**
   1. `providers.ts`、Profile 与同步改动（含读者过滤与测试）。
   2. `secrets.ts` 导出加解密；`credentials/`；`resolve-cli`。
   3. Cursor 本机登录；Codex 设备码；授权接口与配置页。
   4. 测试连接与模型列表（需要最小 ACP / Codex 会话，先做不挂 MCP 的版本）。
2. **Phase 2：询问与陪聊**
   1. `session-pool`、`acp-session`、`codex-session`、`event-map`、`errors`。
   2. `run-registry`、`mcp-bridge`、Run 与 MCP 路由。
   3. 插件 `cli-run.ts`（询问 / 陪聊）、`direct-request` 状态分流、意图分类。
   4. 网页侧栏 `runCliAskTurn`。
   5. 常驻会话与额度冷却。
3. **Phase 3：托管与 Claude / Gemini**
   1. 托管周期（会话复用、间隔退避）、上限强制的端到端验证。
   2. Claude OAuth + 钥匙串；Gemini 选型与授权。
   3. 真实账号的授权、运行、刷新回写验收。
