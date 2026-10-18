import { extractParallelCorpus, loadGameLocalesCatalog } from '@/services/extract/lib/game-locales'

import { openSharedCache } from './shared-cache'

export type ImportLocalesCorpusResult = {
  ok: boolean
  hasLocales: boolean
  languages: string[]
  totalPairs: number
  inserted: number
  error?: string
}

/**
 * Extract non-redundant parallel text pairs from game locales
 * and batch-insert them into the shared SQLite database (translate-cache.db).
 */
export function importGameLocalesCorpus(contentRoot: string, opts: { limit?: number; batchSize?: number } = {}): ImportLocalesCorpusResult {
  const catalog = loadGameLocalesCatalog(contentRoot)
  if (!catalog.hasLocales || catalog.languages.length < 2) {
    return {
      ok: true,
      hasLocales: false,
      languages: catalog.languages,
      totalPairs: 0,
      inserted: 0,
    }
  }

  const pairs = extractParallelCorpus(catalog)
  const limit = opts.limit && opts.limit > 0 ? opts.limit : pairs.length
  const selectedPairs = pairs.slice(0, limit)

  if (!selectedPairs.length) {
    return {
      ok: true,
      hasLocales: true,
      languages: catalog.languages,
      totalPairs: 0,
      inserted: 0,
    }
  }

  const cache = openSharedCache()
  let inserted = 0
  const batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : 1000

  try {
    for (let i = 0; i < selectedPairs.length; i += batchSize) {
      const chunk = selectedPairs.slice(i, i + batchSize)
      for (const pair of chunk) {
        try {
          const res = cache.writeMany([[pair.src, pair.zh]], 'game:locales', {
            from: pair.from as any,
            to: pair.to as any,
          })
          inserted += res.accepted.length
        } catch {
          // ignore single item conflict/error
        }
      }
    }

    return {
      ok: true,
      hasLocales: true,
      languages: catalog.languages,
      totalPairs: selectedPairs.length,
      inserted,
    }
  } catch (err) {
    return {
      ok: false,
      hasLocales: true,
      languages: catalog.languages,
      totalPairs: selectedPairs.length,
      inserted,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    cache.close()
  }
}
