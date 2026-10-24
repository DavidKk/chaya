/** File fixture adapter for domain unit tests. Real RPC/SQLite is covered by storage integration tests. */
import fs from 'node:fs'
import path from 'node:path'

import { GAME_CONTENT_RELS, type GameContentKind } from '@/lib/game/content-paths'
import { appendCacheLines } from '@/lib/translate/cache-file-lock'

export const publicGameFiles = (root: string) => ({ gameId: root, directory: path.join(root, 'chaya') })
export const publicGameFile = (root: string, kind: GameContentKind) => path.join(publicGameFiles(root).directory, GAME_CONTENT_RELS[kind])
export function appendPublicGameCache(root: string, rows: unknown[]) {
  const file = publicGameFile(root, 'cacheNdjson')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  appendCacheLines(fs, file, rows)
}
export function writePublicGameDocument(root: string, kind: GameContentKind, value: unknown) {
  const file = publicGameFile(root, kind)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}
export const appendPublicCacheFile = () => false
export const pluginStorageCall = async (method: string, args: unknown[]) => {
  const root = String(args[0])
  if (method === 'game.mount') return publicGameFiles(root)
  if (method === 'game.append') return appendPublicGameCache(root, args[1] as unknown[])
  if (method === 'game.write') return writePublicGameDocument(root, args[1] as GameContentKind, args[2])
  if (method === 'game.read') {
    const file = publicGameFile(root, args[1] as GameContentKind)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  }
  throw new Error(`Unsupported fixture call: ${method}`)
}
export const flushPendingStorage = async () => {}
export const queueStorageMutation = async (_root: string, method: string, args: unknown[]) => pluginStorageCall(method, args)
