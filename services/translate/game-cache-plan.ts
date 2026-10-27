import type { CacheLangPair } from '@/lib/translate/cache-lang'
import { createNumericLabelIndex, numericLabelFamily } from '@/lib/translate/dynamic-template'
import { createSentenceResolver } from '@/lib/translate/sentence-plan'

import { lookupCachedTranslation } from './cache-lookup'
import type { getGameCacheContext } from './game-cache-context'
import type { IndexedRecord, MatchIndex } from './shared-cache/match-index'

/** Shared by cache scanning and durable game projections; rendering needs no sentence planner. */
export function planGameCache(
  src: string,
  pair: CacheLangPair,
  index: Pick<MatchIndex, 'plan' | 'record' | 'version' | 'numericRecords' | 'authority'>,
  context: ReturnType<typeof getGameCacheContext>
) {
  if (context.blocked(src)) return { plan: { ...createSentenceResolver([]).plan(src), corpusVersion: index.version() }, records: [] as IndexedRecord[] }
  let records: IndexedRecord[] = []
  let plan = index.plan(src, pair, context.resolver.select(src))
  if (!plan.limited && plan.status !== 'full') {
    let hit: string | null = null
    if (numericLabelFamily(src)) {
      const rows = index.numericRecords(pair, src)
      if (!rows.limited) {
        const examples = [...rows, ...context.numericRecords(src)]
        hit = createNumericLabelIndex(examples).resolve(src)
        if (hit != null) {
          const distinct = new Map(examples.map((record) => [record.src.match(/[0-9]+$/)?.[0], record]))
          records = [...distinct.values()].slice(0, 2).filter((record) => !record.local) as IndexedRecord[]
        }
      }
    }
    if (hit == null) {
      const used = new Map<string, IndexedRecord>()
      hit = lookupCachedTranslation((key) => {
        if (context.lookup[key] != null) return context.lookup[key]
        const record = index.authority(key, pair)
        if (!record || (record.src !== key && record.engine !== 'manual')) return null
        used.set(record.id!, record)
        return record.zh
      }, src)
      if (hit != null) records = [...used.values()]
    }
    if (hit != null) plan = { ...plan, status: 'full', zh: hit, gaps: [] }
  }
  if (!records.length)
    records = plan.matches
      .filter((match) => !match.record.local)
      .map((match) => index.record(match.record.src, pair))
      .filter((record): record is IndexedRecord => record != null)
  return { plan, records }
}
