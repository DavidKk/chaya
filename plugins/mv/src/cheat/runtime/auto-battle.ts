/** Engine hooks and input submission for contextual automatic battles. */
import { closeBattleInputWindows } from '../session/battle-windows'
import { type AutoActor } from './auto-battle-effects'
import { makeSmartAutoBattleActions } from './auto-battle-tactics'
import { gameMessage, gameTroop } from './game-globals'

export { estimateHpRecovery, estimateMpRecovery, getUsableItems, matchBestHealingItem } from './auto-battle-effects'
export { makeSmartAutoBattleActions, selectBestAction } from './auto-battle-tactics'

type CommandWindow = { active?: boolean; deactivate?: () => void; close?: () => void }

type BattleGlobals = {
  BattleManager?: { _phase?: string; startTurn?: () => void; isSTB?: () => boolean; actor?: () => AutoActor | null; selectNextCommand?: () => void }
  Scene_Battle?: new () => object
  SceneManager?: { _scene?: object }
  Game_Actor?: {
    prototype: {
      isAutoBattle: () => boolean
      makeAutoBattleActions?: () => void
      __chayaAutoBattle?: boolean
      __chayaSmartBattle?: boolean
      __chayaAutoBattleForced?: () => boolean
      __chayaSmartBattleActions?: typeof makeSmartAutoBattleActions
    }
  }
  Game_Action?: new (subject: unknown, forcing?: boolean) => any
  $gameParty?: {
    battleMembers?: () => AutoActor[]
    aliveMembers?: () => any[]
    deadMembers?: () => any[]
    items?: () => any[]
    numItems?: (item: any) => number
  }
  $gameTroop?: {
    aliveMembers?: () => any[]
    isEventRunning?: () => boolean
  }
}

const g = () => globalThis as unknown as BattleGlobals

/** Patch once; forced flag is read live so dispose only clears the run switch. */
export function ensureAutoBattleActorHook(forced: () => boolean) {
  const proto = g().Game_Actor?.prototype
  if (!proto) return
  // Hooks survive plugin reloads, but their flag provider belongs to the new runtime.
  proto.__chayaAutoBattleForced = forced
  proto.__chayaSmartBattleActions = makeSmartAutoBattleActions

  if (typeof proto.isAutoBattle === 'function' && !proto.__chayaAutoBattle) {
    const original = proto.isAutoBattle
    proto.isAutoBattle = function (this: unknown) {
      if (proto.__chayaAutoBattleForced?.()) return true
      return original.call(this)
    }
    proto.__chayaAutoBattle = true
  }

  if (typeof proto.makeAutoBattleActions === 'function' && !proto.__chayaSmartBattle) {
    const originalMake = proto.makeAutoBattleActions
    proto.makeAutoBattleActions = function (this: unknown) {
      if (proto.__chayaAutoBattleForced?.()) {
        try {
          proto.__chayaSmartBattleActions?.(this as AutoActor)
        } catch {
          // A third-party action API must not leave the battle stuck on input.
          originalMake.call(this)
        }
        return
      }
      originalMake.call(this)
    }
    proto.__chayaSmartBattle = true
  }
}

/**
 * Native auto-battle already finishes most turns inside startInput. This tick
 * only runs when the party is still stuck on input (flag toggled mid-menu,
 * battle plugins that ignore canInput, or actions never filled).
 */
export function tryAutoBattle(enabled: boolean, autoWin: boolean, sceneLatch: object | null): object | null {
  if (!enabled || autoWin) return sceneLatch
  const { BattleManager, Scene_Battle, SceneManager, $gameParty } = g()
  if (!BattleManager || typeof Scene_Battle !== 'function' || !SceneManager) return sceneLatch
  const scene = SceneManager._scene
  if (!(scene instanceof Scene_Battle)) return null
  if (String(BattleManager._phase) !== 'input') return null
  if (sceneLatch === scene) return sceneLatch
  if (typeof gameTroop()?.isEventRunning === 'function' && gameTroop().isEventRunning()) return sceneLatch
  if (typeof gameMessage()?.isBusy === 'function' && gameMessage().isBusy()) return sceneLatch

  const stb = BattleManager.isSTB?.() === true
  const current = stb ? BattleManager.actor?.() : null
  const members = stb ? (current ? [current] : []) : typeof $gameParty?.battleMembers === 'function' ? $gameParty.battleMembers() : []
  // STB is already inside a round: submit the current actor without restarting it.
  const finishInput = stb ? BattleManager.selectNextCommand : BattleManager.startTurn
  if (typeof finishInput !== 'function') return sceneLatch
  let prepared = 0
  for (const actor of members) {
    if (!actor) continue
    // isAutoBattle makes canInput false; still need actions when enabling mid-input.
    if (typeof actor.canMove === 'function' && !actor.canMove()) continue
    if (typeof actor.makeAutoBattleActions === 'function') {
      actor.makeAutoBattleActions()
      prepared += 1
    } else {
      try {
        makeSmartAutoBattleActions(actor)
      } catch {
        actor.makeActions?.()
      }
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
  }
  finishInput.call(BattleManager)
  // Only latch after the engine actually left input; otherwise retry next tick.
  return String(BattleManager._phase) !== 'input' ? scene : null
}
