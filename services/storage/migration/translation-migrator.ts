import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

import { GAME_CONTENT_RELS, type GameContentKind, LEGACY_FLAT_FILES } from '@/lib/game/content-paths'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { applyCacheRow, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'
import type { SharedCacheDb } from '@/services/translate/shared-cache/db'

export type GameMigrationResult = {
  gameId: string
  seedImported: number
  cacheImported: number
  alreadyMigrated: boolean
}

export function legacyGameFile(contentRoot: string, kind: GameContentKind) {
  const candidates = [path.join(contentRoot, 'chaya', GAME_CONTENT_RELS[kind])]
  for (const root of [contentRoot, path.dirname(contentRoot)]) {
    for (const name of LEGACY_FLAT_FILES[kind]) candidates.push(path.join(root, name))
  }
  return candidates.find((file) => fs.existsSync(file))
}

function safeRealpath(raw: string): string {
  try {
    return fs.existsSync(raw) ? fs.realpathSync(raw) : path.resolve(raw)
  } catch {
    return path.resolve(raw)
  }
}

/** Import only after callers have stopped legacy writers. Source files are retained. */
export async function migrateGameTranslations(db: SharedCacheDb, options: { gameId: string; contentRoot: string; force?: boolean }): Promise<GameMigrationResult> {
  const { gameId, contentRoot, force } = options
  if (!gameId.trim()) throw new TypeError('gameId is required')
  const dir = path.join(safeRealpath(contentRoot), 'chaya', 'translate')
  const result: GameMigrationResult = { gameId, seedImported: 0, cacheImported: 0, alreadyMigrated: false }
  const client = db.$client
  const migrationKey = `storage:game-import:v1:${gameId}:${createHash('sha256').update(dir).digest('hex')}`
  const migrated = () => Boolean(client.prepare('SELECT value FROM cache_meta WHERE key = ?').get(migrationKey))
  // A marker copied with a game, or restored without its database, is not proof of import.
  if (!force && migrated()) return { ...result, alreadyMigrated: true }
  const files = [legacyGameFile(contentRoot, 'seed') || path.join(dir, 'seed.json'), legacyGameFile(contentRoot, 'cacheNdjson') || path.join(dir, 'cache.ndjson')]
  const stamp = (file: string) => {
    if (!fs.existsSync(file)) return null
    const stat = fs.statSync(file)
    return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  }
  const before = files.map(stamp)
  const rows = new Map<string, CacheRow>()
  const deleted = new Map<string, CacheRow>()
  const now = Date.now()
  if (before[0] !== null) {
    const seed: unknown = JSON.parse(fs.readFileSync(files[0], 'utf8').replace(/^\uFEFF/, ''))
    if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new Error('Invalid seed map; migration aborted')
    for (const [src, value] of Object.entries(seed)) {
      const text = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { zh?: unknown }).zh : undefined
      if (typeof text !== 'string') throw new Error(`Invalid seed entry: ${src}`)
      if (!src || !text.trim()) continue
      rows.set(src, { s: src, t: text, engine: 'seed', at: now })
      result.seedImported++
    }
  }
  if (before[1] !== null) {
    const stream = fs.createReadStream(files[1], { encoding: 'utf8' })
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (!line.trim()) continue
        const value: unknown = JSON.parse(line)
        const row = parseCacheRow(value)
        if (!row || !row.s) throw new Error('Invalid cache event; migration aborted')
        applyCacheRow(rows, row)
        if (row.t === null && !row.origin) deleted.set(row.s, row)
        else if (rows.has(row.s)) deleted.delete(row.s)
        result.cacheImported++
      }
    } finally {
      lines.close()
      stream.destroy()
    }
  }
  if (before.some((value, i) => value !== stamp(files[i]))) throw new Error('Legacy cache changed during import; retry after stopping its writer')
  const insert = client.prepare(`
    INSERT INTO game_translations (game_id, src, src_lang, tgt_lang, zh, engine, is_deleted, hit_count, updated_at, record_json)
    VALUES (?, ?, ?, 'zh', ?, ?, ?, 0, ?, ?)
    ON CONFLICT(game_id, src, src_lang, tgt_lang) DO NOTHING
  `)
  client.exec('BEGIN IMMEDIATE')
  try {
    if (!force && migrated()) {
      client.exec('ROLLBACK')
      return { ...result, seedImported: 0, cacheImported: 0, alreadyMigrated: true }
    }
    for (const row of [...rows.values(), ...deleted.values()]) {
      if (row.t !== null && !row.t.trim()) continue
      insert.run(gameId, row.s, detectCacheLang(row.s), row.t, row.engine || 'cache', row.t === null ? 1 : 0, Number.isFinite(row.at) ? row.at! : now, JSON.stringify(row))
    }
    client
      .prepare('INSERT INTO cache_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(migrationKey, JSON.stringify({ gameId, migratedAt: now, sources: before }))
    client.exec('COMMIT')
  } catch (error) {
    client.exec('ROLLBACK')
    throw error
  }
  return result
}
