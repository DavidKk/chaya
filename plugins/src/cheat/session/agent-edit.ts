/**
 * `window.ChayaEdit.agentEdit`: the edit page's commands for ChayaAgent (`edit.state` / `edit.apply` / `edit.action`).
 * Agents change values only through these presets — same validation, locks and page sync as the edit page.
 */
import { type EditAction, parseEditAction, parseEditOp } from '@/lib/runtime/edit-ops'
import { fieldsForEditCmd } from '@/lib/runtime/game-edit-sync'
import type { GameEditCmd, GameEditCmdOp } from '@/lib/runtime/game-link-protocol'

import { Cheats } from '../runtime/cheats'
import { applyEditCmd, buildStateMsg, pushRemoteState } from './remote-bridge'

function state() {
  const { ready, error, session } = buildStateMsg()
  return { ready, ...(error ? { error } : {}), session }
}

function apply(raw: GameEditCmdOp) {
  const op = parseEditOp(raw as unknown as Record<string, unknown>)
  const cmd = { type: 'edit.cmd', ...op } as GameEditCmd
  applyEditCmd(cmd)
  pushRemoteState()
  return { applied: true, fields: fieldsForEditCmd(cmd) }
}

async function action(raw: EditAction) {
  const act = parseEditAction(raw as unknown as Record<string, unknown>)
  switch (act.id) {
    case 'teleport':
      if (!Cheats.teleport(act.mapId, act.x, act.y, act.direction)) throw new Error('传送失败：请在地图场景中重试')
      return { done: true, ...act }
    case 'common_event':
      if (!Cheats.runCommonEvent(act.eventId)) throw new Error(`公共事件不存在或无法执行：${act.eventId}`)
      return { done: true, ...act }
    case 'save':
      if (!(await Cheats.saveGame(act.slot))) throw new Error(`保存文件 ${act.slot} 失败`)
      return { ok: true, done: true, ...act }
    case 'load':
      if (!(await Cheats.loadGame(act.slot))) throw new Error(`读取文件 ${act.slot} 失败或文件不存在`)
      return { ok: true, done: true, ...act }
    default:
      applyEditCmd({ type: 'edit.cmd', op: 'runAction', id: act.id } as GameEditCmd)
      pushRemoteState()
      return { done: true, id: act.id }
  }
}

export const agentEdit = { state, apply, action }
