import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { applyCacheRow, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'
import type { SentenceRecord } from '@/lib/translate/sentence-plan'

import { isReusableTranslation } from './text-classify'

type Snapshot = { stamp: string; entries: Array<{ row: CacheRow; record: SentenceRecord }> }
const snapshots = new Map<string, Snapshot>()

/** File identity participates so an external replacement cannot reuse a stale snapshot. */
export function gameTranslationFiles(contentRoot: string) {
  const seed = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  const cache = gameContentReadPath(contentRoot, 'cacheNdjson', { alsoParent: true })
  const stamp = JSON.stringify(
    [seed, cache].map((file) => {
      const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size]
    })
  )
  return { seed, cache, stamp }
}

/** Reparse only changed game files; origin validation is evaluated against the caller's current database. */
export function loadGameTranslationRecords(contentRoot: string, current?: (origin: NonNullable<CacheRow['origin']>) => boolean): SentenceRecord[] {
  const { seed, cache, stamp } = gameTranslationFiles(contentRoot)
  let snapshot = snapshots.get(contentRoot)
  if (snapshot?.stamp !== stamp) {
    const rows = new Map<string, CacheRow>()
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
    const entries = [...rows.values()]
      .filter((r) => r.t && isReusableTranslation(r.s, r.t))
      .map((row) => ({
        row,
        record: {
          id: row.origin?.id || `local:${row.s}`,
          revision: row.origin?.revision || 0,
          src: row.s,
          zh: row.t!,
          engine: row.engine || 'legacy-local',
          alignments: row.alignments,
          structure: row.structure,
          newlines: row.newlines,
          local: !row.origin,
        },
      }))
    snapshot = { stamp, entries }
    if (snapshots.size >= 8 && !snapshots.has(contentRoot)) snapshots.delete(snapshots.keys().next().value!)
    snapshots.set(contentRoot, snapshot)
  }
  return snapshot.entries.filter(({ row }) => !row.origin || !current || current(row.origin)).map(({ record }) => record)
}
