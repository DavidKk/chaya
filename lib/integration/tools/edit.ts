import { parseEditAction, parseEditOp } from '@/lib/runtime/edit-ops'

import { optStr } from './args'
import type { AgentCaller } from './live'
import type { ToolImpls } from './types'

/** `chaya_edit_state` / `set` / `action`: the in-game edit page commands, via ChayaAgent (validated here and again in the game). */
export function makeEditTools(call: AgentCaller): ToolImpls {
  return {
    async chaya_edit_state(args) {
      return call(optStr(args, 'gameId'), 'edit.state', {})
    },

    async chaya_edit_set(args) {
      const { gameId: _gameId, ...rest } = args
      return call(optStr(args, 'gameId'), 'edit.apply', { op: parseEditOp(rest) })
    },

    async chaya_edit_action(args) {
      const { gameId: _gameId, ...rest } = args
      return call(optStr(args, 'gameId'), 'edit.action', { action: parseEditAction(rest) })
    },
  }
}
