/** Reuse local authority indexes; shared-origin mirrors are queried through SQLite, never scanned twice. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'

import { parseCacheRow } from '@/lib/translate/cache-row'
import { numericLabelFamily } from '@/lib/translate/dynamic-template'
import type { SentenceRecord } from '@/lib/translate/sentence-plan'
import { createSentenceResolver } from '@/lib/translate/sentence-plan'

import { createGameTranslateLookup } from './game-lookup'
import { gameTranslationFiles, loadGameTranslationRecords } from './game-records'

const contexts = new Map<string, ReturnType<typeof buildContext> & { stamp: string }>()
function buildContext(contentRoot: string) {
  const records = loadGameTranslationRecords(contentRoot, () => false)
  const blocked = new Set<string>()
  const file = gameTranslationFiles(contentRoot).cache
  if (file && fs.existsSync(file))
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const row = parseCacheRow(JSON.parse(line))
      if (!row?.origin) {
        if (row?.t === null) blocked.add(row.s)
        else if (row) blocked.delete(row.s)
      }
    }
  const numeric = new Map<string, SentenceRecord[]>()
  for (const record of records) {
    const family = numericLabelFamily(record.src)
    if (family) numeric.set(family, [...(numeric.get(family) || []), record])
  }
  // The cache worker and the main process are separate workers. A process-local
  // counter cannot be compared across them, so use a content-addressed version.
  // Shared-origin mirrors are validated by shared revision, not by local authority.
  const { seed } = gameTranslationFiles(contentRoot)
  const authorityVersion = createHash('sha256')
    .update(JSON.stringify([seed, records.filter((record) => record.local), [...blocked].sort()]))
    .digest('hex')
  return {
    records,
    blocked: (src: string) => blocked.has(src),
    resolver: createSentenceResolver(records),
    lookup: createGameTranslateLookup(records),
    numericRecords: (src: string) => numeric.get(numericLabelFamily(src) || '') || [],
    authorityVersion,
  }
}

export function getGameCacheContext(contentRoot: string) {
  const { stamp } = gameTranslationFiles(contentRoot)
  let context = contexts.get(contentRoot)
  if (context?.stamp !== stamp) {
    context = { ...buildContext(contentRoot), stamp }
    if (contexts.size >= 8 && !contexts.has(contentRoot)) contexts.delete(contexts.keys().next().value!)
    contexts.set(contentRoot, context)
  }
  return context
}

/**
 * Advance a worker's cached context stamp without rebuilding its resolver after a
 * coordinator-verified owned backfill. Returns false when the worker's current
 * stamp already diverged (concurrent external edit), so it must rebuild instead.
 */
export function advanceGameCacheStamp(contentRoot: string, beforeStamp: string, afterStamp: string): boolean {
  const context = contexts.get(contentRoot)
  if (!context || context.stamp !== beforeStamp) return false
  context.stamp = afterStamp
  return true
}

/** A successful shared-only append cannot change local authority. External changes still rebuild. */
export function noteGameSharedBackfill(contentRoot: string, previousStamp: string): boolean {
  const context = contexts.get(contentRoot)
  // No cached authority exists to preserve; the next context build will observe
  // the append and any concurrent external change through its own stamp.
  if (!context) return true
  if (context?.stamp !== previousStamp) return false
  const stamp = gameTranslationFiles(contentRoot).stamp
  const before = JSON.parse(previousStamp) as unknown[][]
  const after = JSON.parse(stamp) as unknown[][]
  // A seed edit or a different fallback file is not part of the owned shared append.
  if (JSON.stringify(before[0]) !== JSON.stringify(after[0])) return false
  if (before[1][0] != null && before[1][0] !== after[1][0]) return false
  context.stamp = stamp
  return true
}
