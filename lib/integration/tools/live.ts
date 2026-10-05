import {
  AGENT_HISTORY_KINDS,
  AGENT_INPUT_KEYS,
  type AgentHistoryKind,
  type AgentInputKey,
  type AgentInputStep,
  type AgentMethod,
  type AgentParams,
} from '@/lib/runtime/agent-protocol'
import type { PluginToolMeta } from '@/lib/runtime/plugin-tools'

import { optList, optNum, optObj, optStr, reqStr } from './args'
import { mcpImage, type ToolImpls, type ToolRun } from './types'

/** Runs one ChayaAgent command on a game (`gameId` optional when only one game is reachable). */
export type AgentCaller = <M extends AgentMethod>(gameId: string | undefined, method: M, params: AgentParams<M>) => Promise<unknown>

export type LiveDeps = {
  games: () => unknown
  call: AgentCaller
  /** How this host closes the game; defaults to the in-game `game.quit` */
  quit?: ToolRun
}

function reqNum(args: Record<string, unknown>, key: string): number {
  const value = optNum(args, key)
  if (value === undefined) throw new Error(`缺少参数 ${key}`)
  return value
}

/** `chaya_live_*` (game operations + declared plugin tools); the server talks to ChayaAgent over the long-poll bridge, Edge pages over the DataChannel. */
export function makeLiveTools({ games, call, quit }: LiveDeps): ToolImpls {
  return {
    async chaya_live_games() {
      return { games: await games() }
    },

    async chaya_live_state(args) {
      return call(optStr(args, 'gameId'), 'game.state', {})
    },

    async chaya_live_history(args) {
      const kinds = optList(args, 'kinds').map((kind) => {
        if (!AGENT_HISTORY_KINDS.includes(kind as AgentHistoryKind)) throw new Error(`kinds 只能包含：${AGENT_HISTORY_KINDS.join(', ')}`)
        return kind as AgentHistoryKind
      })
      return call(optStr(args, 'gameId'), 'game.history', {
        limit: optNum(args, 'limit'),
        afterSeq: optNum(args, 'afterSeq'),
        ...(kinds.length ? { kinds } : {}),
      })
    },

    async chaya_live_screenshot(args) {
      const shot = (await call(optStr(args, 'gameId'), 'game.snap', { maxWidth: optNum(args, 'maxWidth') })) as {
        mimeType: string
        data: string
        width: number
        height: number
        screen: unknown
      }
      return mcpImage(shot, { width: shot.width, height: shot.height, screen: shot.screen })
    },

    async chaya_live_plugins(args) {
      return call(optStr(args, 'gameId'), 'plugins.list', {})
    },

    async chaya_live_call(args) {
      return call(optStr(args, 'gameId'), 'plugin.tool', { plugin: reqStr(args, 'plugin'), tool: reqStr(args, 'tool'), input: optObj(args, 'input') ?? {} })
    },

    async chaya_live_press(args) {
      const key = reqStr(args, 'key') as AgentInputKey
      if (!AGENT_INPUT_KEYS.includes(key)) throw new Error(`key 只能是：${AGENT_INPUT_KEYS.join(', ')}`)
      return call(optStr(args, 'gameId'), 'input.press', { key, frames: optNum(args, 'frames') })
    },

    async chaya_live_play(args) {
      const steps = optList(args, 'steps').map((step, index): AgentInputStep => {
        if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`steps[${index}] 必须是对象`)
        const item = step as Record<string, unknown>
        const key = reqStr(item, 'key') as AgentInputKey
        if (!AGENT_INPUT_KEYS.includes(key)) throw new Error(`steps[${index}].key 只能是：${AGENT_INPUT_KEYS.join(', ')}`)
        return { key, frames: optNum(item, 'frames'), waitFrames: optNum(item, 'waitFrames') }
      })
      if (!steps.length) throw new Error('steps 不能为空')
      return call(optStr(args, 'gameId'), 'input.sequence', { steps })
    },

    async chaya_live_tap(args) {
      return call(optStr(args, 'gameId'), 'input.tap', { x: reqNum(args, 'x'), y: reqNum(args, 'y'), frames: optNum(args, 'frames') })
    },

    async chaya_live_move_to(args) {
      return call(optStr(args, 'gameId'), 'player.moveTo', { x: reqNum(args, 'x'), y: reqNum(args, 'y'), timeoutMs: optNum(args, 'timeoutMs') })
    },

    chaya_live_quit: quit ?? (async (args) => call(optStr(args, 'gameId'), 'game.quit', {})),

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
