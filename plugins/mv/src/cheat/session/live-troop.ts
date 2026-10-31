/**
 * Start a battle against a chosen troop from the map, with the same checks for the web page, overlay and console.
 */
import { Cheats } from '../runtime/cheats'
import { gameMessage } from '../runtime/game-globals'
import { resizeTroop } from './live-battle'
import { isOnMapScene } from './live-events'
import { transferPending } from './live-map'
import { assertIdle } from './run-from'

/**
 * `id` omitted: use the current map's first random encounter, then any usable troop.
 * `count`: visible members to fight. `interruptEvent`: clear the current map event for debug actions.
 */
export type TroopBattleRequest = { id?: number; canEscape?: boolean; canLose?: boolean; count?: number; interruptEvent?: boolean }

type Row = { enemyId?: unknown; hidden?: unknown } | null

const g = () =>
  globalThis as {
    $dataMap?: { encounterList?: { troopId?: unknown }[] }
    $dataTroops?: ({ members?: Row[] } | null)[]
    $dataEnemies?: (object | null)[]
    $gameParty?: { battleMembers?: () => unknown[] }
    SceneManager?: { _nextScene?: unknown }
  }

/** Members `Game_Troop.setup` would create */
function troopEnemies(troopId: number): Row[] {
  const enemies = g().$dataEnemies
  return (g().$dataTroops?.[troopId]?.members ?? []).filter((m) => {
    const id = Math.floor(Number(m?.enemyId) || 0)
    return id > 0 && (!enemies || !!enemies[id])
  })
}

function defaultEncounterTroopId(): number {
  for (const entry of g().$dataMap?.encounterList ?? []) {
    const troopId = Math.floor(Number(entry?.troopId) || 0)
    if (troopId > 0 && troopEnemies(troopId).some((m) => !m?.hidden)) return troopId
  }
  // Maps without random encounters still need a useful default for the run-page button.
  const troops = g().$dataTroops ?? []
  for (let troopId = 1; troopId < troops.length; troopId += 1) {
    if (troopEnemies(troopId).some((m) => !m?.hidden)) return troopId
  }
  return 0
}

/** Throws the reason when the battle cannot start now; never queues */
export function startTroopBattle({ id, canEscape = true, canLose = false, count, interruptEvent = false }: TroopBattleRequest): void {
  const troopId = Math.floor(Number(id) || 0) || defaultEncounterTroopId()
  if (!isOnMapScene()) throw new Error('请回到地图场景再开战')
  if (g().SceneManager?._nextScene) throw new Error('场景切换中，请稍后再试')
  if (transferPending()) throw new Error('传送中，请稍后再试')
  if (interruptEvent) {
    Cheats.clearInterpreter()
    if (gameMessage()?.isBusy?.()) gameMessage()?.clear?.()
  }
  assertIdle()
  if (gameMessage()?.isBusy?.()) throw new Error('对话进行中，请稍后再试')
  const members = troopId > 0 ? troopEnemies(troopId) : []
  if (!members.length) {
    if (troopId > 0) throw new Error(`敌群 ${troopId} 不存在或没有敌人`)
    throw new Error('没有可用的敌群，请指定 troopId')
  }
  // An empty battle party is wiped out on the first turn check: instant game over
  if (!g().$gameParty?.battleMembers?.()?.length) throw new Error('队伍中没有可出战的角色')
  if (count != null && count > 0 && members.every((m) => m?.hidden)) throw new Error('该敌群的敌人都是中途出现，不能设置数量')
  if (!Cheats.startTroop(troopId, canEscape, canLose)) throw new Error('游戏未就绪')
  // The battle scene builds enemy sprites when it starts, so members changed now get sprites like the originals
  if (count != null && count > 0) resizeTroop(count)
}
