/** Shared translation cache for all games, backed by SQLite and Drizzle. The default path is TRANSLATE_CACHE_DB_PATH from @/constants. */
import fs from 'node:fs'

import { and, asc, count, desc, eq, isNotNull, ne, sql } from 'drizzle-orm'

import {
  CACHE_ENGINE_KINDS,
  type CacheEngineKind,
  cacheEngineKind,
  type CacheLiveFlag,
  type CacheNsfwFlag,
  parseCacheLiveFlag,
  parseCacheNsfwFlag,
} from '@/lib/translate/cache-engine-kind'
import {
  type CacheLang,
  type CacheLangPair,
  DEFAULT_CACHE_SRC_LANG,
  DEFAULT_CACHE_TGT_LANG,
  normalizeCacheLang,
  parseCacheLang,
  resolveCacheLangPair,
} from '@/lib/translate/cache-lang'
import { parseSharedCacheSortDir, parseSharedCacheSortKey, type SharedCacheSortDir, type SharedCacheSortKey } from '@/lib/translate/cache-query'
import { normalizeTranslateKey } from '@/lib/translate/lookup'
import { isNsfwCacheRow } from '@/services/translate/sensitive-text'
import { isIdenticalTranslation, isReusableTranslation, isStorableTranslation } from '@/services/translate/text-classify'

import { createGameBackfill } from './backfill'
import { confirmRecordSegments } from './confirm-segments'
import { defaultSharedDbPath, openSharedCacheDb } from './db'
import { createMatchIndex } from './match-index'
import { translations } from './schema'
import { writeCachePairs } from './write-pairs'

export { defaultSharedDbPath, defaultSharedDir } from './db'
export { cacheMeta, sharedCacheSchema, translations } from './schema'
export type { CacheLang, CacheLangPair } from '@/lib/translate/cache-lang'
export type { SharedCacheSortDir, SharedCacheSortKey } from '@/lib/translate/cache-query'
export { parseSharedCacheSortDir, parseSharedCacheSortKey } from '@/lib/translate/cache-query'

export type SharedCacheListOpts = {
  page?: number
  pageSize?: number
  q?: string
  /** Kind (import, agent, google, bing) or an exact stored engine tag. Empty includes every row. */
  engine?: string
  /** When true, include only NSFW rows. `nsfwFlag` also selects safe rows. */
  nsfw?: boolean
  /** nsfw or safe. Empty includes every row. */
  nsfwFlag?: string
  /** live or stored. Empty includes every row. Combined with the NSFW filter. */
  live?: string
  /** Source language filter. Empty includes every row. */
  from?: string
  /** Target language filter. Empty includes every row. */
  to?: string
  sort?: SharedCacheSortKey
  order?: SharedCacheSortDir
}

export type ScrubDirtyResult = { removed: number; rewritten: number }

/** Scrub each database path once per process to avoid a full scan on every API call. */
const scrubbedDbPaths = new Set<string>()

function nsfwBit(src: string, engine?: string | null): 0 | 1 {
  return isNsfwCacheRow(src, engine) ? 1 : 0
}

