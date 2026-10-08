import fs from 'node:fs/promises'
import path from 'node:path'

import { gameContentRelPath } from '@/lib/game/content-paths'
import { type GameSaveEntry, type GameSaveList, isGameSaveEntryId, parseGameSavesIndex } from '@/lib/game/game-saves'
import { toolkitDataDir } from '@/lib/game/toolkit-data'
import type { ChayaConfig, ResolvedGame, ResolveError } from '@/lib/game/types'
import { loadConfig, resolveGame } from '@/services/game'

import { GameSavesAppStore } from './app-store'

export type OfflineSaveSource = {
  place: 'game' | 'app'
  status: 'ok' | 'missing' | 'corrupt' | 'error'
  reason?: string
  entries: OfflineSaveEntry[]
}

export type OfflineSaveEntry = GameSaveEntry & { offlinePlace: 'game' | 'app' }

export type OfflineSaveList = { gameId: string; game: OfflineSaveSource; app: OfflineSaveSource }

type Candidate = { priority: number; file: string }
type OfflineListDeps = {
  config: ChayaConfig
  dataDir: string
  resolve: (root: string) => ResolvedGame | ResolveError
}

function dependencies(overrides?: Partial<OfflineListDeps>): OfflineListDeps {
  return { config: loadConfig(), dataDir: toolkitDataDir(), resolve: resolveGame, ...overrides }
}

async function readSource(place: OfflineSaveSource['place'], file: string): Promise<OfflineSaveSource> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { entries?: unknown }).entries)) {
      return { place, status: 'corrupt', reason: '索引格式损坏', entries: [] }
    }
    return { place, status: 'ok', entries: parseGameSavesIndex(raw).entries.map((entry) => ({ ...entry, offlinePlace: place })) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { place, status: 'missing', entries: [] }
    if (error instanceof SyntaxError) return { place, status: 'corrupt', reason: '索引不是有效 JSON', entries: [] }
    return { place, status: 'error', reason: error instanceof Error ? error.message : '索引读取失败', entries: [] }
  }
}

function mergeAppSources(sources: Array<{ source: OfflineSaveSource; priority: number }>): OfflineSaveSource {
  const available = sources.filter(({ source }) => source.status === 'ok')
  const entries = new Map<string, { entry: OfflineSaveEntry; priority: number }>()
  for (const { source, priority } of available) {
    for (const entry of source.entries) {
      const key = `${entry.list}:${entry.id}`
      const current = entries.get(key)
      if (!current || entry.savedAt > current.entry.savedAt || (entry.savedAt === current.entry.savedAt && priority > current.priority)) entries.set(key, { entry, priority })
    }
  }
  if (available.length) return { place: 'app', status: 'ok', entries: [...entries.values()].map(({ entry }) => entry).sort((a, b) => b.savedAt - a.savedAt) }
  const failure = sources.find(({ source }) => source.status === 'corrupt' || source.status === 'error')?.source
  return failure ? { ...failure, place: 'app' } : { place: 'app', status: 'missing', entries: [] }
}

/** Read-only inventory for a trusted library id. Never repairs or writes an index. */
export async function readOfflineGameSaves(libraryId: string, overrides?: Partial<OfflineListDeps>): Promise<OfflineSaveList | null> {
  const deps = dependencies(overrides)
  const config = deps.config
  const entry = config.library.find((item) => item.id === libraryId)
  if (!entry) return null
  const resolved = deps.resolve(entry.gameRoot)
  if (!resolved.ok || resolved.remote) return null

  const gameFile = path.join(resolved.contentRoot, gameContentRelPath('gameSavesIndex'))
  const candidates: Candidate[] = [
    { priority: 2, file: path.join(new GameSavesAppStore(libraryId, deps.dataDir).root, 'index.json') },
    { priority: 1, file: path.join(new GameSavesAppStore(`path:${path.resolve(entry.gameRoot)}`, deps.dataDir).root, 'index.json') },
  ]
  const [game, ...appSources] = await Promise.all([
    readSource('game', gameFile),
    ...candidates.map(async (candidate) => ({ source: await readSource('app', candidate.file), priority: candidate.priority })),
  ])
  return { gameId: libraryId, game: game as OfflineSaveSource, app: mergeAppSources(appSources as Array<{ source: OfflineSaveSource; priority: number }>) }
}

export async function readOfflineSaveThumbnail(libraryId: string, place: OfflineSaveSource['place'], list: GameSaveList, entryId: string): Promise<string | null> {
  if (!isGameSaveEntryId(entryId) || entryId.startsWith('quick-') !== (list === 'quick')) return null
  const config = loadConfig()
  const entry = config.library.find((item) => item.id === libraryId)
  if (!entry) return null
  const resolved = resolveGame(entry.gameRoot)
  if (!resolved.ok || resolved.remote) return null
  const inventory = await readOfflineGameSaves(libraryId)
  if (!inventory?.[place].entries.some((item) => item.id === entryId && item.list === list && item.hasThumb)) return null
  const files =
    place === 'game'
      ? [path.join(resolved.contentRoot, 'chaya', 'saves', list, `${entryId}.jpg`)]
      : [
          path.join(new GameSavesAppStore(libraryId).root, list, `${entryId}.jpg`),
          path.join(new GameSavesAppStore(`path:${path.resolve(entry.gameRoot)}`).root, list, `${entryId}.jpg`),
        ]
  for (const file of files) {
    try {
      return `data:image/jpeg;base64,${(await fs.readFile(file)).toString('base64')}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return null
}
