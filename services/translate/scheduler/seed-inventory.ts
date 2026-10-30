/** Prepare game inventory with the same cached sentence coverage as translation jobs. */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import { localGameContentFile } from '@/lib/game/content-files'
import { filterRgssSeedKeys } from '@/services/extract/lib/rgss'

import type { SeedProgress } from '../fill-missing'
import { getGameCacheContext } from '../game-cache-context'
import { createGameCoverage } from '../game-coverage'
import { loadGameTranslationRecords } from '../game-records'
import { readSeedFailures, seedFailureFile } from '../seed-failures'
import { charCount, lineCount, shouldTranslate } from '../text-classify'

export { localGameContentFile } from '@/lib/game/content-files'

export function seedFileStamp(contentRoot: string): string {
  const file = localGameContentFile(contentRoot, 'seed')
  const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
  return JSON.stringify([file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size])
}

export function readSeedInventory(contentRoot: string) {
  // Capture before reading so concurrent writes cannot make an older inventory appear fresh.
  const stamp = seedFileStamp(contentRoot)
  const progressStamp = seedProgressStamp(contentRoot)
  // Local fs only — never publicGameFile (Atomics.wait freezes Next on sync fallback / worker prep).
  const file = localGameContentFile(contentRoot, 'seed')
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
  // Validate durable mirrors against indexed revisions without migrating the shared DB.
  let client: DatabaseSync | undefined
  let revisionQuery: ReturnType<DatabaseSync['prepare']> | undefined
  let unavailable = false
  const revisions = new Map<string, boolean>()
  let records: ReturnType<typeof loadGameTranslationRecords>
  try {
    records = loadGameTranslationRecords(
      contentRoot,
      (origin) => {
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
      },
      { localOnly: true }
    )
  } finally {
    client?.close()
  }
  // Explicit preparation runs in a worker; polling still reads checkpoints only.
  const coverage = createGameCoverage(records, { blocked: getGameCacheContext(contentRoot).blocked })
  const pending: string[] = []
  const failures = readSeedFailures(contentRoot)
  try {
    for (const key of keys) {
      const chars = charCount(key)
      progress.lines += lineCount(key)
      if (!shouldTranslate(key)) {
        progress.skipCount++
        progress.skipChars += chars
      } else {
        progress.needCount++
        progress.needChars += chars
        if (coverage.resolve(key) != null) {
          progress.done++
          progress.doneChars += chars
        } else if (failures.has(key)) {
          progress.failedCount = (progress.failedCount ?? 0) + 1
          progress.failedChars = (progress.failedChars ?? 0) + chars
        } else {
          progress.missing++
          progress.missingChars += chars
          pending.push(key)
        }
      }
    }
  } finally {
    coverage.close()
  }
  progress.batchesLeft = Math.ceil(progress.missing / 40)
  return { progress, pending, stamp, progressStamp }
}

/**
 * Cheap invalidation for paused snapshots; no matching, migrations or full corpus scan.
 * Only game-local seed/cache files under contentRoot (no storage mount / Atomics.wait).
 * Do NOT fingerprint the shared SQLite DB or its WAL: seed jobs rewrite the WAL constantly,
 * which used to invalidate this stamp on every progress poll and freeze `/translate/seed`.
 */
export function seedProgressStamp(contentRoot: string): string {
  const files = [localGameContentFile(contentRoot, 'seed'), localGameContentFile(contentRoot, 'cacheNdjson'), seedFailureFile(contentRoot)]
  return JSON.stringify([
    7,
    files.map((file) => {
      const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size]
    }),
  ])
}
