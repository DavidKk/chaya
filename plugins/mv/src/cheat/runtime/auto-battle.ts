/**
 * Auto battle: force Game_Actor.isAutoBattle so startInput fills actions and
 * starts the turn itself; tick only recovers mid-input / plugin stalls.
 */
import { closeBattleInputWindows } from '../session/battle-windows'
import { gameMessage, gameTroop } from './game-globals'

type AutoActor = {
  canMove?: () => boolean
  makeAutoBattleActions?: () => void
  makeActions?: () => void
}

type CommandWindow = { active?: boolean; deactivate?: () => void; close?: () => void; hide?: () => void }

type BattleGlobals = {
  BattleManager?: { _phase?: string; startTurn?: () => void }
  Scene_Battle?: new () => object
  SceneManager?: { _scene?: object }
  Game_Actor?: { prototype: { isAutoBattle: () => boolean; __chayaAutoBattle?: boolean } }
  $gameParty?: { battleMembers?: () => AutoActor[] }
}

const g = () => globalThis as unknown as BattleGlobals

/** Patch once; forced flag is read live so dispose only clears the run switch. */
export function ensureAutoBattleActorHook(forced: () => boolean) {
  const proto = g().Game_Actor?.prototype
  if (!proto || typeof proto.isAutoBattle !== 'function' || proto.__chayaAutoBattle) return
  const original = proto.isAutoBattle
  proto.isAutoBattle = function (this: unknown) {
    if (forced()) return true
    return original.call(this)
  }
  proto.__chayaAutoBattle = true
}

/**
 * Native auto-battle already finishes most turns inside startInput. This tick
 * only runs when the party is still stuck on input (flag toggled mid-menu,
 * battle plugins that ignore canInput, or actions never filled).
 */
export function tryAutoBattle(enabled: boolean, autoWin: boolean, sceneLatch: object | null): object | null {
  if (!enabled || autoWin) return sceneLatch
  ensureAutoBattleActorHook(() => enabled && !autoWin)
  const { BattleManager, Scene_Battle, SceneManager, $gameParty } = g()
  if (!BattleManager || typeof Scene_Battle !== 'function' || !SceneManager) return sceneLatch
  const scene = SceneManager._scene
  if (!(scene instanceof Scene_Battle)) return null
  if (String(BattleManager._phase) !== 'input') return null
  if (sceneLatch === scene) return sceneLatch
  if (typeof gameTroop()?.isEventRunning === 'function' && gameTroop().isEventRunning()) return sceneLatch
  if (typeof gameMessage()?.isBusy === 'function' && gameMessage().isBusy()) return sceneLatch

  const members = typeof $gameParty?.battleMembers === 'function' ? $gameParty.battleMembers() : []
  let prepared = 0
  for (const actor of members) {
    if (!actor) continue
    // isAutoBattle makes canInput false; still need actions when enabling mid-input.
    if (typeof actor.canMove === 'function' && !actor.canMove()) continue
    if (typeof actor.makeAutoBattleActions === 'function') {
      actor.makeAutoBattleActions()
      prepared += 1
    } else {
      actor.makeActions?.()
      prepared += 1
    }
  }
  if (!prepared && members.length) return sceneLatch

  closeBattleInputWindows()
  const windows = scene as { _partyCommandWindow?: CommandWindow; _actorCommandWindow?: CommandWindow }
  for (const w of [windows._partyCommandWindow, windows._actorCommandWindow]) {
    if (!w) continue
    w.deactivate?.()
    w.close?.()
    w.hide?.()
  }
  const startTurn = BattleManager.startTurn
  if (typeof startTurn !== 'function') return sceneLatch
  startTurn.call(BattleManager)
  // Only latch after the engine actually left input; otherwise retry next tick.
  return String(BattleManager._phase) !== 'input' ? scene : null
}
