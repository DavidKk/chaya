import type { DatabaseSync } from 'node:sqlite'

import { cacheEngineRank } from '@/lib/translate/cache-engine-rank'
import { type CacheLang, type CacheLangPair, detectCacheLang, parseCacheLang } from '@/lib/translate/cache-lang'

import type { IndexedRecord, MatchIndex } from './match-index'

export type CacheWriteResult = { accepted: Array<[string, string]>; records: IndexedRecord[]; rejected: Array<{ src: string; reason: 'rank' | 'conflict' | 'invalid' }> }

/** Shared writes are serialized by SQLite; source authority and the write share one transaction. */
export function writeCachePairs(
  client: DatabaseSync,
  index: MatchIndex,
  pairs: Array<[string, string]>,
  engine: string,
  opts: Partial<CacheLangPair> | undefined,
  valid: (s: string, t: string, engine: string, to: CacheLang) => boolean,
  nsfw: (s: string, engine: string) => number
): CacheWriteResult {
  const result: CacheWriteResult = { accepted: [], records: [], rejected: [] }
  if (!pairs.length) return result
  client.exec('BEGIN IMMEDIATE')
  try {
    for (const [src, zh] of pairs) {
      const pair: CacheLangPair = { from: parseCacheLang(opts?.from) || detectCacheLang(src), to: parseCacheLang(opts?.to) || 'zh' }
      if (!src || !zh || !valid(src, zh, engine, pair.to)) {
        result.rejected.push({ src, reason: 'invalid' })
        continue
      }
      const group = index.equivalent(src, pair)
      const rank = cacheEngineRank(engine)
      const higher = group.filter((r) => cacheEngineRank(r.engine) > rank)
      const same = group.filter((r) => r.src !== src && cacheEngineRank(r.engine) === rank && r.zh !== zh)
      if (higher.length) {
        result.rejected.push({ src, reason: 'rank' })
        continue
      }
      if ((same.length && !(engine === 'manual' && group.some((r) => r.src === src))) || group.length > 500) {
        result.rejected.push({ src, reason: 'conflict' })
        continue
      }
      client
        .prepare(
          `INSERT INTO translations(src,zh,src_lang,tgt_lang,engine,updated_at,hit_count,nsfw) VALUES(?,?,?,?,?,?,0,?)
        ON CONFLICT(src,src_lang,tgt_lang) DO UPDATE SET zh=excluded.zh,engine=excluded.engine,updated_at=excluded.updated_at,hit_count=translations.hit_count+1,nsfw=MAX(translations.nsfw,excluded.nsfw)`
        )
        .run(src, zh, pair.from, pair.to, engine, Date.now(), nsfw(src, engine))
      result.accepted.push([src, zh])
      const record = index.record(src, pair)
      if (record) result.records.push(record)
    }
    client.exec('COMMIT')
  } catch (e) {
    client.exec('ROLLBACK')
    throw e
  }
  return result
}
