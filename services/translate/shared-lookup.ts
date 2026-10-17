import { detectCacheLang } from '@/lib/translate/cache-lang'
import { type CacheOrigin } from '@/lib/translate/cache-row'
import { lookupGameTerm } from '@/lib/translate/game-terms'

import { openSharedCache } from './shared-cache'

/** No game binding, engine inference or file writes: optional shared lookup plus provenance validation. */
export function lookupSharedTranslationSnapshot(texts: string[], origins: unknown = []) {
  const cache = openSharedCache()
  try {
    const references = (Array.isArray(origins) ? origins : [])
      .filter((r): r is CacheOrigin => !!r && typeof r.id === 'string' && Number.isInteger(r.revision) && typeof r.database === 'string')
      .slice(0, 500)
    const invalidOrigins = references.filter((r) => r.database !== cache.path || !cache.current([{ ...r, src: '', zh: '' }]))
    const items = texts.map((src) => {
      const plan = cache.plan(src, { from: detectCacheLang(src), to: 'zh' })
      return { src, zh: plan.zh ?? lookupGameTerm(src), plan }
    })
    return { items, invalidOrigins }
  } finally {
    cache.close()
  }
}
export function lookupSharedTranslations(texts: string[]) {
  return lookupSharedTranslationSnapshot(texts).items
}
