import type { DatabaseSync } from 'node:sqlite'

import { cacheEngineRank } from '@/lib/translate/cache-engine-rank'
import { type CacheLang, type CacheLangPair, detectCacheLang, parseCacheLang } from '@/lib/translate/cache-lang'
import { normalizeCacheCategory } from '@/lib/translate/text-nature'

import type { IndexedRecord, MatchIndex } from './match-index'

export type CacheWriteOpts = Partial<CacheLangPair> & { category?: string | null }

export type CacheWriteResult = { accepted: Array<[string, string]>; records: IndexedRecord[]; rejected: Array<{ src: string; reason: 'rank' | 'conflict' | 'invalid' }> }

/** Append candidates in one transaction. Authority is resolved only by readers. */
export function writeCachePairs(
  client: DatabaseSync,
  index: MatchIndex,
  pairs: Array<[string, string]>,
  engine: string,
  opts: CacheWriteOpts | undefined,
  valid: (s: string, t: string, engine: string, to: CacheLang) => boolean,
  nsfw: (s: string, engine: string) => number
): CacheWriteResult {
  const result: CacheWriteResult = { accepted: [], records: [], rejected: [] }
  if (!pairs.length) return result
  const category = normalizeCacheCategory(opts?.category) || null
  const insert = client.prepare(
    `INSERT INTO translations(src,zh,src_lang,tgt_lang,engine,category,updated_at,hit_count,nsfw,engine_rank)
      VALUES(?,?,?,?,?,?,?,0,?,?) RETURNING id`
  )
  client.exec('BEGIN IMMEDIATE')
  try {
    for (const [src, zh] of pairs) {
      const pair: CacheLangPair = { from: parseCacheLang(opts?.from) || detectCacheLang(src), to: parseCacheLang(opts?.to) || 'zh' }
      if (!src || !zh || !valid(src, zh, engine, pair.to)) {
        result.rejected.push({ src, reason: 'invalid' })
        continue
      }
      const inserted = insert.get(src, zh, pair.from, pair.to, engine, category, Date.now(), nsfw(src, engine), cacheEngineRank(engine)) as { id: number }
      result.accepted.push([src, zh])
      const record = index.inserted(inserted.id)
      if (record) result.records.push(record)
    }
    client.exec('COMMIT')
  } catch (e) {
    client.exec('ROLLBACK')
    throw e
  }
  return result
}
