import { detectCacheLang } from '@/lib/translate/cache-lang'
import { type CacheOrigin } from '@/lib/translate/cache-row'
import { canonicalResourceLanguage } from '@/lib/translate/resource-types'

import { loadResourceMatcher } from './resources/snapshot'
import { openSharedCache } from './shared-cache'

/** No game binding, engine inference or file writes: optional shared lookup plus provenance validation. */
export function lookupSharedTranslationSnapshot(texts: string[], origins: unknown = [], options: { sourceLang?: string; targetLang?: string } = {}) {
  const source = options.sourceLang === undefined ? undefined : canonicalResourceLanguage(options.sourceLang)
  const target = options.targetLang === undefined ? 'zh' : canonicalResourceLanguage(options.targetLang)
  const cache = openSharedCache()
  try {
    const resources = loadResourceMatcher(cache.path)
    const references = (Array.isArray(origins) ? origins : [])
      .filter((r): r is CacheOrigin => !!r && typeof r.id === 'string' && Number.isInteger(r.revision) && typeof r.database === 'string')
      .slice(0, 500)
    const invalidOrigins = references.filter((r) => r.database !== cache.path || !cache.current([{ ...r, src: '', zh: '' }]))
    const items = texts.map((src) => {
      const from = source ?? detectCacheLang(src)
      const plan = cache.plan(src, { from, to: target })
      const resource = plan.status === 'miss' && !plan.limited ? resources.match(src, { sourceLanguage: from, targetLanguage: target }) : null
      return { src, zh: plan.zh ?? resource?.targetText ?? null, resource: resource ?? undefined, plan }
    })
    return { items, invalidOrigins }
  } finally {
    cache.close()
  }
}
export function lookupSharedTranslations(texts: string[]) {
  return lookupSharedTranslationSnapshot(texts).items
}
