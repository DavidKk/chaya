/**
 * ChayaAgent — runs MCP / WebMCP commands in-game.
 * Local: Agent → /api/mcp → agent bridge queue → POST /api/runtime/agent (this loop) → ChayaEdit / ChayaBoost / ChayaTrans.
 * Cloud: page WebMCP → game DataChannel → `window.ChayaAgent.run`; external agents → fixed-port gateway (`./gateway`). Neither evals.
 */

import { PLUGIN_AGENT_NAME } from '@/constants/brand'
import type { McpGatewayControl } from '@/lib/integration/mcp-gateway'
import type { AgentCommand, AgentGameInfo, AgentPollRequest, AgentPollResponse, AgentResult } from '@/lib/runtime/agent-protocol'

import { chayaFetch, chayaPostJson, createLogger, detectGameIdentity, gameRoomId } from '../helpers'
import { listPluginToolMetas } from '../helpers/plugin-tools'
import { pluginStorageCall } from '../helpers/storage/client'
import { startGameGateway } from './gateway'
import { runAgentCommand, startManualInputTracking, startReactionTracking } from './handlers'
import { startHistory } from './history'
import { startRenderedTextCapture } from './rendered-text'
import { createGameAgentRuntime } from './runtime/host'

const log = createLogger(PLUGIN_AGENT_NAME)

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000
/** Server answered 404: not a local (disk) service — check again rarely. */
const DISABLED_RETRY_MS = 5 * 60_000

type AgentGlobal = {
  stop: () => void
  status: () => { running: boolean; roomId: string; handled: number }
  /** Run one command for the DataChannel route; never evals */
  run: (cmd: AgentCommand) => Promise<unknown>
  /** Unified MCP gateway status / port management for the in-game panel */
  gateway: McpGatewayControl
  handleTask: (
    message: import('@/lib/runtime/game-link-protocol').AgentTaskMessage,
    send: (message: import('@/lib/runtime/game-link-protocol').AgentTaskMessage) => void
  ) => boolean
  cancelRemoteAuthorization: () => void
  taskRequest: (message: Exclude<import('@/lib/runtime/game-link-protocol').AgentTaskMessage, { type: 'agent.task.result' }>, signal?: AbortSignal) => Promise<unknown>
}

declare global {
  interface Window {
    ChayaAgent?: AgentGlobal
    __chayaStopAgent?: () => void
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function gameInfo(): AgentGameInfo {
  const id = detectGameIdentity()
  const plugins = Object.keys(window).filter((k) => /^Chaya[A-Z]\w*$/.test(k))
  return { name: id?.name || document.title || undefined, gameRoot: id?.gameRoot, contentRoot: id?.contentRoot, plugins, tools: listPluginToolMetas() }
}

async function execute(cmd: AgentCommand): Promise<AgentResult> {
  try {
    return { id: cmd.id, ok: true, data: await runAgentCommand(cmd, { allowEval: true }) }
  } catch (err) {
    const failure = err as { code?: string; retryable?: boolean } | null
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err), code: failure?.code, retryable: failure?.retryable }
  }
}

async function start(): Promise<AgentGlobal & { runPoll: () => void }> {
  const identity = detectGameIdentity()
  if (!identity) throw new Error('Agent requires a verified local game')
  const storage = await pluginStorageCall<{ gameId: string }>('game.mount', [identity.contentRoot])
  let running = true
  let handled = 0
  const gateway = startGameGateway({ gameId: gameRoomId, gameInfo: () => ({ ...gameInfo(), tools: undefined }), log })
  const stopHistory = startHistory()
  const stopInputTracking = startManualInputTracking()
  const stopReactionTracking = startReactionTracking()
  const stopRenderedTextCapture = startRenderedTextCapture()
  const tasks = createGameAgentRuntime(storage.gameId)
  let pollAbort = new AbortController()
  let polling = false
  let disposed = false
  let resolveStopped = () => {}
  let stopped: Promise<void> = Promise.resolve()

  const disposeRuntime = () => {
    if (disposed) return
    disposed = true
    stopHistory()
    stopInputTracking()
    stopReactionTracking()
    stopRenderedTextCapture()
    tasks.dispose()
    void gateway.stop()
  }

  const runPoll = () => {
    if (polling) return
    polling = true
    stopped = new Promise((resolve) => {
      resolveStopped = resolve
    })
    void (async () => {
      let pending: AgentResult[] = []
      let retry = RETRY_MIN_MS
      let warned = false
      try {
        while (running) {
          pollAbort = new AbortController()
          try {
            const body: AgentPollRequest = { roomId: gameRoomId(), info: gameInfo(), results: pending }
            const res = await chayaFetch('/api/runtime/agent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: pollAbort.signal,
            })
            if (!running) break
            if (res.status === 404) {
              if (!warned) log.info('Local Agent bridge unavailable in browser mode; Agent tools are provided through the game connection (WebMCP)')
              warned = true
              await sleep(DISABLED_RETRY_MS)
              continue
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            pending = []
            retry = RETRY_MIN_MS
            const { commands } = (await res.json()) as AgentPollResponse
            if (commands?.length) {
              pending = await Promise.all(commands.map(execute))
              handled += commands.length
            }
            if (!running) break
          } catch (err) {
            if (!running) break
            log.warn(`Agent bridge connection failed; retrying in ${Math.round(retry / 1000)}s: ${err instanceof Error ? err.message : String(err)}`)
            await sleep(retry)
            retry = Math.min(retry * 2, RETRY_MAX_MS)
          }
        }
        if (pending.length) {
          await chayaPostJson('/api/runtime/agent', { roomId: gameRoomId(), info: gameInfo(), results: pending }).catch(() => undefined)
        }
      } finally {
        resolveStopped()
      }
    })()
  }

  return {
    runPoll,
    stop: () => {
      running = false
      pollAbort.abort()
      return stopped.then(disposeRuntime)
    },
    status: () => ({ running, roomId: gameRoomId(), handled }),
    run: async (cmd) => {
      handled += 1
      return runAgentCommand(cmd)
    },
    gateway: gateway.control,
    handleTask: tasks.handle,
    taskRequest: tasks.request,
    cancelRemoteAuthorization: tasks.cancelRemoteAuthorization,
  }
}

// Hot reload and a failed boot must leave the running game and its previous agent in place.
const bootToken = {}
const bootHost = window as Window & { __chayaAgentBoot?: object }
bootHost.__chayaAgentBoot = bootToken
void start()
  .then(async (agent) => {
    if (bootHost.__chayaAgentBoot !== bootToken) {
      await agent.stop()
      return
    }
    const previous = window.ChayaAgent
    window.ChayaAgent = agent
    window.__chayaStopAgent = () => {
      void agent.stop()
    }
    try {
      await previous?.stop()
    } catch (err) {
      log.warn(`Previous Agent failed to stop: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    }
    if (bootHost.__chayaAgentBoot !== bootToken) {
      await agent.stop()
      return
    }
    agent.runPoll()
    log.ok('Agent bridge started: local MCP (/api/mcp) or browser WebMCP can control the game')
  })
  .catch((err: unknown) => {
    if (bootHost.__chayaAgentBoot !== bootToken) return
    log.fail(`Agent bridge failed to start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  })
