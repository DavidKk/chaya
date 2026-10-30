/** Shared translation cache for all games, backed by SQLite and Drizzle. The default path is TRANSLATE_CACHE_DB_PATH from @/constants. */
import fs from 'node:fs'
import path from 'node:path'

import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'

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
import { SENTENCE_RULE_VERSION } from '@/lib/translate/sentence-units'
import { categoriesForNature, normalizeCacheCategory, parseTextNature } from '@/lib/translate/text-nature'
import { storageCall } from '@/services/storage/client'
import { getGameCacheContext } from '@/services/translate/game-cache-context'
import { planGameCache } from '@/services/translate/game-cache-plan'
import { gameTranslationFiles } from '@/services/translate/game-records'
import { isNsfwCacheRow } from '@/services/translate/sensitive-text'
import { isIdenticalTranslation, isReusableTranslation, isStorableTranslation } from '@/services/translate/text-classify'

import { createGameBackfill } from './backfill'
import { confirmRecordSegments } from './confirm-segments'
import { defaultSharedDbPath, openSharedCacheDb } from './db'
import { createMatchIndex } from './match-index'
import { cacheMeta, translations } from './schema'
import { writeCachePairs } from './write-pairs'

export { defaultSharedDbPath, defaultSharedDir } from './db'

const PROJECTION_CANDIDATE_RE = /[\s\d０-９,，、。．.!！?？;；\n\r…~～\\<%{]/
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
  /** Coarse nature (dialogue/name/…) or exact category; empty includes every row. */
  nature?: string
  category?: string
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
  if (kind === 'apple') return sql`${translations.engine} LIKE '%apple%' ESCAPE '\\'`
  if (kind === 'bergamot') return sql`${translations.engine} LIKE '%bergamot%' ESCAPE '\\'`
  if (kind === 'import') return sql`${translations.engine} LIKE 'import%' ESCAPE '\\'`
  return sql`((${translations.engine} LIKE '%agent%' ESCAPE '\\' OR ${translations.engine} LIKE '%ollama%' ESCAPE '\\') AND ${translations.engine} NOT LIKE '%google%' ESCAPE '\\' AND ${translations.engine} NOT LIKE '%bing%' ESCAPE '\\' AND ${translations.engine} NOT LIKE '%bergamot%' ESCAPE '\\')`
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

function listFilter(opts: {
  q?: string
  engine?: string
  nsfwFlag?: CacheNsfwFlag | ''
  live?: CacheLiveFlag | ''
  from?: CacheLang | ''
  to?: CacheLang | ''
  nature?: string
  category?: string
}) {
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
  const category = normalizeCacheCategory(opts.category)
  const nature = parseTextNature(opts.nature)
  if (category) {
    parts.push(eq(translations.category, category))
  } else if (nature) {
    parts.push(inArray(translations.category, [...categoriesForNature(nature)]))
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

export function openOwnedSharedCache(dbPath = defaultSharedDbPath()) {
  const { db, path: resolved } = openSharedCacheDb(dbPath)
  const index = createMatchIndex(db.$client)
  const backfill = createGameBackfill(db.$client, index, resolved)

  const cache = {
    path: resolved,
    plan: index.plan,
    numericRecords: index.numericRecords,
    queueBackfill: backfill.queue,
    queueGameProjections: backfill.queueProjections,
    gameCacheRoots: backfill.roots,
    flushBackfill: backfill.flush,
    /** Explicit preparation/launch repair, including entries already counted as complete. No engines. */
    syncGameCache(root: string) {
      const key = `game-projection-sync:${root}`
      const signature = () => JSON.stringify([SENTENCE_RULE_VERSION, index.version(), gameTranslationFiles(root).stamp])
      const startedWith = signature()
      const previous = db.select().from(cacheMeta).where(eq(cacheMeta.key, key)).get()?.value
      if (previous === startedWith) return backfill.flush(root)
      const file = gameTranslationFiles(root).seed
      const seed: unknown = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
      if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new Error('Seed must be an object mapping source text to translation')
      const context = getGameCacheContext(root)
      const records = []
      const sources = []
      for (const src of Object.keys(seed)) {
        if (!src.trim() || context.blocked(src) || context.lookup[src] != null) continue
        const pair = resolveCacheLangPair({ src, to: 'zh' })
        const exact = index.record(src, pair)
        if (exact) records.push(exact)
        else if (PROJECTION_CANDIDATE_RE.test(src)) {
          const { plan } = planGameCache(src, pair, index, context)
          if (!plan.limited && plan.status === 'full') sources.push({ src, pair })
        }
      }
      backfill.queue(root, records)
      backfill.queueProjections(root, sources)
      const result = backfill.flush(root)
      const value = signature()
      // Do not certify a concurrent external edit as repaired by this snapshot.
      if (value === startedWith || result.sharedOnly) db.insert(cacheMeta).values({ key, value }).onConflictDoUpdate({ target: cacheMeta.key, set: { value } }).run()
      return result
    },
    record: index.record,
    candidateRecord: index.inserted,
    current: index.current,
    authority: index.authority,
    version: index.version,
    setAlignment: index.setAlignment,
    confirmSegments(parent: { src: string; zh: string }, pairs: Array<[string, string]>, pair: CacheLangPair, opts?: import('./confirm-segments').ConfirmSegmentsOptions) {
      return confirmRecordSegments(index, parent, pairs, pair, opts)
    },
    writeMany(pairs: Array<[string, string]>, engine = 'pipeline', pairOpts?: import('./write-pairs').CacheWriteOpts) {
      return writeCachePairs(db.$client, index, pairs, engine, pairOpts, canStorePair, nsfwBit)
    },

    loadAll(pairOpts?: Partial<CacheLangPair>): Record<string, string> {
      const pair = defaultPair(pairOpts)
      const out: Record<string, string> = Object.create(null)
      const rows = db.$client.prepare('SELECT src,zh FROM selected_translations WHERE src_lang=? AND tgt_lang=?').all(pair.from, pair.to) as Array<{ src: string; zh: string }>
      for (const row of rows) {
        if (rowUsable(row.src, row.zh, pair.to)) out[row.src] = row.zh
      }
      return out
    },

    get(src: string, pairOpts?: Partial<CacheLangPair> & { category?: string | null }) {
      const pair = defaultPair(pairOpts)
      const row = index.authority(src, pair, { category: pairOpts?.category })
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
      const nature = String(opts.nature || '').trim()
      const category = String(opts.category || '').trim()
      const sort = parseSharedCacheSortKey(opts.sort)
      const order = parseSharedCacheSortDir(opts.order)
      const where = listFilter({ q, engine, nsfwFlag, live, from, to, nature, category })

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
        category: translations.category,
        updatedAt: translations.updatedAt,
        hitCount: translations.hitCount,
        nsfw: translations.nsfw,
      }
      const base = db.select(rowSelect).from(translations)
      const filtered = where ? base.where(where) : base
      const rows = filtered.orderBy(orderBy, asc(translations.src), desc(translations.id)).limit(pageSize).offset(offset).all()

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
        nature,
        category,
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
          category: r.category == null || r.category === '' ? null : String(r.category),
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
          category: translations.category,
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
        category: row.category == null || row.category === '' ? null : String(row.category),
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
      const candidates: Array<[string, string]> = []
      for (const [src, zh] of pairs) {
        if (!src || !zh?.trim()) continue
        stats.total++
        if (isSharedIdenticalPair(src, zh)) {
          stats.localOnly.push([src, zh])
          continue
        }
        candidates.push([src, zh.trim()])
      }
      const written = cache.writeMany(candidates, engine, pairOpts)
      stats.inserted = written.accepted.length
      stats.skipped = written.rejected.length
      return stats
    },

    importIgnoreExisting(map: Record<string, string>, engine = 'import', pairOpts?: Partial<CacheLangPair>) {
      const entries = Object.entries(map || {})
      const inserted = cache.writeMany(entries, engine, pairOpts).accepted.length
      return { inserted, total: entries.length }
    },

    appendManual(src: string, zh: string, engine = 'manual', pairOpts?: Partial<CacheLangPair>, opts?: { nsfw?: boolean }): number | null {
      const s = String(src ?? '')
      const t = String(zh ?? '').trim()
      const pair = resolveCacheLangPair({ ...pairOpts, src: s })
      const result = cache.writeMany([[s, t]], engine, pair)
      const id = result.records[0]?.candidateId
      if (id && typeof opts?.nsfw === 'boolean') cache.setNsfw(s, opts.nsfw, pair, id)
      return id || null
    },

    update(src: string, zh: string, engine = 'manual', pairOpts?: Partial<CacheLangPair>, opts?: { nsfw?: boolean }): boolean {
      return cache.appendManual(src, zh, engine, pairOpts, opts) != null
    },

    /** Manual NSFW mark; does not change the translation text. */
    setNsfw(src: string, nsfw: boolean, pairOpts?: Partial<CacheLangPair>, candidateId?: number): boolean {
      const s = String(src ?? '')
      if (!s) return false
      const pair = defaultPair(pairOpts)
      const result = db
        .update(translations)
        .set({ nsfw: nsfw ? 1 : 0 })
        .where(and(rowWhere(s, pair.from, pair.to), candidateId ? eq(translations.id, candidateId) : undefined))
        .run()
      return Number(result.changes || 0) > 0
    },

    remove(src: string, pairOpts?: Partial<CacheLangPair>, candidateId?: number): boolean {
      const s = String(src ?? '')
      if (!s) return false
      const pair = defaultPair(pairOpts)
      const result = db
        .delete(translations)
        .where(and(rowWhere(s, pair.from, pair.to), candidateId ? eq(translations.id, candidateId) : undefined))
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
          const engine = row.engine == null ? null : String(row.engine)
          const where = eq(translations.id, row.id)

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

  // Scrub + sentence v10 run via scheduleSharedCacheHeavyMigrate (openSharedCacheDb); never sync on open.
  scrubbedDbPaths.add(resolved)

  return cache
}

export function openSharedCache(dbPath = defaultSharedDbPath()): ReturnType<typeof openOwnedSharedCache> {
  // Explicit fixture databases remain independent. Production clients share the one owner.
  if (process.env.NODE_ENV === 'test' || path.resolve(dbPath) !== path.resolve(defaultSharedDbPath()) || process.env.CHAYA_STORAGE_OWNER === '1')
    return openOwnedSharedCache(dbPath)
  return new Proxy({ path: dbPath } as ReturnType<typeof openOwnedSharedCache>, {
    get(target, name) {
      if (name === 'path') return target.path
      if (name === 'close') return () => {}
      if (typeof name !== 'string' || name === 'then') return undefined
      return (...args: unknown[]) => {
        const value = storageCall(`shared.${name}`, args)
        if (name === 'numericRecords') {
          const result = value as { items: unknown[]; limited: boolean }
          return Object.assign(result.items, { limited: result.limited })
        }
        return value
      }
    },
  })
}

export type SharedCache = ReturnType<typeof openOwnedSharedCache>

/** Allow tests to scrub the same database path again. */
export function resetSharedCacheScrubGuardForTests() {
  scrubbedDbPaths.clear()
}
