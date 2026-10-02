import { AGENT_INPUT_KEYS, type AgentInputKey } from '@/lib/runtime/agent-protocol'
import { callAgentGame, listAgentGames, resolveAgentGame } from '@/services/runtime/agent-bridge'

import { optList, optNum, optStr, reqStr, type ToolImpls } from './args'

const target = (args: Record<string, unknown>) => resolveAgentGame(optStr(args, 'gameId'))

export const liveTools: ToolImpls = {
  async chaya_live_games() {
    return { games: listAgentGames() }
  },

  async chaya_live_state(args) {
    return callAgentGame(target(args), 'game.state', {})
  },

  async chaya_live_plugins(args) {
    return callAgentGame(target(args), 'plugins.list', {})
  },

  async chaya_live_call(args) {
    const plugin = reqStr(args, 'plugin')
    const method = reqStr(args, 'method')
    const chain = optList(args, 'chain').map((step) => {
      const s = (step ?? {}) as Record<string, unknown>
      return { method: reqStr(s, 'method'), args: optList(s, 'args') }
    })
    return callAgentGame(target(args), 'plugin.call', { plugin, method, args: optList(args, 'args'), chain })
  },

  async chaya_live_press(args) {
    const key = reqStr(args, 'key') as AgentInputKey
    if (!AGENT_INPUT_KEYS.includes(key)) throw new Error(`key 只能是：${AGENT_INPUT_KEYS.join(', ')}`)
    return callAgentGame(target(args), 'input.press', { key, frames: optNum(args, 'frames') })
  },

  async chaya_live_eval(args) {
    return callAgentGame(target(args), 'game.eval', { code: reqStr(args, 'code') })
  },
}
