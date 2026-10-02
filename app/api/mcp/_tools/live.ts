import { type AgentCaller, makeLiveTools } from '@/lib/integration/tools/live'
import { callAgentGame, listAgentGames, resolveAgentGame } from '@/services/runtime/agent-bridge'

export const callBridgeAgent: AgentCaller = (gameId, method, params) => callAgentGame(resolveAgentGame(gameId), method, params)

export const liveTools = makeLiveTools({ games: listAgentGames, call: callBridgeAgent })
