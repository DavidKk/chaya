/** Cache search runs off the service event loop. The writer still validates authority on commit. */
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { type SentencePlan } from '@/lib/translate/sentence-plan'

import { getGameCacheContext } from '../game-cache-context'
import { planGameCache } from '../game-cache-plan'
import { openSharedCache } from '../shared-cache'
import type { IndexedRecord } from '../shared-cache/match-index'

export type CacheScanResult = {
  id: number
  src: string
  plan: SentencePlan & { corpusVersion: string }
  stamp: string
  authorityVersion: string
  records?: IndexedRecord[]
  elapsedMs: number
}

export function createCacheScanner(contentRoot: string, file: string) {
  // Initialization/migrations belong on this worker too, never in front of dispatch.
  const index = openSharedCache(file)
  return {
    close: () => index.close(),
    scan(id: number, src: string): CacheScanResult {
      const started = performance.now()
      const context = getGameCacheContext(contentRoot)
      const pair = { from: detectCacheLang(src), to: 'zh' as const }
      const { plan, records } = planGameCache(src, pair, index, context)
      return { id, src, plan, records, stamp: context.stamp, authorityVersion: context.authorityVersion, elapsedMs: performance.now() - started }
    },
  }
}
