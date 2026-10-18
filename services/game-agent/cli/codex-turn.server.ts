import type { CodexAppServer } from './codex-app-server.server'
import { AgentCliError } from './errors'

type CodexTurn = { id?: unknown; status?: unknown; error?: { message?: unknown } | null }
type CodexItem = { type?: unknown; text?: unknown; phase?: unknown }

/** Codex's own shell / patch / web tools stay off; Chaya hands it plain text only. */
const NO_BUILTIN_TOOLS = { 'features.shell_tool': false, 'features.apply_patch_freeform': false, 'features.view_image_tool': false, web_search: 'disabled' }

/** One ephemeral read-only thread; resolves with the agent's final message text. */
export async function runCodexTurn(
  server: CodexAppServer,
  input: { cwd: string; model?: string; text: string; baseInstructions?: string; timeoutMs: number; signal?: AbortSignal; label?: string }
): Promise<string> {
  const label = input.label || 'Codex'
  const thread = await server.request<{ thread?: { id?: unknown } }>('thread/start', {
    model: input.model || null,
    cwd: input.cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
    config: NO_BUILTIN_TOOLS,
    ...(input.baseInstructions ? { baseInstructions: input.baseInstructions } : {}),
  })
  const threadId = thread?.thread?.id
  if (typeof threadId !== 'string') throw new AgentCliError('AGENT_CLI_VERSION_UNSUPPORTED', 'Codex CLI 未返回会话，请升级 Codex CLI')
  let lastError = ''
  let deltas = ''
  const messages: { text: string; final: boolean }[] = []
  const offError = server.onNotification('error', (params) => {
    const value = params as { threadId?: unknown; willRetry?: unknown; error?: { message?: unknown } }
    if (value.threadId === threadId && value.willRetry !== true && typeof value.error?.message === 'string') lastError = value.error.message
  })
  const offDelta = server.onNotification('item/agentMessage/delta', (params) => {
    const value = params as { threadId?: unknown; delta?: unknown }
    if (value.threadId === threadId && typeof value.delta === 'string') deltas += value.delta
  })
  const offItem = server.onNotification('item/completed', (params) => {
    const value = params as { threadId?: unknown; item?: CodexItem }
    if (value.threadId === threadId && value.item?.type === 'agentMessage' && typeof value.item.text === 'string')
      messages.push({ text: value.item.text, final: value.item.phase === 'final_answer' })
  })
  let finish: (turn: CodexTurn) => void = () => undefined
  const completed = new Promise<CodexTurn>((resolve) => (finish = resolve))
  const offTurn = server.onNotification('turn/completed', (params) => {
    const value = params as { threadId?: unknown; turn?: CodexTurn }
    if (value.threadId === threadId && value.turn) finish(value.turn)
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const started = await server.request<{ turn?: CodexTurn }>('turn/start', { threadId, input: [{ type: 'text', text: input.text, text_elements: [] }] })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AgentCliError('AGENT_CLI_TIMEOUT', `${label} 运行超时`)), input.timeoutMs)
    })
    const aborted = new Promise<never>((_, reject) =>
      input.signal?.addEventListener('abort', () => reject(new AgentCliError('AGENT_CLI_TIMEOUT', `${label} 运行已取消`)), { once: true })
    )
    const turn =
      started?.turn?.status && started.turn.status !== 'inProgress'
        ? started.turn
        : await Promise.race([completed, timeout, aborted, server.exited.then(() => Promise.reject(new AgentCliError('AGENT_CLI_CRASHED', 'Codex CLI 已退出')))])
    if (turn.status === 'failed') throw new Error(typeof turn.error?.message === 'string' ? turn.error.message : lastError || 'Codex turn failed')
    if (turn.status !== 'completed') throw new AgentCliError('AGENT_CLI_CRASHED', `Codex 回合未完成：${String(turn.status)}`)
    const final = messages.filter((message) => message.final)
    return (final.length ? final : messages).map((message) => message.text).join('\n') || deltas
  } finally {
    clearTimeout(timer)
    offError()
    offDelta()
    offItem()
    offTurn()
  }
}
