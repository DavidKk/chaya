/**
 * 全游戏共享翻译缓存（SQLite + Drizzle）
 * 默认：`@/constants` 的 `TRANSLATE_CACHE_DB_PATH`
 */
import fs from 'node:fs'

import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'

import { parseSharedCacheSortDir, parseSharedCacheSortKey, type SharedCacheSortDir, type SharedCacheSortKey } from '@/lib/translate/cache-query'
import { isNsfwCacheRow } from '@/services/translate/sensitive-text'
import { isIdenticalTranslation, isStorableTranslation, peelControlShell } from '@/services/translate/text-classify'

import { defaultSharedDbPath, openSharedCacheDb } from './db'
import { translations } from './schema'

export { defaultSharedDbPath, defaultSharedDir } from './db'
export { cacheMeta, sharedCacheSchema, translations } from './schema'
export type { SharedCacheSortDir, SharedCacheSortKey } from '@/lib/translate/cache-query'
export { parseSharedCacheSortDir, parseSharedCacheSortKey } from '@/lib/translate/cache-query'

export type SharedCacheListOpts = {
  page?: number
  pageSize?: number
  q?: string
  /** 精确匹配 engine；空 = 全部 */
  engine?: string
  /** true = 仅 NSFW 行（引擎 tag 或原文敏感） */
  nsfw?: boolean
  sort?: SharedCacheSortKey
  order?: SharedCacheSortDir
}

export type ScrubDirtyResult = { removed: number; rewritten: number }

/** 每个进程对每个库文件只 scrub 一次，避免每次 API 全表扫描 */
const scrubbedDbPaths = new Set<string>()

function nsfwBit(src: string, engine?: string | null): 0 | 1 {
  return isNsfwCacheRow(src, engine) ? 1 : 0
}

