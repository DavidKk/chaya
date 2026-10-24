import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { GAME_CONTENT_RELS, type GameContentKind } from '@/lib/game/content-paths'

import { storageCall } from './client'

const ownerDirectories = new Map<string, { gameId: string; directory: string }>()
const ownerWriters = new Map<string, (rows: unknown[], key?: string) => unknown>()
export function registerPublicGameWriter(directory: string, append: (rows: unknown[], key?: string) => unknown) {
  ownerWriters.set(path.join(directory, GAME_CONTENT_RELS.cacheNdjson), append)
}
export function appendPublicCacheFile(file: string, rows: unknown[]): boolean {
  const writer = ownerWriters.get(file)
  if (!writer) return false
  writer(rows)
  return true
}
export function registerPublicGameDirectory(root: string, state: { gameId: string; directory: string }) {
  ownerDirectories.set(path.resolve(root), state)
}

export function publicGameFiles(contentRoot: string) {
  const local = ownerDirectories.get(path.resolve(contentRoot))
  if (local) return local
  if (process.env.CHAYA_STORAGE_OWNER === '1') {
    const mounted = ownerDirectories.get(path.resolve(contentRoot))
    if (!mounted) throw new Error('Game storage must be mounted before accessing its read views')
    return mounted
  }
  return storageCall<{ gameId: string; directory: string }>('game.mount', [contentRoot])
}

export function publicGameFile(contentRoot: string, kind: GameContentKind) {
  return path.join(publicGameFiles(contentRoot).directory, GAME_CONTENT_RELS[kind])
}

export function appendPublicGameCache(contentRoot: string, rows: unknown[]) {
  for (let offset = 0; offset < rows.length; offset += 500) storageCall('game.append', [contentRoot, rows.slice(offset, offset + 500), randomUUID()])
}

export function writePublicGameDocument(contentRoot: string, kind: GameContentKind, value: unknown) {
  return storageCall('game.write', [contentRoot, kind, value])
}
