/** Cache search runs off the service event loop. The writer still validates authority on commit. */
import { DatabaseSync } from 'node:sqlite'

import { detectCacheLang } from '@/lib/translate/cache-lang'
import { createNumericLabelIndex, numericLabelFamily } from '@/lib/translate/dynamic-template'
import type { SentencePlan } from '@/lib/translate/sentence-plan'

import { lookupCachedTranslation } from '../cache-lookup'
import { getGameCacheContext } from '../game-cache-context'
import { openSharedCache } from '../shared-cache'
import { createMatchIndex, type IndexedRecord } from '../shared-cache/match-index'

export type CacheScanResult = {
  id: number
  src: string
  plan: SentencePlan & { corpusVersion: string }
  stamp: string
  records?: IndexedRecord[]
  elapsedMs: number
}

export function createCacheScanner(contentRoot: string, file: string) {
  // Initialization/migrations belong on this worker too, never in front of dispatch.
  const prepared = openSharedCache(file)
  prepared.close()
  const client = new DatabaseSync(file, { readOnly: true })
  client.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=250')
  const index = createMatchIndex(client)
  return {
    close: () => client.close(),
    scan(id: number, src: string): CacheScanResult {
      const started = performance.now()
      const context = getGameCacheContext(contentRoot)
      const pair = { from: detectCacheLang(src), to: 'zh' as const }
      let records: IndexedRecord[] = []
      let plan: CacheScanResult['plan'] = index.plan(src, pair, context.resolver.select(src))
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
        if (hit == null && /\\(?:C\[|FS\[|RB\[|ruby\[)/i.test(src)) {
          hit = lookupCachedTranslation((key) => context.lookup[key] ?? index.authority(key, pair)?.zh, src)
        }
        if (hit != null) plan = { ...plan, status: 'full', zh: hit, gaps: [] }
      }
      if (!records.length)
        records = plan.matches
          .filter((match) => !match.record.local)
          .map((match) => index.record(match.record.src, pair))
          .filter((record): record is IndexedRecord => record != null)
      return { id, src, plan, records, stamp: context.stamp, elapsedMs: performance.now() - started }
    },
  }
}
