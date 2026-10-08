/**
 * Runtime toggles / actions / move speed: shared by panel, remote, and disk apply.
 */
import type { RunActionId, RunFlagKey } from '@/components/game-edit/types'

import { canSettleBattleEnd, settleBattleEnd } from '../session/live-battle'
import { Cheats } from './cheats'
import { RunCheats, type ScenePushId } from './cheats-run'

type BoostApi = {
  rates?: (o: { walk?: number; run?: number }) => void
  speed?: (n?: number) => unknown
  dash?: (v: boolean) => void
}

function boostApi(): BoostApi | undefined {
  return (window as Window & { ChayaBoost?: BoostApi }).ChayaBoost
}

export function applySpeed(walk: number, run: number) {
  boostApi()?.rates?.({ walk, run })
}

export function applyGameSpeed(rate: number) {
  boostApi()?.speed?.(rate)
}

export function applyRunFlag(key: RunFlagKey, on: boolean) {
  RunCheats.ensureHooks()
  if (key === 'fullscreen') RunCheats.setFullscreen(on)
  else if (key === 'alwaysDash') {
    const boost = boostApi()
    if (boost?.dash) boost.dash(on)
    else if (typeof ConfigManager !== 'undefined') ConfigManager.alwaysDash = on
  } else if (key === 'god') Cheats.setGod(on)
  else if (key === 'autoWin') Cheats.setAutoWin(on)
  else if (key === 'through') Cheats.setThrough(on)
  else if (key === 'autotalk') window.ChayaEdit?.autoTalk?.(on)
  else if (key === 'encounter') RunCheats.setEncounter(on)
  else if (key === 'menuEnabled') RunCheats.setMenuEnabled(on)
  else if (key === 'saveEnabled') RunCheats.setSaveEnabled(on)
  else if (key === 'clickMove') RunCheats.setClickMove(on)
  else if (key === 'followers') RunCheats.setFollowersVisible(on)
  else if (key === 'clickTeleport') RunCheats.setClickTeleport(on)
  else if (key === 'resourceSkip') RunCheats.setResourceSkip(on)
}

export function applyRunAction(id: RunActionId) {
  if (id.startsWith('scene:')) {
    const scene = id.slice(6) as ScenePushId | 'pop'
    if (scene === 'pop') RunCheats.popScene()
    else RunCheats.pushScene(scene)
    return
  }
  if (id === 'fix:clearPictures') RunCheats.clearPictures()
  else if (id === 'fix:clearOverlay') RunCheats.clearOverlay()
  else if (id === 'fix:clearEvent') Cheats.clearInterpreter()
  else if (id === 'fix:clearMoveRoute') RunCheats.clearMoveRoute()
  else if (id === 'fix:closeWindows') RunCheats.closeAllWindows()
  else if (id === 'fix:title') RunCheats.gotoTitle()
  else if (id === 'fix:map') RunCheats.gotoMap()
  else if (id === 'fix:fadeIn') RunCheats.fadeIn()
  else if (id === 'fix:resume') RunCheats.resumeAfterError()
  else if (id === 'battle:victory') Cheats.battleVictory()
  else if (id === 'battle:escape') Cheats.battleEscape()
  else if (id === 'battle:defeat') Cheats.battleDefeat()
  else if (id === 'battle:abort') Cheats.battleAbort()
  else if (id === 'battle:settle') settleBattleEnd({ force: true })
  else if (id === 'battle:enemyHp1') RunCheats.setEnemyHp('one')
  else if (id === 'battle:enemyHpMax') RunCheats.setEnemyHp('max')
  else if (id === 'battle:partyHeal') Cheats.healParty()
  else if (id === 'battle:partyHp1') RunCheats.setPartyHp('one')
  else if (id === 'battle:partyHp0') {
    RunCheats.setPartyHp('zero')
    settleBattleEnd()
  }
}

const BATTLE_END_ACTIONS: ReadonlySet<RunActionId> = new Set(['battle:victory', 'battle:escape', 'battle:defeat', 'battle:abort'])

/** Scene changes / battle endings: the player wants to watch the game, caller closes UI first (before `applyRunAction`) */
export function runActionNeedsClose(id: RunActionId): boolean {
  if (id === 'battle:settle') return canSettleBattleEnd({ force: true })
  return id.startsWith('scene:') || id === 'fix:title' || id === 'fix:map' || BATTLE_END_ACTIONS.has(id)
}
