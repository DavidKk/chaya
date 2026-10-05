import fs from 'node:fs'
import path from 'node:path'

import { buildCommonEventsData, type CommonEventsData } from '@/lib/game/events'
import { getResolvedFromConfig } from '@/services/game'
import { loadGameTranslateLookup, translateWithLookup } from '@/services/translate/game-lookup'
import { openSharedCache } from '@/services/translate/shared-cache'

type CachedJson = { mtimeMs: number; size: number; data: unknown }

/** 按文件 mtime / 大小缓存解析结果；译名每次请求重新查，翻译库更新即时生效 */
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

/** 读已绑定游戏的公共事件、调用关系（含全部地图）与译名，供网页「修改 › 公共事件」 */
export function loadCommonEventsData(): CommonEventsData | { ok: false; error: string } {
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
        mapInfos,
        maps: mapInfos ? maps : null,
        mapsFailed,
      },
      tr,
      'disk'
    )
  } finally {
    shared?.close()
  }
}
