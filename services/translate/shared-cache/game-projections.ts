import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import type { CacheLangPair } from '@/lib/translate/cache-lang'
import type { CacheRow } from '@/lib/translate/cache-row'
import { SENTENCE_RULE_VERSION } from '@/lib/translate/sentence-units'

import { getGameCacheContext } from '../game-cache-context'
import { planGameCache } from '../game-cache-plan'
import type { MatchIndex } from './match-index'

export type GameProjectionSource = { src: string; pair: CacheLangPair }
type Projection = { src: string; src_lang: string; tgt_lang: string; signature: string; revision: number }

/** These rows are runtime views, never candidates in the authoritative translation corpus. */
export function createGameProjections(client: DatabaseSync, index: MatchIndex, database: string) {
  client.exec(`CREATE TABLE IF NOT EXISTS game_projections (
    root TEXT NOT NULL, src TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL,
    signature TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(root,src,src_lang,tgt_lang))`)
  const originDatabase = `${database}:game-projection`
  function signature(root: string) {
    return JSON.stringify([SENTENCE_RULE_VERSION, index.version(), getGameCacheContext(root).authorityVersion])
  }
  return {
    queue(root: string, sources: GameProjectionSource[]) {
      const insert = client.prepare(`INSERT INTO game_projections(root,src,src_lang,tgt_lang) VALUES(?,?,?,?)
        ON CONFLICT(root,src,src_lang,tgt_lang) DO UPDATE SET signature=''`)
      for (const { src, pair } of sources) {
        // The game plugin currently consumes Chinese rows. Other pairs must not overwrite them.
        if (!src || pair.to !== 'zh') continue
        // Exact shared rows already have revisioned backfills. Keep projections for composed,
        // restored-control and alias results only (existing projections continue to track overrides).
        if (index.record(src, pair)) continue
        insert.run(root, src, pair.from, pair.to)
      }
    },
    pending(root: string) {
      if (!client.prepare('SELECT 1 FROM game_projections WHERE root=? LIMIT 1').get(root)) return false
      return Boolean(client.prepare('SELECT 1 FROM game_projections WHERE root=? AND signature<>? LIMIT 1').get(root, signature(root)))
    },
    collect(root: string, rows: Map<string, CacheRow>) {
      const context = getGameCacheContext(root)
      const nextSignature = signature(root)
      const pending = client.prepare('SELECT * FROM game_projections WHERE root=? AND signature<>?').all(root, nextSignature) as Projection[]
      const events: CacheRow[] = []
      const acknowledge: Array<() => void> = []
      for (const entry of pending) {
        const pair = { from: entry.src_lang, to: entry.tgt_lang } as CacheLangPair
        const { plan } = planGameCache(entry.src, pair, index, context)
        // Never cache a bounded/ambiguous result as a complete translation.
        const zh = !plan.limited && plan.status === 'full' ? plan.zh : null
        const old = rows.get(entry.src)
        const id = createHash('sha256')
          .update(JSON.stringify([entry.src, pair]))
          .digest('hex')
        const owned = old?.origin?.database === originDatabase && old.origin.id === id
        const revision = entry.revision + 1
        if ((!old || old.origin) && (zh != null ? old?.t !== zh : owned)) {
          events.push({
            s: entry.src,
            t: zh,
            engine: 'derived:sentence',
            origin: { database: originDatabase, id, revision },
            event: `${originDatabase}:${id}:${revision}`,
          })
        }
        // Advance only after the file append succeeds, so a crash is safely replayed.
        acknowledge.push(() => {
          client
            .prepare('UPDATE game_projections SET signature=?,revision=? WHERE root=? AND src=? AND src_lang=? AND tgt_lang=?')
            .run(nextSignature, revision, root, entry.src, entry.src_lang, entry.tgt_lang)
        })
      }
      return { events, acknowledge }
    },
  }
}
