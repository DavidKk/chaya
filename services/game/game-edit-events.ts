import fs from 'node:fs'
import path from 'node:path'

import { buildCommonEventsData, buildMapDetail, type CommonEventsData, type MapDetailData, terrainBlockedMask } from '@/lib/game/events'
import { getResolvedFromConfig } from '@/services/game'
import { loadGameTranslateLookup, translateWithLookup } from '@/services/translate/game-lookup'
import { openSharedCache } from '@/services/translate/shared-cache'

type CachedJson = { mtimeMs: number; size: number; data: unknown }

/** Parsed JSON cached by file mtime / size; names are translated per request so translation updates apply immediately */
const jsonCache = new Map<string, CachedJson>()
const MAX_CACHED_FILES = 4_000

function readJson(file: string): unknown {
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    jsonCache.delete(file)
    return null
  }
  const hit = jsonCache.get(file)
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.data
  let data: unknown = null
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch {
    data = null
  }
  if (jsonCache.size >= MAX_CACHED_FILES) jsonCache.clear()
  jsonCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, data })
  return data
}

function readArray(dataDir: string, name: string): unknown[] | null {
  const raw = readJson(path.join(dataDir, name))
  return Array.isArray(raw) ? raw : null
}

function mapFileName(id: number) {
  return `Map${String(id).padStart(3, '0')}.json`
}

type Failure = { ok: false; error: string }
type GameData = { dataDir: string; tr: (text: string) => string; close: () => void }

/** Bound game's data dir plus a translation lookup (no network); call `close` when done */
function openGameData(): GameData | Failure {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) return { ok: false, error: resolved.error || '尚未绑定游戏' }
  const dataDir = path.join(resolved.contentRoot, 'data')
  if (!fs.existsSync(dataDir)) return { ok: false, error: `找不到 data 目录: ${dataDir}` }

  const lookup = loadGameTranslateLookup(resolved.contentRoot)
  let shared: ReturnType<typeof openSharedCache> | null = null
  try {
    shared = openSharedCache()
  } catch {
    shared = null
  }
  const tr = (text: string) => {
    const zh = translateWithLookup(lookup, text, { extraGet: shared ? (src) => shared!.get(src) : undefined })
    return zh || text
  }
  return { dataDir, tr, close: () => shared?.close() }
}

/** Common events, call references (all maps scanned) and translated names of the bound game, for the web Edit › Common events page */
export function loadCommonEventsData(): CommonEventsData | Failure {
  const game = openGameData()
  if ('ok' in game) return game
  const { dataDir, tr } = game
  try {
    const mapInfos = readArray(dataDir, 'MapInfos.json')
    const maps: Array<{ id: number; data: unknown }> = []
    let mapsFailed = 0
    for (let id = 1; id < (mapInfos?.length ?? 0); id++) {
      if (!mapInfos![id]) continue
      const data = readJson(path.join(dataDir, mapFileName(id)))
      if (data) maps.push({ id, data })
      else mapsFailed++
    }
    const system = readJson(path.join(dataDir, 'System.json'))
    return buildCommonEventsData(
      {
        commonEvents: readArray(dataDir, 'CommonEvents.json'),
        system: system && typeof system === 'object' ? (system as { switches?: unknown[]; variables?: unknown[] }) : null,
        items: readArray(dataDir, 'Items.json'),
        weapons: readArray(dataDir, 'Weapons.json'),
        armors: readArray(dataDir, 'Armors.json'),
        actors: readArray(dataDir, 'Actors.json'),
        troops: readArray(dataDir, 'Troops.json'),
        enemies: readArray(dataDir, 'Enemies.json'),
        mapInfos,
        maps: mapInfos ? maps : null,
        mapsFailed,
      },
      tr,
      'disk'
    )
  } finally {
    game.close()
  }
}

/** One map with event pages and command lists, for the web Edit › Maps page */
export function loadMapDetailData(mapId: number): MapDetailData | Failure {
  if (!Number.isInteger(mapId) || mapId <= 0) return { ok: false, error: '地图编号无效' }
  const game = openGameData()
  if ('ok' in game) return game
  try {
    const raw = readJson(path.join(game.dataDir, mapFileName(mapId)))
    if (!raw) return { ok: false, error: `无法读取 ${mapFileName(mapId)}` }
    const detail = buildMapDetail(mapId, raw, readArray(game.dataDir, 'MapInfos.json'), game.tr, 'disk')
    const tilesetId = Number((raw as { tilesetId?: unknown }).tilesetId) || 0
    const tileset = readArray(game.dataDir, 'Tilesets.json')?.[tilesetId] as { flags?: unknown } | null | undefined
    const blocked = terrainBlockedMask(raw, tileset?.flags)
    return blocked ? { ...detail, blocked } : detail
  } finally {
    game.close()
  }
}
