import { buildCommonEventsData, buildMapDetail, type CommonEventsData, type MapDetailData, type RawEventSources } from '@/lib/game/events'
import { runRecoverableOperation } from '@/lib/runtime/recoverable-operation'

import type { CloudGame } from './cloud-prepare-game'

export const BROWSER_GAME_FILE_LIMIT = 64 * 1024 * 1024
export const BROWSER_GAME_INDEX_LIMIT = 512 * 1024 * 1024
export const BROWSER_GAME_FILE_TIMEOUT_MS = 20_000

const BASE_FILES = ['CommonEvents.json', 'System.json', 'Items.json', 'Weapons.json', 'Armors.json', 'Actors.json', 'Troops.json', 'Enemies.json', 'MapInfos.json'] as const
const jsonCache = new Map<string, unknown>()
const MAX_CACHE_ENTRIES = 4_000
let readRequestId = 0

async function parseGameJsonBatch(texts: string[], signal: AbortSignal): Promise<unknown[]> {
  const worker = await import('./game-data-worker-client')
  return worker.parseGameJsonBatch(texts, signal)
}

export type BrowserGamePermission = 'granted' | 'prompt' | 'denied'

export class BrowserGameDataError extends Error {
  constructor(
    public readonly code: 'missing' | 'too-large' | 'timeout' | 'unreadable',
    message: string
  ) {
    super(message)
    this.name = 'BrowserGameDataError'
  }
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>
}

export async function queryBrowserGamePermission(game: CloudGame): Promise<BrowserGamePermission> {
  const handle = game.picked as PermissionHandle
  if (typeof handle.queryPermission !== 'function') return 'prompt'
  try {
    return (await handle.queryPermission({ mode: 'read' })) as BrowserGamePermission
  } catch {
    return 'denied'
  }
}

export async function requestBrowserGamePermission(game: CloudGame): Promise<BrowserGamePermission> {
  const handle = game.picked as PermissionHandle
  if (typeof handle.requestPermission !== 'function') return 'prompt'
  try {
    return (await handle.requestPermission({ mode: 'read' })) as BrowserGamePermission
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') throw new BrowserGameDataError('unreadable', '当前页面环境禁止访问游戏目录，请在独立标签页打开 Chaya。')
    throw error
  }
}

export async function findBrowserLibraryGame(gameId: string): Promise<CloudGame | null> {
  const { cloudLibraryStorage } = await import('./cloud-library')
  const entries = await cloudLibraryStorage()
  return entries.find((entry) => entry.item.id === gameId)?.game ?? null
}

function mapFileName(id: number): string {
  return `Map${String(id).padStart(3, '0')}.json`
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('操作已取消', 'AbortError')
}

type ReadBudget = { total: number }
type PendingFile = { file: File; key: string; name: string }

async function openJsonFile(gameId: string, dataDir: FileSystemDirectoryHandle, name: string, budget: ReadBudget): Promise<PendingFile> {
  let handle: FileSystemFileHandle
  try {
    handle = await dataDir.getFileHandle(name)
  } catch {
    throw new BrowserGameDataError('missing', `无法读取 data/${name}`)
  }
  const file = await handle.getFile()
  if (file.size > BROWSER_GAME_FILE_LIMIT) throw new BrowserGameDataError('too-large', `${name} 超过 64 MiB，未读取`)
  budget.total += file.size
  if (budget.total > BROWSER_GAME_INDEX_LIMIT) throw new BrowserGameDataError('too-large', '事件索引数据超过 512 MiB，已停止读取')
  return { file, key: `${gameId}:${name}:${file.size}:${file.lastModified}`, name }
}

async function readJsonBatch(gameId: string, dataDir: FileSystemDirectoryHandle, names: string[], budget: ReadBudget, signal: AbortSignal): Promise<Map<string, unknown>> {
  const opened = await Promise.all(names.map((name) => openJsonFile(gameId, dataDir, name, budget)))
  const misses = opened.filter((entry) => !jsonCache.has(entry.key))
  if (misses.length) {
    const texts = await Promise.all(misses.map((entry) => entry.file.text()))
    const values = await parseGameJsonBatch(texts, signal)
    misses.forEach((entry, index) => {
      if (jsonCache.size >= MAX_CACHE_ENTRIES) jsonCache.clear()
      jsonCache.set(entry.key, values[index])
    })
  }
  return new Map(opened.map((entry) => [entry.name, jsonCache.get(entry.key)]))
}

