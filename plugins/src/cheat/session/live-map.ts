/**
 * In-game map page: single map details with live state, teleport, self switches and map events.
 */
import type { PlayerSpot } from '@/components/game-edit/events/types'
import { blockedMask, buildMapDetail, type MapDetailData, type MapLiveState, nearestSpot, SELF_SWITCH_LETTERS, type SelfSwitchLetter, terrainBlockedMask } from '@/lib/game/events'

import { tName } from '../console/item-label'
import { Cheats } from '../runtime/cheats'
import { gameMap, gamePlayer } from '../runtime/game-globals'
import { runGameUntil } from './game-pause'
import { isOnMapScene, loadDataJson } from './live-events'
import { assertIdle, startMapEventAt } from './run-from'

const g = () =>
  globalThis as {
    $dataMapInfos?: unknown[]
    $dataMap?: unknown
    $dataTilesets?: ({ flags?: unknown } | null)[]
    $gameSelfSwitches?: { _data?: Record<string, boolean>; setValue?: (key: unknown[], value: boolean) => void }
  }

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

export function currentMapLiveState(mapId: number): MapLiveState {
  return liveStateOf(mapId)
}

export async function buildLiveMapDetail(mapId: number): Promise<MapDetailData> {
  const id = Math.floor(Number(mapId) || 0)
  if (id <= 0) throw new Error('地图编号无效')
  const onThisMap = currentMapId() === id
  const raw = onThisMap && g().$dataMap ? g().$dataMap : await loadDataJson(`Map${String(id).padStart(3, '0')}.json`)
  if (!raw) throw new Error(`无法读取地图 ${id}`)
  const detail = buildMapDetail(id, raw, g().$dataMapInfos ?? null, (text) => tName(text) || text, 'live', liveStateOf(id))
  const blocked = onThisMap ? liveBlockedMask() : terrainBlockedMask(raw, g().$dataTilesets?.[Number((raw as { tilesetId?: unknown }).tilesetId) || 0]?.flags)
  return blocked ? { ...detail, blocked } : detail
}

