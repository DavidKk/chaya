/** Recover durable game translations without shared sentence coverage or schema preparation. */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import { gameContentReadPath } from '@/lib/game/content-files'
import { GAME_CONTENT_DIR, GAME_CONTENT_RELS, type GameContentKind, LEGACY_FLAT_FILES } from '@/lib/game/content-paths'
import { createNumericLabelIndex } from '@/lib/translate/dynamic-template'
import { filterRgssSeedKeys } from '@/services/extract/lib/rgss'

import type { SeedProgress } from '../fill-missing'
import { createGameTranslateLookup } from '../game-lookup'
import { loadGameTranslationRecords } from '../game-records'
import { charCount, lineCount, shouldTranslate } from '../text-classify'

/**
 * Resolve game content under the content root without storage IPC.
 * Safe on Next.js poll / extract-items entry — never `publicGameFile` / `Atomics.wait`.
 */
export function localGameContentFile(contentRoot: string, kind: GameContentKind): string | null {
  const roots = [path.resolve(contentRoot)]
  const parent = path.dirname(roots[0])
  if (parent !== roots[0]) roots.push(parent)
  for (const root of roots) {
    const primary = path.join(root, GAME_CONTENT_DIR, GAME_CONTENT_RELS[kind])
    if (fs.existsSync(primary)) return primary
    for (const name of LEGACY_FLAT_FILES[kind]) {
      const candidate = path.join(root, name)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

export function seedFileStamp(contentRoot: string): string {
  const file = localGameContentFile(contentRoot, 'seed')
  const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
  return JSON.stringify([file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size])
}

export function readSeedInventory(contentRoot: string) {
  const file = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  const data: unknown = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Seed must be an object mapping source text to translation')
  const entries = data as Record<string, unknown>
  const keys = filterRgssSeedKeys(
    contentRoot,
    Object.keys(entries).filter((key) => key.trim())
  )
  const progress: SeedProgress = {
    contentRoot,
    hasSeed: keys.length > 0,
    total: keys.length,
    done: 0,
    missing: 0,
    needCount: 0,
    skipCount: 0,
    needChars: 0,
    skipChars: 0,
    missingChars: 0,
    doneChars: 0,
    lines: 0,
    batchSize: 40,
    batchesLeft: 0,
  }
  // Durable game mirrors are part of progress too. Reading indexed origin revisions is
  // enough here; do not migrate the shared DB or run sentence coverage before dispatch.
  let client: DatabaseSync | undefined
  let revisionQuery: ReturnType<DatabaseSync['prepare']> | undefined
  let unavailable = false
  const revisions = new Map<string, boolean>()
  let records: ReturnType<typeof loadGameTranslationRecords>
  try {
    records = loadGameTranslationRecords(contentRoot, (origin) => {
      if (unavailable || !TRANSLATE_CACHE_DB_PATH || origin.database !== TRANSLATE_CACHE_DB_PATH) return false
      const key = `${origin.id}:${origin.revision}`
      if (!revisions.has(key)) {
        try {
          if (!client) {
            if (!fs.existsSync(TRANSLATE_CACHE_DB_PATH)) return false
            client = new DatabaseSync(TRANSLATE_CACHE_DB_PATH, { readOnly: true })
            client.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=250; BEGIN')
            revisionQuery = client.prepare('SELECT revision FROM translation_records WHERE id=?')
          }
          const row = revisionQuery!.get(origin.id) as { revision: number } | undefined
          revisions.set(key, row?.revision === origin.revision)
        } catch (error) {
          unavailable = true
          // eslint-disable-next-line no-console -- A failed authority check must remain visible without treating stale mirrors as saved progress.
          console.warn('Saved translation revision check unavailable:', error instanceof Error ? error.message : String(error))
          return false
        }
      }
      return revisions.get(key)!
    })
  } finally {
    client?.close()
  }
  // Exact / normalized local hits only. Do NOT call lookupCachedTranslation here —
  // recursive segment matching is RegExp-heavy and blocked the Next.js main thread
  // when inventory ran (poll auto-resume / start). Fuzzy hits still resolve in the
  // cache-lane worker once the job actually runs.
  const local = createGameTranslateLookup(records)
  const numeric = createNumericLabelIndex(records)
  const pending: string[] = []
  for (const key of keys) {
    const chars = charCount(key)
    progress.lines += lineCount(key)
    if (!shouldTranslate(key)) {
      progress.skipCount++
      progress.skipChars += chars
    } else {
      progress.needCount++
      progress.needChars += chars
      if (local[key] != null || numeric.resolve(key) != null) {
        progress.done++
        progress.doneChars += chars
      } else {
        progress.missing++
        progress.missingChars += chars
        pending.push(key)
      }
    }
  }
  progress.batchesLeft = Math.ceil(progress.missing / 40)
  return { progress, pending, stamp: seedFileStamp(contentRoot) }
}

/**
 * Cheap invalidation for paused snapshots; no matching, migrations or full corpus scan.
 * Only game-local seed/cache files under contentRoot (no storage mount / Atomics.wait).
 * Do NOT fingerprint the shared SQLite DB or its WAL: seed jobs rewrite the WAL constantly,
 * which used to invalidate this stamp on every progress poll and freeze `/translate/seed`.
 */
export function seedProgressStamp(contentRoot: string): string {
  const files = [localGameContentFile(contentRoot, 'seed'), localGameContentFile(contentRoot, 'cacheNdjson')]
  return JSON.stringify([
    4,
    files.map((file) => {
      const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size]
    }),
  ])
}