function escapeLike(q: string) {
  return String(q).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function engineKindSql(kind: CacheEngineKind) {
  if (kind === 'google') return sql`${translations.engine} LIKE '%google%' ESCAPE '\\'`
  if (kind === 'bing') return sql`${translations.engine} LIKE '%bing%' ESCAPE '\\'`
  if (kind === 'import') return sql`${translations.engine} LIKE 'import%' ESCAPE '\\'`
  return sql`((${translations.engine} LIKE '%agent%' ESCAPE '\\' OR ${translations.engine} LIKE '%ollama%' ESCAPE '\\') AND ${translations.engine} NOT LIKE '%google%' ESCAPE '\\' AND ${translations.engine} NOT LIKE '%bing%' ESCAPE '\\')`
}

function nsfwFlagSql(flag: CacheNsfwFlag) {
  return eq(translations.nsfw, flag === 'nsfw' ? 1 : 0)
}

function liveFlagSql(flag: CacheLiveFlag) {
  if (flag === 'live') return sql`${translations.engine} LIKE 'live:%' ESCAPE '\\'`
  return sql`(${translations.engine} IS NULL OR ${translations.engine} NOT LIKE 'live:%' ESCAPE '\\')`
}

function rowWhere(src: string, from: CacheLang, to: CacheLang) {
  return and(eq(translations.src, src), eq(translations.srcLang, from), eq(translations.tgtLang, to))
}

function listFilter(opts: { q?: string; engine?: string; nsfwFlag?: CacheNsfwFlag | ''; live?: CacheLiveFlag | ''; from?: CacheLang | ''; to?: CacheLang | '' }) {
  const parts = []
  const q = String(opts.q || '').trim()
  const engine = String(opts.engine || '').trim()
  if (q) {
    const like = `%${escapeLike(q)}%`
    parts.push(sql`(${translations.src} LIKE ${like} ESCAPE '\\' OR ${translations.zh} LIKE ${like} ESCAPE '\\')`)
  }
  const kind = cacheEngineKind(engine)
  if (kind && (CACHE_ENGINE_KINDS as readonly string[]).includes(engine)) parts.push(engineKindSql(kind))
  else if (engine) parts.push(eq(translations.engine, engine))
  if (opts.nsfwFlag) parts.push(nsfwFlagSql(opts.nsfwFlag))
  if (opts.live) parts.push(liveFlagSql(opts.live))
  // Language pair is bidirectional: A⇄B matches both A→B and B→A.
  if (opts.from && opts.to) {
    parts.push(
      sql`((${translations.srcLang} = ${opts.from} AND ${translations.tgtLang} = ${opts.to}) OR (${translations.srcLang} = ${opts.to} AND ${translations.tgtLang} = ${opts.from}))`
    )
  } else if (opts.from) {
    parts.push(eq(translations.srcLang, opts.from))
  } else if (opts.to) {
    parts.push(eq(translations.tgtLang, opts.to))
  }
  return parts.length ? and(...parts) : undefined
}

function defaultPair(opts?: Partial<CacheLangPair>): CacheLangPair {
  return {
    from: normalizeCacheLang(opts?.from, DEFAULT_CACHE_SRC_LANG),
    to: normalizeCacheLang(opts?.to, DEFAULT_CACHE_TGT_LANG),
  }
}

/** True when src/zh are the same after NFKC / quote-noise normalize — must not live in shared cache. */
function isSharedIdenticalPair(src: string, tgt: string): boolean {
  if (isIdenticalTranslation(src, tgt)) return true
  const a = normalizeTranslateKey(src)
  const b = normalizeTranslateKey(tgt)
  return Boolean(a) && isIdenticalTranslation(a, b)
}

/**
 * Shared cache must not store 原文===译文 labels (好感度→好感度); those belong in the game ndjson only.
 * Chinese targets use storable rules; other targets only need a non-identical pair.
 */
function canStorePair(src: string, tgt: string, _engine: string, to: CacheLang): boolean {
  if (isSharedIdenticalPair(src, tgt)) return false
  if (to === 'zh') return isStorableTranslation(src, tgt)
  return Boolean(String(src).trim() && String(tgt).trim())
}

function rowUsable(src: string, tgt: string, to: CacheLang): boolean {
  if (to === 'zh') return isReusableTranslation(src, tgt)
  return Boolean(String(src).trim() && String(tgt).trim())
}

export function openSharedCache(dbPath = defaultSharedDbPath()) {
  const { db, path: resolved } = openSharedCacheDb(dbPath)
  const index = createMatchIndex(db.$client)
  const backfill = createGameBackfill(db.$client, index, resolved)

  const cache = {
    path: resolved,
    plan: index.plan,
    queueBackfill: backfill.queue,
    flushBackfill: backfill.flush,
    record: index.record,
    current: index.current,
    version: index.version,
    setAlignment: index.setAlignment,
    confirmSegments(parent: { src: string; zh: string }, pairs: Array<[string, string]>, pair: CacheLangPair, opts?: import('./confirm-segments').ConfirmSegmentsOptions) {
      return confirmRecordSegments(index, parent, pairs, pair, opts)
    },
    writeMany(pairs: Array<[string, string]>, engine = 'pipeline', pairOpts?: Partial<CacheLangPair>) {
      return writeCachePairs(db.$client, index, pairs, engine, pairOpts, canStorePair, nsfwBit)
    },

    loadAll(pairOpts?: Partial<CacheLangPair>): Record<string, string> {
      const pair = defaultPair(pairOpts)
      const out: Record<string, string> = Object.create(null)
      for (const row of db
        .select({ src: translations.src, zh: translations.zh })
        .from(translations)
        .where(and(eq(translations.srcLang, pair.from), eq(translations.tgtLang, pair.to)))
        .all()) {
        if (rowUsable(String(row.src), String(row.zh), pair.to)) out[String(row.src)] = String(row.zh)
      }
      return out
    },

    get(src: string, pairOpts?: Partial<CacheLangPair>) {
      const pair = defaultPair(pairOpts)
      const row = index.authority(src, pair)
      // Deliberately no whitespace/coverage fallback in exact getters.
      return row && rowUsable(src, row.zh, pair.to) && (row.src === src || row.engine === 'manual') ? row.zh : null
    },

    getMany(keys: string[], pairOpts?: Partial<CacheLangPair>): Map<string, string> {
      const out = new Map<string, string>()
      for (const key of new Set(keys)) {
        const hit = cache.get(key, pairOpts)
        if (hit != null) out.set(key, hit)
      }
      return out
    },

    listPage(opts: SharedCacheListOpts = {}) {
      const pageSize = Math.min(200, Math.max(1, Number(opts.pageSize) || 50))
      const requestedPage = Math.max(1, Math.floor(Number(opts.page) || 1))
      const q = String(opts.q || '').trim()
      const engine = String(opts.engine || '').trim()
      const nsfwFlag = parseCacheNsfwFlag(opts.nsfwFlag) || (opts.nsfw ? 'nsfw' : '')
      const live = parseCacheLiveFlag(opts.live)
      const from = parseCacheLang(opts.from)
      const to = parseCacheLang(opts.to)
      const sort = parseSharedCacheSortKey(opts.sort)
      const order = parseSharedCacheSortDir(opts.order)
      const where = listFilter({ q, engine, nsfwFlag, live, from, to })

      const present = new Set<CacheEngineKind>()
      for (const row of db
        .selectDistinct({ engine: translations.engine })
        .from(translations)
        .where(and(isNotNull(translations.engine), ne(translations.engine, '')))
        .all()) {
        const kind = cacheEngineKind(row.engine)
        if (kind) present.add(kind)
      }
      const engines = CACHE_ENGINE_KINDS.filter((kind) => present.has(kind))

      const totalRow = where ? db.select({ n: count() }).from(translations).where(where).get() : db.select({ n: count() }).from(translations).get()
      const total = Number(totalRow?.n || 0)
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const page = Math.min(requestedPage, totalPages)
      const offset = (page - 1) * pageSize

      const orderBy =
        sort === 'hits'
          ? order === 'asc'
            ? asc(translations.hitCount)
            : desc(translations.hitCount)
          : order === 'asc'
            ? asc(translations.updatedAt)
            : desc(translations.updatedAt)

      const rowSelect = {
        id: sql<number>`rowid`.mapWith(Number),
        src: translations.src,
        zh: translations.zh,
        srcLang: translations.srcLang,
        tgtLang: translations.tgtLang,
        engine: translations.engine,
        updatedAt: translations.updatedAt,
        hitCount: translations.hitCount,
        nsfw: translations.nsfw,
      }
      const base = db.select(rowSelect).from(translations)
      const filtered = where ? base.where(where) : base
      const rows = filtered.orderBy(orderBy, asc(translations.src)).limit(pageSize).offset(offset).all()

      return {
        page,
        pageSize,
        total,
        totalPages,
        q,
        engine,
        nsfw: nsfwFlag === 'nsfw',
        nsfwFlag,
        live,
        from,
        to,
        sort,
        order,
        engines,
        items: rows.map((r) => ({
          id: Number(r.id) || 0,
          src: String(r.src),
          zh: String(r.zh),
          from: normalizeCacheLang(r.srcLang, DEFAULT_CACHE_SRC_LANG),
          to: normalizeCacheLang(r.tgtLang, DEFAULT_CACHE_TGT_LANG),
          engine: r.engine == null ? null : String(r.engine),
          updatedAt: Number(r.updatedAt) || 0,
          hitCount: Number(r.hitCount) || 0,
          nsfw: Number(r.nsfw) === 1,
        })),
      }
    },

    /** SQLite rowid lookup for short optimize URLs. */
    getById(id: number) {
      const n = Math.floor(Number(id) || 0)
      if (n <= 0) return null
      const row = db
        .select({
          id: sql<number>`rowid`.mapWith(Number),
          src: translations.src,
          zh: translations.zh,
          srcLang: translations.srcLang,
          tgtLang: translations.tgtLang,
          engine: translations.engine,
          updatedAt: translations.updatedAt,
          hitCount: translations.hitCount,
          nsfw: translations.nsfw,
        })
        .from(translations)
        .where(sql`rowid = ${n}`)
        .get()
      if (!row) return null
      return {
        id: Number(row.id) || n,
        src: String(row.src),
        zh: String(row.zh),
        from: normalizeCacheLang(row.srcLang, DEFAULT_CACHE_SRC_LANG),
        to: normalizeCacheLang(row.tgtLang, DEFAULT_CACHE_TGT_LANG),
        engine: row.engine == null ? null : String(row.engine),
        updatedAt: Number(row.updatedAt) || 0,
        hitCount: Number(row.hitCount) || 0,
        nsfw: Number(row.nsfw) === 1,
      }
    },

    /** Compatibility count; callers needing accepted pairs must use writeMany. */
    upsertMany(pairs: Array<[string, string]>, engine = 'pipeline', pairOpts?: Partial<CacheLangPair>) {
      return cache.writeMany(pairs, engine, pairOpts).accepted.length
    },

    /** Legacy explicit-pair compatibility; the graph UI now confirms parent mappings via confirmSegments. */
    upsertOptimizeMany(pairs: Array<[string, string]>, engine = 'manual:optimize', pairOpts?: Partial<CacheLangPair>) {
      const stats = {
        inserted: 0,
        identical: 0,
        conflict: 0,
        skipped: 0,
        total: 0,
        localOnly: [] as Array<[string, string]>,
      }
      if (!pairs.length) return stats
      for (const [src, zh] of pairs) {
        if (!src || !zh?.trim()) continue
        stats.total++
        if (isSharedIdenticalPair(src, zh)) {
          stats.localOnly.push([src, zh])
          continue
        }
        const pair = resolveCacheLangPair({ ...pairOpts, src })
        const existing = index.authority(src, pair)
        if (existing?.zh === zh) {
          stats.identical++
          continue
        }
        const written = cache.writeMany([[src, zh.trim()]], engine, pair)
        if (written.accepted.length) stats.inserted++
        else if (written.rejected[0]?.reason === 'invalid') stats.skipped++
        else stats.conflict++
      }
      return stats
    },

    importIgnoreExisting(map: Record<string, string>, engine = 'import', pairOpts?: Partial<CacheLangPair>) {
      const entries = Object.entries(map || {})
      let inserted = 0
      for (const [src, zh] of entries) {
        const pair = resolveCacheLangPair({ ...pairOpts, src })
        if (index.record(src, pair)) continue
        inserted += cache.writeMany([[src, zh]], engine, pair).accepted.length
      }
      return { inserted, total: entries.length }
    },

    update(src: string, zh: string, engine = 'manual', pairOpts?: Partial<CacheLangPair>, opts?: { nsfw?: boolean }): boolean {
      const s = String(src ?? '')
      const t = String(zh ?? '').trim()
      const pair = resolveCacheLangPair({ ...pairOpts, src: s })
      if (!canStorePair(s, t, engine, pair.to)) return false
      const existing = db
        .select({ nsfw: translations.nsfw })
        .from(translations)
        .where(rowWhere(s, pair.from, pair.to))
        .get()
      if (!existing) return false
      const nsfw = typeof opts?.nsfw === 'boolean' ? (opts.nsfw ? 1 : 0) : Math.max(Number(existing.nsfw) === 1 ? 1 : 0, nsfwBit(s, engine))
      const result = cache.writeMany([[s, t]], engine, pair)
      if (result.accepted.length && typeof opts?.nsfw === 'boolean') cache.setNsfw(s, Boolean(nsfw), pair)
      return result.accepted.length > 0
    },

    /** Manual NSFW mark; does not change the translation text. */
    setNsfw(src: string, nsfw: boolean, pairOpts?: Partial<CacheLangPair>): boolean {
      const s = String(src ?? '')
      if (!s) return false
      const pair = defaultPair(pairOpts)
      if (
        !db
          .select({ src: translations.src })
          .from(translations)
          .where(rowWhere(s, pair.from, pair.to))
          .get()
      )
        return false
      const result = db
        .update(translations)
        .set({ nsfw: nsfw ? 1 : 0, updatedAt: Date.now() })
        .where(rowWhere(s, pair.from, pair.to))
        .run()
      return Number(result.changes || 0) > 0
    },

    remove(src: string, pairOpts?: Partial<CacheLangPair>): boolean {
      const s = String(src ?? '')
      if (!s) return false
      const pair = defaultPair(pairOpts)
      const result = db
        .delete(translations)
        .where(rowWhere(s, pair.from, pair.to))
        .run()
      return Number(result.changes || 0) > 0
    },

    scrubDirty(): ScrubDirtyResult {
      const rows = db.select().from(translations).all()
      if (!rows.length) return { removed: 0, rewritten: 0 }

      let removed = 0
      const rewritten = 0

      db.transaction((tx) => {
        for (const row of rows) {
          const src = String(row.src)
          const zh = String(row.zh)
          const from = normalizeCacheLang(row.srcLang, DEFAULT_CACHE_SRC_LANG)
          const to = normalizeCacheLang(row.tgtLang, DEFAULT_CACHE_TGT_LANG)
          const engine = row.engine == null ? null : String(row.engine)
          const where = rowWhere(src, from, to)

          if (engine === 'skip:control' || engine === 'skip:sensitive') {
            tx.delete(translations).where(where).run()
            removed += 1
            continue
          }

          // Shared cache policy: never keep 原文===译文 (incl. quote-noise / NFKC); those belong in per-game ndjson.
          if (isSharedIdenticalPair(src, zh)) {
            tx.delete(translations).where(where).run()
            removed += 1
            continue
          }

          // Preserve original source/translation and punctuation. Aliases belong in match indexes.
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

/** Allow tests to scrub the same database path again. */
export function resetSharedCacheScrubGuardForTests() {
  scrubbedDbPaths.clear()
}