/** Current map through `$gameMap.isPassable`, so plugin-tweaked passage rules count */
function liveBlockedMask(): string | null {
  const map = gameMap()
  const [w, h] = mapSize()
  if (!map || typeof map.isPassable !== 'function' || !w || !h) return null
  return blockedMask(w, h, (x, y) => ![2, 4, 6, 8].some((d) => map.isPassable(x, y, d)))
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

export function playerSpot(): PlayerSpot {
  const player = gamePlayer() as ({ x?: number; y?: number; direction?: () => number } & object) | null
  const direction = Math.floor(Number(player?.direction?.()) || 0)
  return { mapId: currentMapId(), x: Math.floor(Number(player?.x) || 0), y: Math.floor(Number(player?.y) || 0), direction: [2, 4, 6, 8].includes(direction) ? direction : 0 }
}

export function setSelfSwitch(mapId: number, eventId: number, letter: SelfSwitchLetter, value: boolean) {
  const store = g().$gameSelfSwitches
  if (!store || typeof store.setValue !== 'function') throw new Error('请先读档进游戏')
  if (!SELF_SWITCH_LETTERS.includes(letter)) throw new Error('独立开关无效')
  store.setValue([Math.floor(mapId), Math.floor(eventId), letter], value)
}

type LiveEvent = {
  _erased?: boolean
  _pageIndex?: number
  _priorityType?: number
  _through?: boolean
  _characterName?: string
  _tileId?: number
  isBlocking?: () => boolean
}

/** Another character stands here: a visible page with a sprite / tile, or a same-level solid event */
function eventOccupies(ev: LiveEvent | null | undefined): boolean {
  if (!ev || ev._erased) return false
  if (typeof ev._pageIndex === 'number') {
    if (ev._pageIndex < 0) return false
    const hasImage = !!ev._characterName || Number(ev._tileId) > 0
    return hasImage || (ev._priorityType === 1 && !ev._through)
  }
  return !!ev.isBlocking?.()
}

function mapSize(): [number, number] {
  const map = gameMap()
  return [Math.floor(Number(map?.width?.()) || 0), Math.floor(Number(map?.height?.()) || 0)]
}

/** Tile the player can stand on: in bounds, passable in some direction, no character or vehicle on it */
function tileStandable(mapId: number, x: number, y: number): boolean {
  const map = gameMap()
  if (!map) return false
  const [w, h] = mapSize()
  const valid = typeof map.isValid === 'function' ? map.isValid(x, y) : x >= 0 && y >= 0 && x < w && y < h
  if (!valid) return false
  if (![2, 4, 6, 8].some((d) => map.isPassable?.(x, y, d))) return false
  if ((map.eventsXy?.(x, y) ?? []).some(eventOccupies)) return false
  const vehicles: { _mapId?: number; x?: number; y?: number }[] = map.vehicles?.() ?? []
  return !vehicles.some((v) => v && v._mapId === mapId && v.x === x && v.y === y)
}

/** RPG Maker sets `_transferring` until the new map is set up; simple engines may keep a pending `_transfer` */
function transferPending(): boolean {
  const player = gamePlayer() as { isTransferring?: () => boolean; _transferring?: boolean; _transfer?: unknown } | null
  return !!(player?.isTransferring?.() || player?._transferring || player?._transfer)
}

/** A reserved transfer to `mapId` has landed and the map scene is running */
function arrivedOn(mapId: number): boolean {
  if (!isOnMapScene() || currentMapId() !== mapId || transferPending()) return false
  const sm = SceneManager as { _nextScene?: unknown; _scene?: { isStarted?: () => boolean } }
  return !sm._nextScene && sm._scene?.isStarted?.() !== false
}

/** Target blocked (wall, character, vehicle): move to the nearest standable tile, or stay when none */
function stepAside(mapId: number, x: number, y: number) {
  if (tileStandable(mapId, x, y)) return
  const [w, h] = mapSize()
  const spot = nearestSpot(x, y, w, h, (cx, cy) => tileStandable(mapId, cx, cy))
  if (spot) gamePlayer()?.locate?.(spot.x, spot.y)
}

export type TeleportTarget = { mapId: number; x: number; y: number; direction?: number; near?: boolean }

/**
 * The one teleport path for overlay and remote commands. Checks throw synchronously; then the (possibly paused)
 * game runs until the transfer lands, `near` steps off a blocked target, and it resolves with where the player stands.
 */
export function teleportPlayer({ mapId, x, y, direction, near }: TeleportTarget): Promise<PlayerSpot> {
  if (!isOnMapScene()) throw new Error('请回到地图场景再传送')
  const infos = g().$dataMapInfos
  if (Array.isArray(infos) && !infos[mapId]) throw new Error(`地图 ${mapId} 不存在`)
  if (!Cheats.teleport(mapId, x, y, direction ?? 2)) throw new Error('游戏未就绪')
  let landed = false
  return runGameUntil(() => {
    if (landed || !arrivedOn(mapId)) return landed
    landed = true
    if (near) stepAside(mapId, x, y)
    return true
  }).then(() => {
    if (!landed) throw new Error('传送超时：游戏没有切换到目标地图')
    return playerSpot()
  })
}

/** Without `page` the event starts like a normal trigger (active page); with it, that page runs from `from` */
export function runMapEvent({ mapId, eventId, page, from = 0 }: { mapId: number; eventId: number; page?: number; from?: number }) {
  if (!isOnMapScene()) throw new Error('请回到地图场景再触发事件')
  if (currentMapId() !== mapId) throw new Error('只能触发当前地图的事件')
  const ev = gameMap()?.event?.(Math.floor(eventId))
  if (!ev) throw new Error(`当前地图没有事件 ${eventId}`)
  if (page != null) return startMapEventAt(eventId, page, from)
  if (ev._erased || !(Number(ev._pageIndex) >= 0)) throw new Error('该事件当前未出现，无法触发')
  assertIdle()
  if (!Cheats.startMapEvent(eventId)) throw new Error(`当前地图没有事件 ${eventId}`)
}
