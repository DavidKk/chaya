/** Recover durable game translations without shared sentence coverage or schema preparation. */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import { gameContentReadPath } from '@/lib/game/content-files'
import { createNumericLabelIndex } from '@/lib/translate/dynamic-template'
import { filterRgssSeedKeys } from '@/services/extract/lib/rgss'

import { lookupCachedTranslation } from '../cache-lookup'
import type { SeedProgress } from '../fill-missing'
import { createGameTranslateLookup } from '../game-lookup'
import { loadGameTranslationRecords } from '../game-records'
import { charCount, lineCount, shouldTranslate } from '../text-classify'

export function seedFileStamp(contentRoot: string): string {
  const file = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
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
      if (local[key] != null || lookupCachedTranslation((source) => local[source], key) != null || numeric.resolve(key) != null) {
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

/** Cheap invalidation for paused snapshots; no matching, migrations or full corpus scan. */
export function seedProgressStamp(contentRoot: string): string {
  const files = [
    gameContentReadPath(contentRoot, 'seed', { alsoParent: true }),
    gameContentReadPath(contentRoot, 'cacheNdjson', { alsoParent: true }),
    TRANSLATE_CACHE_DB_PATH,
    TRANSLATE_CACHE_DB_PATH ? `${TRANSLATE_CACHE_DB_PATH}-wal` : null,
  ]
  return JSON.stringify([
    2,
    files.map((file) => {
      const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size]
    }),
  ])
}
