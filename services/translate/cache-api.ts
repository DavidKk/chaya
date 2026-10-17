import fs from 'node:fs'
import path from 'node:path'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import { type CacheLang, parseCacheLang, resolveCacheLangPair } from '@/lib/translate/cache-lang'
import type { SharedCacheSortDir, SharedCacheSortKey } from '@/lib/translate/cache-query'
import { parseSharedCacheSortDir, parseSharedCacheSortKey } from '@/lib/translate/cache-query'
import type { AlignmentGroup } from '@/lib/translate/sentence-plan'

import { appendGameNdjson, resolveBoundContentRoot } from './live-translate'
import { defaultSharedDbPath, openSharedCache } from './shared-cache'

type SharedStats = {
  entries: number
  sizeBytes: number
  file: string
}

export type TranslateCacheItem = {
  /** SQLite rowid — stable enough for optimize deep links within a running DB. */
  id: number
  src: string
  zh: string
  from: CacheLang
  to: CacheLang
  engine: string | null
  updatedAt: number
  hitCount: number
  nsfw: boolean
}

export type TranslateCachePage = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  q: string
  engine: string
  nsfw: boolean
  nsfwFlag: string
  live: string
  from: string
  to: string
  sort: SharedCacheSortKey
  order: SharedCacheSortDir
  engines: string[]
  items: TranslateCacheItem[]
  file: string
}

export function getSharedTranslateCacheStats(): SharedStats {
  try {
    const dbPath = defaultSharedDbPath()
    if (!fs.existsSync(path.dirname(dbPath))) {
      return { entries: 0, sizeBytes: 0, file: dbPath }
    }
    const cache = openSharedCache(dbPath)
    const stats = cache.stats()
    cache.close()
    return stats
  } catch {
    return {
      entries: 0,
      sizeBytes: 0,
      file: TRANSLATE_CACHE_DB_PATH,
    }
  }
}

export function getSharedTranslateCacheById(id: number): TranslateCacheItem | null {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    return cache.getById(id)
  } finally {
    cache.close()
  }
}

export function querySharedTranslateCache(opts: {
  page?: number
  pageSize?: number
  q?: string
  engine?: string
  nsfw?: boolean
  nsfwFlag?: string
  live?: string
  from?: string
  to?: string
  sort?: SharedCacheSortKey
  order?: SharedCacheSortDir
}): TranslateCachePage {
  const sort = parseSharedCacheSortKey(opts.sort)
  const order = parseSharedCacheSortDir(opts.order)
  const engine = String(opts.engine || '').trim()
  const q = String(opts.q || '').trim()
  const nsfw = Boolean(opts.nsfw)
  const nsfwFlag = String(opts.nsfwFlag || '')
  const live = String(opts.live || '')
  const from = String(opts.from || '')
  const to = String(opts.to || '')
  const dbPath = defaultSharedDbPath()
  if (!fs.existsSync(dbPath)) {
    const page = Math.max(1, Number(opts.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(opts.pageSize) || 50))
    return {
      page,
      pageSize,
      total: 0,
      totalPages: 1,
      q,
      engine,
      nsfw,
      nsfwFlag,
      live,
      from,
      to,
      sort,
      order,
      engines: [],
      items: [],
      file: dbPath,
    }
  }
  const cache = openSharedCache(dbPath)
  try {
    const page = cache.listPage({ ...opts, q, engine, nsfw, sort, order })
    return { ...page, file: cache.path }
  } finally {
    cache.close()
  }
}

export type ImportSharedTranslateResult = {
  format: 'json' | 'ndjson'
  total: number
  inserted: number
  skippedLines: number
  skippedExisting: number
  file: string
}

/** Write parsed translations to the shared cache without overwriting existing keys by default. */
export function importSharedTranslateCache(
  map: Record<string, string>,
  opts: { overwrite?: boolean; engine?: string; format?: 'json' | 'ndjson'; skippedLines?: number; alignments?: Array<{ src: string; groups: AlignmentGroup[] }> } = {}
): ImportSharedTranslateResult {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    const engine = opts.engine || 'import'
    const entries = Object.entries(map)
    function applyAlignments() {
      for (const item of opts.alignments || []) {
        const from = resolveCacheLangPair({ src: item.src })
        const record = cache.record(item.src, from)
        if (record?.engine === engine && record.zh === map[item.src]) cache.setAlignment(item.src, from, item.groups, record.revision)
      }
    }
    if (opts.overwrite) {
      const n = cache.upsertMany(entries as Array<[string, string]>, engine)
      applyAlignments()
      return {
        format: opts.format || 'json',
        total: entries.length,
        inserted: n,
        skippedLines: opts.skippedLines || 0,
        skippedExisting: Math.max(0, entries.length - n),
        file: cache.path,
      }
    }
    const { inserted, total } = cache.importIgnoreExisting(map, engine)
    applyAlignments()
    return {
      format: opts.format || 'json',
      total,
      inserted,
      skippedLines: opts.skippedLines || 0,
      skippedExisting: Math.max(0, total - inserted),
      file: cache.path,
    }
  } finally {
    cache.close()
  }
}

