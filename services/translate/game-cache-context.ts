/** Reuse local authority indexes; shared-origin mirrors are queried through SQLite, never scanned twice. */
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
  if (file)
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
  return {
    records,
    blocked: (src: string) => blocked.has(src),
    resolver: createSentenceResolver(records),
    lookup: createGameTranslateLookup(records),
    numericRecords: (src: string) => numeric.get(numericLabelFamily(src) || '') || [],
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

/** A successful shared-only append cannot change local authority. External changes still rebuild. */
export function noteGameSharedBackfill(contentRoot: string, previousStamp: string) {
  const context = contexts.get(contentRoot)
  if (context?.stamp !== previousStamp) return
  const stamp = gameTranslationFiles(contentRoot).stamp
  const before = JSON.parse(previousStamp) as unknown[][]
  const after = JSON.parse(stamp) as unknown[][]
  // A seed edit or a different fallback file is not part of the owned shared append.
  if (JSON.stringify(before[0]) !== JSON.stringify(after[0])) return
  if (before[1][0] != null && before[1][0] !== after[1][0]) return
  context.stamp = stamp
}