function escapeLike(q: string) {
  return String(q).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function listFilter(opts: { q?: string; engine?: string; nsfw?: boolean }) {
  const parts = []
  const q = String(opts.q || '').trim()
  const engine = String(opts.engine || '').trim()
  if (q) {
    const like = `%${escapeLike(q)}%`
    parts.push(sql`(${translations.src} LIKE ${like} ESCAPE '\\' OR ${translations.zh} LIKE ${like} ESCAPE '\\')`)
  }
  if (engine) parts.push(eq(translations.engine, engine))
  if (opts.nsfw) parts.push(eq(translations.nsfw, 1))
  return parts.length ? and(...parts) : undefined
}

export function openSharedCache(dbPath = defaultSharedDbPath()) {
  const { db, path: resolved } = openSharedCacheDb(dbPath)

  const cache = {
    path: resolved,

    loadAll(): Record<string, string> {
      const out: Record<string, string> = Object.create(null)
      for (const row of db.select({ src: translations.src, zh: translations.zh }).from(translations).all()) {
        if (isStorableTranslation(String(row.src), String(row.zh))) out[String(row.src)] = String(row.zh)
      }
      return out
    },

    get(src: string) {
      const row = db
        .select({ zh: translations.zh })
        .from(translations)
        .where(eq(translations.src, String(src)))
        .get()
      return row && isStorableTranslation(src, String(row.zh)) ? String(row.zh) : null
    },

    getMany(keys: string[]): Map<string, string> {
      const out = new Map<string, string>()
      const unique = [...new Set(keys)]
      for (let i = 0; i < unique.length; i += 500) {
        const rows = db
          .select({ src: translations.src, zh: translations.zh })
          .from(translations)
          .where(inArray(translations.src, unique.slice(i, i + 500)))
          .all()
        for (const row of rows) if (isStorableTranslation(row.src, row.zh)) out.set(row.src, row.zh)
      }
      return out
    },

    listPage(opts: SharedCacheListOpts = {}) {
      const pageSize = Math.min(200, Math.max(1, Number(opts.pageSize) || 50))
      const page = Math.max(1, Number(opts.page) || 1)
      const q = String(opts.q || '').trim()
      const engine = String(opts.engine || '').trim()
      const nsfwOnly = Boolean(opts.nsfw)
      const sort = parseSharedCacheSortKey(opts.sort)
      const order = parseSharedCacheSortDir(opts.order)
      const offset = (page - 1) * pageSize
      const where = listFilter({ q, engine, nsfw: nsfwOnly })

      const engines = db
        .selectDistinct({ engine: translations.engine })
        .from(translations)
        .where(and(isNotNull(translations.engine), ne(translations.engine, '')))
        .orderBy(sql`${translations.engine} COLLATE NOCASE`)
        .all()
        .map((r) => String(r.engine))
        .filter(Boolean)

      const totalRow = where ? db.select({ n: count() }).from(translations).where(where).get() : db.select({ n: count() }).from(translations).get()
      const total = Number(totalRow?.n || 0)

      const orderBy =
        sort === 'hits'
          ? order === 'asc'
            ? asc(translations.hitCount)
            : desc(translations.hitCount)
          : order === 'asc'
            ? asc(translations.updatedAt)
            : desc(translations.updatedAt)

      const base = db.select().from(translations)
      const filtered = where ? base.where(where) : base
      const rows = filtered.orderBy(orderBy, asc(translations.src)).limit(pageSize).offset(offset).all()

      return {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        q,
        engine,
        nsfw: nsfwOnly,
        sort,
        order,
        engines,
        items: rows.map((r) => ({
          src: String(r.src),
          zh: String(r.zh),
          engine: r.engine == null ? null : String(r.engine),
          updatedAt: Number(r.updatedAt) || 0,
          hitCount: Number(r.hitCount) || 0,
          nsfw: Number(r.nsfw) === 1,
        })),
      }
    },

    upsertMany(pairs: Array<[string, string]>, engine = 'pipeline') {
      if (!pairs.length) return 0
      const now = Date.now()
      let n = 0
      db.transaction((tx) => {
        for (const [src, zh] of pairs) {
          if (!src || zh == null || zh === '') continue
          const s = String(src)
          const t = String(zh)
          if (!isStorableTranslation(s, t)) continue
          tx.insert(translations)
            .values({ src: s, zh: t, engine, updatedAt: now, hitCount: 0, nsfw: nsfwBit(s, engine) })
            .onConflictDoUpdate({
              target: translations.src,
              set: {
                zh: sql`excluded.zh`,
                engine: sql`excluded.engine`,
                updatedAt: sql`excluded.updated_at`,
                hitCount: sql`${translations.hitCount} + 1`,
                nsfw: sql`excluded.nsfw`,
              },
            })
            .run()
          n += 1
        }
      })
      return n
    },

    importIgnoreExisting(map: Record<string, string>, engine = 'import') {
      const now = Date.now()
      const entries = Object.entries(map || {})
      if (!entries.length) return { inserted: 0, total: 0 }
      let inserted = 0
      db.transaction((tx) => {
        for (const [src, zh] of entries) {
          if (!src || zh == null || zh === '') continue
          const s = String(src)
          const t = String(zh)
          if (!isStorableTranslation(s, t)) continue
          const result = tx
            .insert(translations)
            .values({ src: s, zh: t, engine, updatedAt: now, hitCount: 0, nsfw: nsfwBit(s, engine) })
            .onConflictDoNothing({ target: translations.src })
            .run()
          if (Number(result.changes || 0) > 0) inserted += 1
        }
      })
      return { inserted, total: entries.length }
    },

    update(src: string, zh: string, engine = 'manual'): boolean {
      const s = String(src ?? '')
      const t = String(zh ?? '').trim()
      if (!isStorableTranslation(s, t)) return false
      if (!db.select({ src: translations.src }).from(translations).where(eq(translations.src, s)).get()) return false
      const result = db
        .update(translations)
        .set({ zh: t, engine, updatedAt: Date.now(), nsfw: nsfwBit(s, engine) })
        .where(eq(translations.src, s))
        .run()
      return Number(result.changes || 0) > 0
    },

    remove(src: string): boolean {
      const s = String(src ?? '')
      if (!s) return false
      const result = db.delete(translations).where(eq(translations.src, s)).run()
      return Number(result.changes || 0) > 0
    },

    scrubDirty(): ScrubDirtyResult {
      const rows = db.select().from(translations).all()
      if (!rows.length) return { removed: 0, rewritten: 0 }

      let removed = 0
      let rewritten = 0
      const now = Date.now()

      db.transaction((tx) => {
        for (const row of rows) {
          const src = String(row.src)
          const zh = String(row.zh)
          const engine = row.engine == null ? null : String(row.engine)
          const hits = Number(row.hitCount) || 0

          if (engine === 'skip:control' || engine === 'skip:sensitive') {
            tx.delete(translations).where(eq(translations.src, src)).run()
            removed += 1
            continue
          }

          if (isIdenticalTranslation(src, zh)) {
            tx.delete(translations).where(eq(translations.src, src)).run()
            removed += 1
            continue
          }

          const srcShell = peelControlShell(src)
          const zhShell = peelControlShell(zh)
          const srcHasShell = Boolean(srcShell.lead || srcShell.trail)
          const zhHasShell = Boolean(zhShell.lead || zhShell.trail)
          if (!srcHasShell && !zhHasShell) continue

          const coreKey = (srcHasShell ? srcShell.core : src).trim()
          const zhCore = (zhShell.core || zh).trim()

          if (!coreKey || !zhCore || isIdenticalTranslation(coreKey, zhCore)) {
            tx.delete(translations).where(eq(translations.src, src)).run()
            removed += 1
            continue
          }

          if (coreKey === src) {
            if (zhCore !== zh) {
              tx.update(translations)
                .set({ zh: zhCore, engine: engine || 'scrub', updatedAt: now, nsfw: nsfwBit(src, engine) })
                .where(eq(translations.src, src))
                .run()
              rewritten += 1
            }
            continue
          }

          const existing = tx.select({ zh: translations.zh }).from(translations).where(eq(translations.src, coreKey)).get()
          if (existing) {
            tx.delete(translations).where(eq(translations.src, src)).run()
            removed += 1
            continue
          }

          tx.insert(translations)
            .values({
              src: coreKey,
              zh: zhCore,
              engine: engine || 'scrub',
              updatedAt: now,
              hitCount: hits,
              nsfw: nsfwBit(coreKey, engine),
            })
            .onConflictDoUpdate({
              target: translations.src,
              set: {
                zh: sql`excluded.zh`,
                engine: sql`excluded.engine`,
                updatedAt: sql`excluded.updated_at`,
                hitCount: sql`MAX(${translations.hitCount}, excluded.hit_count)`,
                nsfw: sql`excluded.nsfw`,
              },
            })
            .run()
          tx.delete(translations).where(eq(translations.src, src)).run()
          rewritten += 1
        }
      })

      return { removed, rewritten }
    },

    stats() {
      const n = Number(db.select({ n: count() }).from(translations).get()?.n || 0)
      let sizeBytes = 0
      try {
        sizeBytes = fs.statSync(resolved).size
      } catch {
        /* */
      }
      return { entries: n, sizeBytes, file: resolved }
    },

    close() {
      db.$client.close()
    },
  }

  if (!scrubbedDbPaths.has(resolved)) {
    try {
      cache.scrubDirty()
    } catch {
      /* 清理失败不挡读写 */
    }
    scrubbedDbPaths.add(resolved)
  }

  return cache
}

export type SharedCache = ReturnType<typeof openSharedCache>

/** 测试用：允许再次 scrub 同一路径 */
export function resetSharedCacheScrubGuardForTests() {
  scrubbedDbPaths.clear()
}