async function readMapBatch(
  gameId: string,
  dataDir: FileSystemDirectoryHandle,
  ids: number[],
  budget: ReadBudget,
  signal: AbortSignal
): Promise<{ maps: Array<{ id: number; data: unknown }>; failed: number }> {
  const opened: Array<{ id: number; entry: PendingFile }> = []
  let failed = 0
  for (const id of ids) {
    try {
      opened.push({ id, entry: await openJsonFile(gameId, dataDir, mapFileName(id), budget) })
    } catch (error) {
      if (error instanceof BrowserGameDataError && error.code === 'too-large') throw error
      failed++
    }
  }
  const misses = opened.filter(({ entry }) => !jsonCache.has(entry.key))
  if (misses.length) {
    try {
      const texts = await Promise.all(misses.map(({ entry }) => entry.file.text()))
      const values = await parseGameJsonBatch(texts, signal)
      misses.forEach(({ entry }, index) => {
        if (jsonCache.size >= MAX_CACHE_ENTRIES) jsonCache.clear()
        jsonCache.set(entry.key, values[index])
      })
    } catch (error) {
      if (signal.aborted) throw error
      // A malformed file must not hide valid maps. Retry each miss separately.
      for (const { entry } of misses) {
        try {
          const [value] = await parseGameJsonBatch([await entry.file.text()], signal)
          jsonCache.set(entry.key, value)
        } catch (singleError) {
          if (signal.aborted) throw singleError
          failed++
        }
      }
    }
  }
  return {
    maps: opened.flatMap(({ id, entry }) => (jsonCache.has(entry.key) ? [{ id, data: jsonCache.get(entry.key) }] : [])),
    failed,
  }
}

async function dataDirectory(game: CloudGame): Promise<FileSystemDirectoryHandle> {
  try {
    return await game.content.getDirectoryHandle('data')
  } catch {
    throw new BrowserGameDataError('missing', '找不到可读取的 data 目录，请连接游戏后浏览')
  }
}

function readStep<T>(gameId: string, signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return runRecoverableOperation({
    identity: { requestId: `browser-read:${Date.now()}:${++readRequestId}`, gameId, generation: 0, deadlineAt: Date.now() + BROWSER_GAME_FILE_TIMEOUT_MS },
    hardLimitMs: BROWSER_GAME_FILE_TIMEOUT_MS,
    signal,
    run,
  }).catch((error) => {
    if (error instanceof Error && error.name === 'OperationTimeoutError') throw new BrowserGameDataError('timeout', '读取游戏数据超时，请重试')
    throw error
  })
}

/** Reads the full event index. Map JSON is parsed in batches of at most eight in a Worker. */
export function readBrowserCommonEvents(gameId: string, game: CloudGame, signal?: AbortSignal): Promise<CommonEventsData> {
  return (async () => {
    const dir = await dataDirectory(game)
    const budget: ReadBudget = { total: 0 }
    const base = new Map<string, unknown>()
    for (let offset = 0; offset < BASE_FILES.length; offset += 8) {
      const values = await readStep(gameId, signal, (activeSignal) => readJsonBatch(gameId, dir, BASE_FILES.slice(offset, offset + 8), budget, activeSignal))
      for (const [name, value] of values) base.set(name, value)
    }
    const mapInfos = asArray(base.get('MapInfos.json'))
    if (!mapInfos) throw new BrowserGameDataError('unreadable', 'MapInfos.json 无法解析，请连接游戏后浏览')
    const maps: Array<{ id: number; data: unknown }> = []
    let mapsFailed = 0
    const ids = mapInfos.flatMap((value, id) => (id > 0 && value ? [id] : []))
    for (let offset = 0; offset < ids.length; offset += 8) {
      if (signal?.aborted) throw abortError(signal)
      const batch = ids.slice(offset, offset + 8)
      const result = await readStep(gameId, signal, (activeSignal) => readMapBatch(gameId, dir, batch, budget, activeSignal))
      maps.push(...result.maps)
      mapsFailed += result.failed
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const raw: RawEventSources = {
      commonEvents: asArray(base.get('CommonEvents.json')),
      system: (base.get('System.json') as RawEventSources['system']) ?? null,
      items: asArray(base.get('Items.json')),
      weapons: asArray(base.get('Weapons.json')),
      armors: asArray(base.get('Armors.json')),
      actors: asArray(base.get('Actors.json')),
      troops: asArray(base.get('Troops.json')),
      enemies: asArray(base.get('Enemies.json')),
      mapInfos,
      maps,
      mapsFailed,
    }
    return buildCommonEventsData(raw, (text) => text, 'browser')
  })()
}

export function readBrowserMapDetail(gameId: string, game: CloudGame, mapId: number, signal?: AbortSignal): Promise<MapDetailData> {
  return (async () => {
    const dir = await dataDirectory(game)
    const values = await readStep(gameId, signal, (activeSignal) => readJsonBatch(gameId, dir, ['MapInfos.json', mapFileName(mapId)], { total: 0 }, activeSignal))
    const rawMap = values.get(mapFileName(mapId))
    if (!rawMap) throw new BrowserGameDataError('unreadable', `无法读取 ${mapFileName(mapId)}`)
    return buildMapDetail(mapId, rawMap, asArray(values.get('MapInfos.json')), (text) => text, 'browser')
  })()
}
