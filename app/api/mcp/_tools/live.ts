import { quitLaunchedGame } from '@/app/api/mcp/_tools/game'
import { optStr, type ToolRun } from '@/lib/integration/tools/args'
import { makeEditTools } from '@/lib/integration/tools/edit'
import { type AgentCaller, makeLiveTools } from '@/lib/integration/tools/live'
import { callAgentGame, listAgentGames, resolveAgentGame } from '@/services/runtime/agent-bridge'

export const callBridgeAgent: AgentCaller = (gameId, method, params) => callAgentGame(resolveAgentGame(gameId), method, params)

/** The launch route only reaches games with the translator runtime and ignores gameId; it is the fallback. */
const quitGame: ToolRun = async (args, ctx) => (listAgentGames().length ? callBridgeAgent(optStr(args, 'gameId'), 'game.quit', {}) : quitLaunchedGame(args, ctx))

export const liveTools = { ...makeLiveTools({ games: listAgentGames, call: callBridgeAgent, quit: quitGame }), ...makeEditTools(callBridgeAgent) }
