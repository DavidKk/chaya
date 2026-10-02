import { AGENT_INPUT_KEYS, type AgentInputKey, type AgentMethod, type AgentParams } from '@/lib/runtime/agent-protocol'
import type { PluginToolMeta } from '@/lib/runtime/plugin-tools'

import { optList, optNum, optObj, optStr, reqStr } from './args'
import type { ToolImpls, ToolRun } from './types'

/** Runs one ChayaAgent command on a game (`gameId` optional when only one game is reachable). */
export type AgentCaller = <M extends AgentMethod>(gameId: string | undefined, method: M, params: AgentParams<M>) => Promise<unknown>

export type LiveDeps = {
  games: () => unknown
  call: AgentCaller
}

/** `chaya_live_*`; the server talks to ChayaAgent over the long-poll bridge, Edge pages over the DataChannel. */
export function makeLiveTools({ games, call }: LiveDeps): ToolImpls {
  return {
    async chaya_live_games() {
      return { games: await games() }
    },

    async chaya_live_state(args) {
      return call(optStr(args, 'gameId'), 'game.state', {})
    },

    async chaya_live_plugins(args) {
      return call(optStr(args, 'gameId'), 'plugins.list', {})
    },

    async chaya_live_call(args) {
      const gameId = optStr(args, 'gameId')
      const plugin = reqStr(args, 'plugin')
      const tool = optStr(args, 'tool')
      if (tool) return call(gameId, 'plugin.tool', { plugin, tool, input: optObj(args, 'input') ?? {} })
      const method = optStr(args, 'method')
      if (!method) throw new Error('需要 method 或 tool')
      const chain = optList(args, 'chain').map((step) => {
        const s = (step ?? {}) as Record<string, unknown>
        return { method: reqStr(s, 'method'), args: optList(s, 'args') }
      })
      return call(gameId, 'plugin.call', { plugin, method, args: optList(args, 'args'), chain })
    },

    async chaya_live_press(args) {
      const key = reqStr(args, 'key') as AgentInputKey
      if (!AGENT_INPUT_KEYS.includes(key)) throw new Error(`key 只能是：${AGENT_INPUT_KEYS.join(', ')}`)
      return call(optStr(args, 'gameId'), 'input.press', { key, frames: optNum(args, 'frames') })
    },

    async chaya_live_eval(args) {
      return call(optStr(args, 'gameId'), 'game.eval', { code: reqStr(args, 'code') })
    },
  }
}

/** Executor for a generated `chaya_plugin_*` tool: everything except `gameId` is the tool input. */
export function pluginToolRun(meta: Pick<PluginToolMeta, 'plugin' | 'tool'>, call: AgentCaller): ToolRun {
  return async (args) => {
    const { gameId, ...input } = args
    return call(typeof gameId === 'string' && gameId.trim() ? gameId.trim() : undefined, 'plugin.tool', { plugin: meta.plugin, tool: meta.tool, input })
  }
}
