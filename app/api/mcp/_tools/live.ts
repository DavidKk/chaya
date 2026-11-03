import { quitLaunchedGame } from '@/app/api/mcp/_tools/game'
import { readEventRuntime } from '@/lib/game/events/runtime'
import { optStr, type ToolRun } from '@/lib/integration/tools/args'
import { makeEditTools } from '@/lib/integration/tools/edit'
import { type AgentCaller, makeLiveTools } from '@/lib/integration/tools/live'
import { makeSaveTools } from '@/lib/integration/tools/saves'
import { makeSkillTools } from '@/lib/integration/tools/skills'
import { callAgentGame, listAgentGames, resolveAgentGame } from '@/services/runtime/agent-bridge'

export const callBridgeAgent: AgentCaller = (gameId, method, params) => callAgentGame(resolveAgentGame(gameId), method, params)

/** The launch route only reaches games with the translator runtime and ignores gameId; it is the fallback. */
const quitGame: ToolRun = async (args, ctx) => (listAgentGames().length ? callBridgeAgent(optStr(args, 'gameId'), 'game.quit', {}) : quitLaunchedGame(args, ctx))

const baseLiveTools = makeLiveTools({ games: listAgentGames, call: callBridgeAgent, quit: quitGame })
const baseSaveTools = makeSaveTools(callBridgeAgent)
const baseEditTools = makeEditTools(callBridgeAgent)
const baseSkillTools = makeSkillTools()

export const liveTools = {
  ...baseLiveTools,
  ...baseSaveTools,
  ...baseEditTools,
  ...baseSkillTools,
  // Legacy local games can be inspected without reloading and losing the stuck scene.
  async chaya_live_events(args: Record<string, unknown>) {
    const gameId = optStr(args, 'gameId')
    try {
      return await callBridgeAgent(gameId, 'game.events', {})
    } catch (error) {
      if (!(error instanceof Error) || error.message !== '未知指令：game.events') throw error
      return callBridgeAgent(gameId, 'game.eval', { code: `return (${readEventRuntime.toString()})(globalThis);` })
    }
  },
} as typeof baseLiveTools & typeof baseSaveTools & typeof baseEditTools & typeof baseSkillTools
