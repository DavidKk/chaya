/**
 * Start a battle against a chosen troop from the map, with the same checks for the web page, overlay and console.
 */
import { Cheats } from '../runtime/cheats'
import { gameMessage } from '../runtime/game-globals'
import { resizeTroop } from './live-battle'
import { isOnMapScene } from './live-events'
import { transferPending } from './live-map'
import { assertIdle } from './run-from'

/** `count`: visible members to fight (copies added / extras hidden); omitted keeps the troop as is */
export type TroopBattleRequest = { id: number; canEscape?: boolean; canLose?: boolean; count?: number }

type Row = { enemyId?: unknown } | null

const g = () =>
  globalThis as {
    $dataTroops?: ({ members?: Row[] } | null)[]
    $dataEnemies?: (object | null)[]
    SceneManager?: { _nextScene?: unknown }
  }

function hasEnemies(troopId: number): boolean {
  const troop = g().$dataTroops?.[troopId]
  const enemies = g().$dataEnemies
  return !!troop?.members?.some((m) => {
    const id = Math.floor(Number(m?.enemyId) || 0)
    return id > 0 && (!enemies || !!enemies[id])
  })
}

/** Throws the reason when the battle cannot start now; never queues */
export function startTroopBattle({ id, canEscape = true, canLose = false, count }: TroopBattleRequest): void {
  const troopId = Math.floor(Number(id) || 0)
  if (!isOnMapScene()) throw new Error('请回到地图场景再开战')
  if (g().SceneManager?._nextScene) throw new Error('场景切换中，请稍后再试')
  if (transferPending()) throw new Error('传送中，请稍后再试')
  assertIdle()
  if (gameMessage()?.isBusy?.()) throw new Error('对话进行中，请稍后再试')
  if (troopId <= 0 || !hasEnemies(troopId)) throw new Error(`敌群 ${troopId} 不存在或没有敌人`)
  if (!Cheats.startTroop(troopId, canEscape, canLose)) throw new Error('游戏未就绪')
  // The battle scene builds enemy sprites when it starts, so members changed now get sprites like the originals
  if (count != null && count > 0) resizeTroop(count)
}
