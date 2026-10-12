import { AgentCliError } from './errors'
import { JsonRpcError, type JsonRpcProcess, startJsonRpcProcess } from './jsonrpc-stdio.server'

export type AcpModel = { id: string; name: string }

export type AcpPromptResult = { text: string; stopReason: string }

export type AcpSession = {
  readonly sessionId: string
  readonly models: AcpModel[]
  readonly currentModelId?: string
  readonly modeIds: string[]
  setMode(modeId: string): Promise<void>
  setModel(modelId: string): Promise<void>
  prompt(text: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<AcpPromptResult>
  stderr(): string
  close(): void
}

type PermissionOption = { optionId?: unknown; kind?: unknown }
type SessionNew = {
  sessionId?: unknown
  models?: { currentModelId?: unknown; availableModels?: { modelId?: unknown; name?: unknown }[] } | null
  modes?: { availableModes?: { id?: unknown }[] } | null
}
type SessionUpdate = { sessionId?: unknown; update?: { sessionUpdate?: unknown; content?: { type?: unknown; text?: unknown } } }

const INIT_TIMEOUT_MS = 20_000
const SESSION_TIMEOUT_MS = 30_000
const CANCEL_GRACE_MS = 2_000

/** Rejects every tool permission: Phase 1 sessions carry no Chaya MCP tools, so nothing is allowed through. */
function rejectPermission(params: unknown) {
  const options = ((params as { options?: PermissionOption[] })?.options || []).filter((option) => typeof option.optionId === 'string')
  const reject = options.find((option) => option.kind === 'reject_once') || options.find((option) => option.kind === 'reject_always')
  return { outcome: reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' } }
}

function parseModels(value: SessionNew['models']): AcpModel[] {
  return (value?.availableModels || []).flatMap((model) =>
    typeof model.modelId === 'string' && model.modelId ? [{ id: model.modelId, name: typeof model.name === 'string' && model.name ? model.name : model.modelId }] : []
  )
}

export type AcpClient = {
  /** Fresh conversation on the running process; much cheaper than starting the CLI again. */
  newSession(cwd: string): Promise<AcpSession>
  readonly closed: boolean
  stderr(): string
  close(): void
}

type AcpInput = { file: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; label: string }

/** Minimal ACP client: no fs / terminal capabilities, no MCP servers, every permission rejected. */
export async function startAcpClient(input: AcpInput): Promise<AcpClient> {
  const rpc: JsonRpcProcess = startJsonRpcProcess({
    file: input.file,
    args: input.args,
    env: input.env,
    cwd: input.cwd,
    label: input.label,
    jsonrpc: true,
    onRequest(method, params) {
      if (method === 'session/request_permission') return rejectPermission(params)
      throw new JsonRpcError('Method not supported by Chaya', -32601)
    },
  })
  try {
    const init = await rpc.request<{ protocolVersion?: unknown }>(
      'initialize',
      { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'chaya', version: '0.0.0' } },
      INIT_TIMEOUT_MS
    )
    if (init?.protocolVersion !== 1) throw new AgentCliError('AGENT_CLI_VERSION_UNSUPPORTED', `${input.label} 的 ACP 协议版本不受支持`)
  } catch (error) {
    rpc.close()
    throw error
  }
  return {
    newSession: (cwd) => openSession(rpc, input.label, cwd),
    get closed() {
      return rpc.closed
    },
    stderr: () => rpc.stderr(),
    close: () => rpc.close(),
  }
}

async function openSession(rpc: JsonRpcProcess, label: string, cwd: string): Promise<AcpSession> {
  const created = await rpc.request<SessionNew>('session/new', { cwd, mcpServers: [] }, SESSION_TIMEOUT_MS)
  if (typeof created?.sessionId !== 'string') throw new AgentCliError('AGENT_CLI_VERSION_UNSUPPORTED', `${label} 未返回 ACP 会话`)
  const sessionId = created.sessionId
  let busy = false

  return {
    sessionId,
    models: parseModels(created.models),
    currentModelId: typeof created.models?.currentModelId === 'string' ? created.models.currentModelId : undefined,
    modeIds: (created.modes?.availableModes || []).flatMap((mode) => (typeof mode.id === 'string' ? [mode.id] : [])),
    async setMode(modeId) {
      await rpc.request('session/set_mode', { sessionId, modeId })
    },
    async setModel(modelId) {
      await rpc.request('session/set_model', { sessionId, modelId })
    },
    async prompt(text, options) {
      if (busy) throw new AgentCliError('AGENT_SESSION_BUSY', `${label} 正在回答上一句`)
      busy = true
      let reply = ''
      const stop = rpc.onNotification('session/update', (params) => {
        const { sessionId: id, update } = (params || {}) as SessionUpdate
        if (id === sessionId && update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string')
          reply += update.content.text
      })
      const cancel = () => {
        rpc.notify('session/cancel', { sessionId })
        setTimeout(() => rpc.close(), CANCEL_GRACE_MS).unref()
      }
      options.signal?.addEventListener('abort', cancel, { once: true })
      try {
        const result = await rpc.request<{ stopReason?: unknown }>('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, options.timeoutMs)
        return { text: reply, stopReason: typeof result?.stopReason === 'string' ? result.stopReason : 'end_turn' }
      } catch (error) {
        if (error instanceof AgentCliError && error.code === 'AGENT_CLI_TIMEOUT') cancel()
        throw error
      } finally {
        busy = false
        stop()
        options.signal?.removeEventListener('abort', cancel)
      }
    },
    stderr: () => rpc.stderr(),
    close: () => rpc.close(),
  }
}

/** One-off session that owns its process: `close()` ends the CLI. Used by connection tests and model lists. */
export async function startAcpSession(input: AcpInput): Promise<AcpSession> {
  const client = await startAcpClient(input)
  try {
    return await client.newSession(input.cwd)
  } catch (error) {
    client.close()
    throw error
  }
}
