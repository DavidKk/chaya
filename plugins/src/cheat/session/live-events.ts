/**
 * In-game: common events + call references from the loaded database; map files are fetched like RPG Maker's own DataManager.
 */
import { buildCommonEventsData, type CommonEventsData } from '@/lib/game/events'

import { tName } from '../console/item-label'
import { Cheats } from '../runtime/cheats'

const MAP_FETCH_CONCURRENCY = 8

export function loadDataJson(file: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', `data/${file}`)
      xhr.overrideMimeType('application/json')
      xhr.onload = () => {
        try {
          resolve(xhr.status < 400 ? JSON.parse(xhr.responseText) : null)
        } catch {
          resolve(null)
        }
      }
      xhr.onerror = () => resolve(null)
      xhr.send()
    } catch {
      resolve(null)
    }
  })
}

type LoadedMaps = { maps: Array<{ id: number; data: unknown }> | null; failed: number }

async function loadMaps(infos: unknown[] | undefined): Promise<LoadedMaps> {
  if (!Array.isArray(infos)) return { maps: null, failed: 0 }
  const ids = infos.map((info, id) => (info ? id : 0)).filter((id) => id > 0)
  const maps: Array<{ id: number; data: unknown }> = []
  let failed = 0
  for (let i = 0; i < ids.length; i += MAP_FETCH_CONCURRENCY) {
    const batch = ids.slice(i, i + MAP_FETCH_CONCURRENCY)
    const loaded = await Promise.all(batch.map((id) => loadDataJson(`Map${String(id).padStart(3, '0')}.json`)))
    loaded.forEach((data, index) => {
      if (data) maps.push({ id: batch[index], data })
      else failed++
    })
  }
  return ids.length && !maps.length ? { maps: null, failed } : { maps, failed }
}

/** Map files do not change during a session: read once, shared by the overlay and web requests; pass `force` to reload */
let cachedMaps: Promise<LoadedMaps> | null = null
let loadedMaps: LoadedMaps['maps'] = null

/** Raw map data if the map files were already loaded for the events page; never triggers a load */
export function loadedMapData(mapId: number): unknown {
  return loadedMaps?.find((m) => m.id === mapId)?.data ?? null
}

export async function buildLiveCommonEventsData(opts?: { force?: boolean }): Promise<CommonEventsData> {
  const g = globalThis as { $dataMapInfos?: unknown[] }
  if (opts?.force || !cachedMaps) {
    cachedMaps = loadMaps(g.$dataMapInfos)
    cachedMaps.then(
      (loaded) => {
        loadedMaps = loaded.maps
      },
      () => {
        cachedMaps = null
      }
    )
  }
  const { maps, failed } = await cachedMaps
  return buildCommonEventsData(
    {
      commonEvents: $dataCommonEvents ?? null,
      system: $dataSystem ?? null,
      items: $dataItems ?? null,
      weapons: $dataWeapons ?? null,
      armors: $dataArmors ?? null,
      actors: $dataActors ?? null,
      troops: $dataTroops ?? null,
      mapInfos: g.$dataMapInfos ?? null,
      maps,
      mapsFailed: failed,
    },
    (text) => tName(text) || text,
    'live'
  )
}

export function isOnMapScene(): boolean {
  const scene = typeof SceneManager !== 'undefined' ? SceneManager._scene : null
  const SceneMap = (globalThis as { Scene_Map?: new () => unknown }).Scene_Map
  return !!scene && !!SceneMap && scene instanceof SceneMap
}

/** Common events only start from the map scene (`$gameTemp.reserveCommonEvent`) */
export function runCommonEventOnMap(id: number): void {
  if (!isOnMapScene()) throw new Error('请回到地图场景再执行公共事件')
  if (!Cheats.runCommonEvent(id)) throw new Error('执行失败：游戏未就绪')
}
