/**
 * ChayaAgent — runs MCP / WebMCP commands in-game.
 * Local: Agent → /api/mcp → agent bridge queue → POST /api/runtime/agent (this loop) → window.Chaya*.
 * Edge: page WebMCP → game DataChannel → `window.ChayaAgent.run` (eval refused on that path).
 */

import { PLUGIN_AGENT_NAME } from '@/constants/brand'
import type { AgentCommand, AgentGameInfo, AgentPollRequest, AgentPollResponse, AgentResult } from '@/lib/runtime/agent-protocol'

import { chayaPostJson, createLogger, detectGameIdentity, gameRoomId } from '../helpers'
import { listPluginToolMetas } from '../helpers/plugin-tools'
import { runAgentCommand } from './handlers'

const log = createLogger(PLUGIN_AGENT_NAME)

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000
/** Server answered 404: not a local (disk) service — check again rarely. */
const DISABLED_RETRY_MS = 5 * 60_000

type AgentGlobal = {
  stop: () => void
  status: () => { running: boolean; roomId: string; handled: number }
  /** Run one command (used by the DataChannel route; it filters methods first) */
  run: (cmd: AgentCommand) => Promise<unknown>
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
    return { id: cmd.id, ok: true, data: await runAgentCommand(cmd) }
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function start(): AgentGlobal {
  let running = true
  let handled = 0

  void (async () => {
    let pending: AgentResult[] = []
    let retry = RETRY_MIN_MS
    let warned = false
    while (running) {
      try {
        const body: AgentPollRequest = { roomId: gameRoomId(), info: gameInfo(), results: pending }
        const res = await chayaPostJson('/api/runtime/agent', body)
        if (res.status === 404) {
          if (!warned) log.info('网页版无本机 Agent 桥，Agent 能力经游戏连接（WebMCP）提供')
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
      } catch (err) {
        if (!running) break
        log.warn(`Agent 桥连接失败，${Math.round(retry / 1000)}s 后重试：${err instanceof Error ? err.message : String(err)}`)
        await sleep(retry)
        retry = Math.min(retry * 2, RETRY_MAX_MS)
      }
    }
  })()

  return {
    stop: () => {
      running = false
    },
    status: () => ({ running, roomId: gameRoomId(), handled }),
    run: async (cmd) => {
      handled += 1
      return runAgentCommand(cmd)
    },
  }
}

window.__chayaStopAgent?.()
const agent = start()
window.ChayaAgent = agent
window.__chayaStopAgent = agent.stop
log.ok('Agent 桥已启动：本机 MCP（/api/mcp）或网页 WebMCP 可控制游戏')
