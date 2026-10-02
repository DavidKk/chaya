/**
 * In-memory command board between the MCP endpoint and in-game ChayaAgent (local / app only).
 * Survives dev HMR via globalThis, like the WebRTC signaling board.
 */
import { randomUUID } from 'node:crypto'

import { AGENT_CALL_TIMEOUT_MS, AGENT_GAME_TTL_MS, type AgentCommand, type AgentGameInfo, type AgentMethod, type AgentParams, type AgentResult } from '@/lib/runtime/agent-protocol'
import { type PluginToolMeta, pluginToolName } from '@/lib/runtime/plugin-tools'

type Pending = { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

type GameSlot = {
  roomId: string
  info: AgentGameInfo
  lastSeen: number
  queue: AgentCommand[]
  /** Wakes the in-flight long-poll when a command is queued */
  wake: (() => void) | null
  pending: Map<string, Pending>
}

export type AgentGameSummary = { gameId: string; lastSeenMs: number; toolCount: number } & Omit<AgentGameInfo, 'tools'>

/** A plugin tool and the online games that declared it */
export type AgentPluginTool = PluginToolMeta & { gameIds: string[] }

const STORE_KEY = '__chaya_agent_bridge_v1__'

function board(): Map<string, GameSlot> {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, GameSlot> }
  return (g[STORE_KEY] ??= new Map())
}

function slot(roomId: string): GameSlot {
  const b = board()
  let s = b.get(roomId)
  if (!s) {
    s = { roomId, info: {}, lastSeen: 0, queue: [], wake: null, pending: new Map() }
    b.set(roomId, s)
  }
  return s
}

function isLive(s: GameSlot, now = Date.now()) {
  return now - s.lastSeen <= AGENT_GAME_TTL_MS
}

export function listAgentGames(): AgentGameSummary[] {
  const now = Date.now()
  return [...board().values()]
    .filter((s) => isLive(s, now))
    .map((s) => {
      const { tools, ...info } = s.info
      return { gameId: s.roomId, lastSeenMs: now - s.lastSeen, toolCount: tools?.length ?? 0, ...info }
    })
}

/** Plugin tools across online games, deduped by generated name. */
export function listPluginTools(): AgentPluginTool[] {
  const now = Date.now()
  const byName = new Map<string, AgentPluginTool>()
  for (const s of board().values()) {
    if (!isLive(s, now)) continue
    for (const tool of s.info.tools ?? []) {
      const name = pluginToolName(tool.plugin, tool.tool)
      const hit = byName.get(name)
      if (hit) hit.gameIds.push(s.roomId)
      else byName.set(name, { ...tool, gameIds: [s.roomId] })
    }
  }
  return [...byName.values()]
}

function deliver(s: GameSlot, results: AgentResult[]) {
  for (const result of results) {
    const pending = s.pending.get(result.id)
    if (!pending) continue
    s.pending.delete(result.id)
    clearTimeout(pending.timer)
    if (result.ok) pending.resolve(result.data)
    else pending.reject(new Error(result.error || '游戏端执行失败'))
  }
}

/** Game side: record presence + results, then hold until commands arrive or `waitMs` elapses. */
export async function pollAgentCommands(roomId: string, input: { info?: AgentGameInfo; results?: AgentResult[]; waitMs: number; signal?: AbortSignal }): Promise<AgentCommand[]> {
  const s = slot(roomId)
  s.lastSeen = Date.now()
  if (input.info) s.info = input.info
  if (input.results?.length) deliver(s, input.results)

  if (!s.queue.length && input.waitMs > 0) {
    s.wake?.()
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', done)
        if (s.wake === done) s.wake = null
        resolve()
      }
      const timer = setTimeout(done, input.waitMs)
      input.signal?.addEventListener('abort', done)
      s.wake = done
    })
    s.lastSeen = Date.now()
  }
  return s.queue.splice(0)
}

export class AgentBridgeError extends Error {}

/** Resolve the target game: explicit id, or the only connected one. */
export function resolveAgentGame(gameId?: string): string {
  const live = listAgentGames()
  if (gameId) {
    if (!live.some((g) => g.gameId === gameId)) throw new AgentBridgeError(`游戏 ${gameId} 未连接（需已安装 ChayaAgent 插件并从 Chaya 启动）`)
    return gameId
  }
  if (live.length === 1) return live[0].gameId
  if (!live.length) throw new AgentBridgeError('没有已连接的游戏：请从 Chaya 启动游戏，并确认已加载 ChayaAgent 插件')
  throw new AgentBridgeError(`有 ${live.length} 个游戏在线，请传 gameId：${live.map((g) => `${g.gameId}(${g.name || '?'})`).join(', ')}`)
}

/** MCP side: queue a command for the game and wait for its result. */
export function callAgentGame<M extends AgentMethod>(roomId: string, method: M, params: AgentParams<M>, timeoutMs = AGENT_CALL_TIMEOUT_MS): Promise<unknown> {
  const s = slot(roomId)
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id)
      s.queue = s.queue.filter((cmd) => cmd.id !== id)
      reject(new AgentBridgeError(`游戏 ${timeoutMs / 1000}s 内未响应（可能停在加载或已关闭）`))
    }, timeoutMs)
    s.pending.set(id, { resolve, reject, timer })
    s.queue.push({ id, method, params } as AgentCommand)
    s.wake?.()
  })
}

/** Test helper */
export function resetAgentBridge() {
  for (const s of board().values()) {
    for (const p of s.pending.values()) clearTimeout(p.timer)
    s.wake?.()
  }
  board().clear()
}
