import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { applyCacheRow, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'
import type { SentenceRecord } from '@/lib/translate/sentence-plan'

import { isReusableTranslation } from './text-classify'

/** Preserve provenance for planning instead of treating every backfill as a local human decision. */
export function loadGameTranslationRecords(contentRoot: string, current?: (origin: NonNullable<CacheRow['origin']>) => boolean): SentenceRecord[] {
  const rows = new Map<string, CacheRow>()
  const seed = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  const cache = gameContentReadPath(contentRoot, 'cacheNdjson', { alsoParent: true })
  if (seed) {
    let data: unknown
    try {
      data = JSON.parse(fs.readFileSync(seed, 'utf8'))
    } catch {
      data = null
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) for (const [s, t] of Object.entries(data)) if (typeof t === 'string' && t) rows.set(s, { s, t, engine: 'seed' })
  }
  if (cache)
    for (const line of fs.readFileSync(cache, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const row = parseCacheRow(JSON.parse(line))
        if (row) applyCacheRow(rows, row)
      } catch {
        /* Ignore incomplete legacy tails. */
      }
    }
  return [...rows.values()]
    .filter((r) => r.t && isReusableTranslation(r.s, r.t) && (!r.origin || !current || current(r.origin)))
    .map((r) => ({
      id: r.origin?.id || `local:${r.s}`,
      revision: r.origin?.revision || 0,
      src: r.s,
      zh: r.t!,
      engine: r.engine || 'legacy-local',
      alignments: r.alignments,
      newlines: r.newlines,
      local: !r.origin,
    }))
}
