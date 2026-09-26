import fs from 'node:fs'
import path from 'node:path'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import type { SharedCacheSortDir, SharedCacheSortKey } from '@/lib/translate/cache-query'
import { parseSharedCacheSortDir, parseSharedCacheSortKey } from '@/lib/translate/cache-query'

import { defaultSharedDbPath, openSharedCache } from './shared-cache'

type SharedStats = {
  entries: number
  sizeBytes: number
  file: string
}

export type TranslateCacheItem = {
  src: string
  zh: string
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

export function querySharedTranslateCache(opts: {
  page?: number
  pageSize?: number
  q?: string
  engine?: string
  nsfw?: boolean
  sort?: SharedCacheSortKey
  order?: SharedCacheSortDir
}): TranslateCachePage {
  const sort = parseSharedCacheSortKey(opts.sort)
  const order = parseSharedCacheSortDir(opts.order)
  const engine = String(opts.engine || '').trim()
  const q = String(opts.q || '').trim()
  const nsfw = Boolean(opts.nsfw)
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

/** 将解析后的译文写入共享库；默认已有 key 不覆盖 */
export function importSharedTranslateCache(
  map: Record<string, string>,
  opts: { overwrite?: boolean; engine?: string; format?: 'json' | 'ndjson'; skippedLines?: number } = {}
): ImportSharedTranslateResult {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    const engine = opts.engine || 'import'
    const entries = Object.entries(map)
    if (opts.overwrite) {
      const n = cache.upsertMany(entries as Array<[string, string]>, engine)
      return {
        format: opts.format || 'json',
        total: entries.length,
        inserted: n,
        skippedLines: opts.skippedLines || 0,
        skippedExisting: 0,
        file: cache.path,
      }
    }
    const { inserted, total } = cache.importIgnoreExisting(map, engine)
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

export type UpdateSharedTranslateResult = { updated: boolean; file: string; src: string; zh: string }
export type DeleteSharedTranslateResult = { deleted: boolean; file: string; src: string }

/** 修改一条共享缓存译文（原文作主键，不可改） */
export function updateSharedTranslateCache(src: string, zh: string, engine = 'manual'): UpdateSharedTranslateResult {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    const updated = cache.update(src, zh, engine)
    return { updated, file: cache.path, src: String(src), zh: String(zh).trim() }
  } finally {
    cache.close()
  }
}

/** 按原文删除一条共享缓存 */
export function deleteSharedTranslateCache(src: string): DeleteSharedTranslateResult {
  const cache = openSharedCache(defaultSharedDbPath())
  try {
    const deleted = cache.remove(src)
    return { deleted, file: cache.path, src: String(src) }
  } finally {
    cache.close()
  }
}
