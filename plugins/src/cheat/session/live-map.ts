/**
 * In-game map page: single map details with live state, teleport, self switches and map events.
 */
import { buildMapDetail, type MapDetailData, type MapLiveState, SELF_SWITCH_LETTERS, type SelfSwitchLetter } from '@/lib/game/events'

import { tName } from '../console/item-label'
import { Cheats } from '../runtime/cheats'
import { gameMap, gamePlayer } from '../runtime/game-globals'
import { isOnMapScene, loadDataJson } from './live-events'

const g = () =>
  globalThis as { $dataMapInfos?: unknown[]; $dataMap?: unknown; $gameSelfSwitches?: { _data?: Record<string, boolean>; setValue?: (key: unknown[], value: boolean) => void } }

function currentMapId(): number {
  return Math.floor(Number(gameMap()?.mapId?.()) || 0)
}

/** Self switches that are ON for every event of a map, e.g. `{ 3: "AC" }` */
function selfSwitchesOf(mapId: number): Record<number, string> {
  const data = g().$gameSelfSwitches?._data ?? {}
  const out: Record<number, string> = {}
  for (const [key, on] of Object.entries(data)) {
    if (!on) continue
    const [m, e, ch] = key.split(',')
    if (Number(m) !== mapId || !(SELF_SWITCH_LETTERS as readonly string[]).includes(ch)) continue
    const id = Number(e)
    out[id] = [...(out[id] ?? ''), ch].sort().join('')
  }
  return out
}

function liveStateOf(mapId: number): MapLiveState {
  const onThisMap = currentMapId() === mapId
  const activePage: Record<number, number> = {}
  if (onThisMap) {
    for (const ev of gameMap()?.events?.() ?? []) {
      if (!ev) continue
      const id = Math.floor(Number(ev.eventId?.() ?? ev._eventId) || 0)
      activePage[id] = ev._erased ? 0 : Math.floor(Number(ev._pageIndex) || 0) + 1
    }
  }
  return { onThisMap, activePage, selfSwitches: selfSwitchesOf(mapId) }
}

export async function buildLiveMapDetail(mapId: number): Promise<MapDetailData> {
  const id = Math.floor(Number(mapId) || 0)
  if (id <= 0) throw new Error('地图编号无效')
  const raw = currentMapId() === id && g().$dataMap ? g().$dataMap : await loadDataJson(`Map${String(id).padStart(3, '0')}.json`)
  if (!raw) throw new Error(`无法读取地图 ${id}`)
  return buildMapDetail(id, raw, g().$dataMapInfos ?? null, (text) => tName(text) || text, 'live', liveStateOf(id))
}

/** Parallel common events whose switch is ON (`$gameMap._commonEvents` holds parallel ones only) */
export function runningCommonEvents(): number[] {
  const list = gameMap()?._commonEvents
  if (!Array.isArray(list)) return []
  const out: number[] = []
  for (const ce of list) {
    try {
      if (ce && typeof ce.isActive === 'function' && ce.isActive()) out.push(Math.floor(Number(ce._commonEventId) || 0))
    } catch {
      /* skip broken entries */
    }
  }
  return out.filter((id) => id > 0)
}

export function playerSpot(): { mapId: number; x: number; y: number } {
  const player = gamePlayer()
  return { mapId: currentMapId(), x: Math.floor(Number(player?.x) || 0), y: Math.floor(Number(player?.y) || 0) }
}

export function setSelfSwitch(mapId: number, eventId: number, letter: SelfSwitchLetter, value: boolean) {
  const store = g().$gameSelfSwitches
  if (!store || typeof store.setValue !== 'function') throw new Error('请先读档进游戏')
  if (!SELF_SWITCH_LETTERS.includes(letter)) throw new Error('独立开关无效')
  store.setValue([Math.floor(mapId), Math.floor(eventId), letter], value)
}

function tileWalkable(x: number, y: number): boolean {
  const map = gameMap()
  if (!map || !map.isValid?.(x, y)) return false
  const passable = [2, 4, 6, 8].some((d) => map.isPassable?.(x, y, d))
  if (!passable) return false
  const blockers = map.eventsXyNt?.(x, y) ?? []
  return !blockers.some((ev: { isNormalPriority?: () => boolean }) => ev?.isNormalPriority?.())
}

const NEAR_OFFSETS = [
  [0, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
] as const

/** After the transfer lands, step to the first walkable neighbour if the target tile is blocked */
function settleNear(mapId: number, x: number, y: number) {
  const started = Date.now()
  const timer = setInterval(() => {
    const player = gamePlayer()
    if (Date.now() - started > 10_000) return clearInterval(timer)
    if (!isOnMapScene() || currentMapId() !== mapId || player?.isTransferring?.()) return
    clearInterval(timer)
    if (tileWalkable(x, y)) return
    for (const [dx, dy] of NEAR_OFFSETS) {
      if (!tileWalkable(x + dx, y + dy)) continue
      player?.locate?.(x + dx, y + dy)
      return
    }
  }, 100)
}

export function teleportPlayer(mapId: number, x: number, y: number, direction: number | undefined, near: boolean | undefined) {
  if (!isOnMapScene()) throw new Error('请回到地图场景再传送')
  const infos = g().$dataMapInfos
  if (Array.isArray(infos) && !infos[mapId]) throw new Error(`地图 ${mapId} 不存在`)
  if (!Cheats.teleport(mapId, x, y, direction ?? 2)) throw new Error('传送失败：游戏未就绪')
  if (near) settleNear(mapId, x, y)
}

export function runMapEvent(mapId: number, eventId: number) {
  if (!isOnMapScene()) throw new Error('请回到地图场景再触发事件')
  if (currentMapId() !== mapId) throw new Error('只能触发当前地图的事件')
  const ev = gameMap()?.event?.(Math.floor(eventId))
  if (!ev) throw new Error(`当前地图没有事件 ${eventId}`)
  if (ev._erased || !(Number(ev._pageIndex) >= 0)) throw new Error('该事件当前未出现，无法触发')
  if (!Cheats.startMapEvent(eventId)) throw new Error(`当前地图没有事件 ${eventId}`)
}
