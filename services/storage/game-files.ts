import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { GAME_CONTENT_RELS, type GameContentKind } from '@/lib/game/content-paths'

import { storageCall } from './client'

const ownerDirectories = new Map<string, { gameId: string; directory: string }>()
/** Next.js process cache of daemon mounts — avoids Atomics.wait IPC on every stamp/poll. */
const mountedDirectories = new Map<string, { gameId: string; directory: string }>()
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
  const key = path.resolve(root)
  ownerDirectories.set(key, state)
  mountedDirectories.set(key, state)
}

export function publicGameFiles(contentRoot: string) {
  const key = path.resolve(contentRoot)
  const local = ownerDirectories.get(key) ?? mountedDirectories.get(key)
  if (local) return local
  if (process.env.CHAYA_STORAGE_OWNER === '1') {
    const mounted = ownerDirectories.get(key)
    if (!mounted) throw new Error('Game storage must be mounted before accessing its read views')
    return mounted
  }
  const remote = storageCall<{ gameId: string; directory: string }>('game.mount', [contentRoot])
  mountedDirectories.set(key, remote)
  return remote
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