export type UpdateSharedTranslateResult = { updated: boolean; file: string; src: string; zh: string; nsfw?: boolean }
export type DeleteSharedTranslateResult = { deleted: boolean; file: string; src: string }

/** Update a shared translation; the language pair plus source form the immutable key. */
export function updateSharedTranslateCache(
  src: string,
  zh: string,
  engine = 'manual',
  pair?: { from?: string; to?: string },
  opts?: { nsfw?: boolean }
): UpdateSharedTranslateResult {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    const updated = cache.update(src, zh, engine, { from: parseCacheLang(pair?.from) || undefined, to: parseCacheLang(pair?.to) || undefined }, opts)
    return { updated, file: cache.path, src: String(src), zh: String(zh).trim(), nsfw: opts?.nsfw }
  } finally {
    cache.close()
  }
}

/** Manually mark or clear NSFW on a shared row without changing the translation. */
export function setSharedTranslateCacheNsfw(src: string, nsfw: boolean, pair?: { from?: string; to?: string }): UpdateSharedTranslateResult {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    const updated = cache.setNsfw(src, nsfw, { from: parseCacheLang(pair?.from) || undefined, to: parseCacheLang(pair?.to) || undefined })
    return { updated, file: cache.path, src: String(src), zh: '', nsfw }
  } finally {
    cache.close()
  }
}

/** Delete a shared translation by source text and language pair. */
export function deleteSharedTranslateCache(src: string, pair?: { from?: string; to?: string }): DeleteSharedTranslateResult {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    const deleted = cache.remove(src, { from: parseCacheLang(pair?.from) || undefined, to: parseCacheLang(pair?.to) || undefined })
    return { deleted, file: cache.path, src: String(src) }
  } finally {
    cache.close()
  }
}

export type UpsertSharedTranslatePairsResult = {
  /** @deprecated Prefer `inserted`; kept for older clients. */
  upserted: number
  inserted: number
  identical: number
  conflict: number
  skipped: number
  /** 原文===译文 — not written to shared; may be appended to game ndjson. */
  localOnly: number
  stale?: boolean
  dryRun?: boolean
  diagnostics?: Array<{ index: number; src: string; zh: string; ok: boolean; reason?: string }>
  /** How many localOnly pairs were written to the bound game's cache.ndjson. */
  game: number
  total: number
  file: string
}

export type ConfirmSharedOptimizeOptions = {
  newlines?: import('@/lib/translate/logic-text').NewlineAnnotation[]
  expectedRevision?: number
  dryRun?: boolean
  groups?: import('@/lib/translate/sentence-plan').AlignmentGroup[]
}

/**
 * Write optimize children: keep parent rows; insert new keys only.
 * Same key + same zh → identical; same key + different zh → conflict (skip, never overwrite).
 * 原文===译文 → game ndjson only (never shared).
 */
export function upsertSharedTranslateCachePairs(
  pairs: Array<{ src: string; zh: string }>,
  engine = 'manual:optimize',
  pair?: { from?: string; to?: string },
  parent?: { src: string; zh: string },
  confirm?: ConfirmSharedOptimizeOptions
): UpsertSharedTranslatePairsResult {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    const list = pairs.map((p) => [String(p.src ?? ''), String(p.zh ?? '').trim()] as [string, string]).filter(([src, zh]) => Boolean(src) && Boolean(zh))
    const stats = parent
      ? cache.confirmSegments(parent, list, resolveCacheLangPair({ ...pair, src: parent.src }), confirm)
      : cache.upsertOptimizeMany(list, engine, { from: parseCacheLang(pair?.from) || undefined, to: parseCacheLang(pair?.to) || undefined })
    let game = 0
    if (!confirm?.dryRun && stats.localOnly.length) {
      const root = resolveBoundContentRoot()
      if (root) game = appendGameNdjson(root, stats.localOnly)
    }
    return {
      ...('stale' in stats ? { stale: stats.stale === true } : {}),
      ...('dryRun' in stats ? { dryRun: stats.dryRun === true } : {}),
      ...(parent ? { diagnostics: (stats as ReturnType<typeof cache.confirmSegments>).diagnostics } : {}),
      upserted: stats.inserted,
      inserted: stats.inserted,
      identical: stats.identical,
      conflict: stats.conflict,
      skipped: stats.skipped,
      localOnly: stats.localOnly.length,
      game,
      total: stats.total,
      file: cache.path,
    }
  } finally {
    cache.close()
  }
}
