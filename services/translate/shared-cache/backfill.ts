import fs from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

import { ensureGameContentDir } from '@/lib/game/content-files'
import { appendCacheLines, lockCacheFile } from '@/lib/translate/cache-file-lock'
import { resolveCacheLangPair } from '@/lib/translate/cache-lang'
import { applyCacheRow, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'
import { appendPublicCacheFile } from '@/services/storage/game-files'

import { getGameCacheContext, noteGameSharedBackfill } from '../game-cache-context'
import { gameTranslationFiles } from '../game-records'
import { createGameProjections } from './game-projections'
import type { IndexedRecord, MatchIndex } from './match-index'

type BackfillSnapshot = { stamp: string; rows: Map<string, CacheRow>; seen: Set<string> }
const fileSnapshots = new Map<string, BackfillSnapshot>()
function fileStamp(file: string) {
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  return JSON.stringify([stat?.ino, stat?.size, stat?.mtimeMs, stat?.ctimeMs])
}
function readBackfillSnapshot(file: string): BackfillSnapshot {
  const stamp = fileStamp(file)
  const rows = new Map<string, CacheRow>(),
    seen = new Set<string>()
  for (const line of (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n')) {
    try {
      const row = parseCacheRow(JSON.parse(line))
      if (row) {
        applyCacheRow(rows, row)
        if (row.event) seen.add(row.event)
      }
    } catch {
      /* Recover incomplete tails during append. */
    }
  }
  return { stamp, rows, seen }
}
function backfillSnapshot(file: string) {
  const stamp = fileStamp(file)
  const previous = fileSnapshots.get(file)
  if (previous?.stamp === stamp) return previous
  const snapshot = readBackfillSnapshot(file)
  if (fileSnapshots.size >= 4 && !fileSnapshots.has(file)) fileSnapshots.delete(fileSnapshots.keys().next().value!)
  fileSnapshots.set(file, snapshot)
  return snapshot
}

/** A flush is owned only when every changed row and every new event came from this batch. */
function ownedSharedAppend(file: string, before: BackfillSnapshot, events: CacheRow[]): boolean {
  if (!events.length) return false
  // The snapshot may be stale after another writer appended under the same mtime
  // tick. Re-read it instead of accepting a cached snapshot by stamp alone.
  const after = readBackfillSnapshot(file)
  const expected = new Map(events.map((event) => [event.s, event]))
  const changed = new Set<string>()
  for (const src of new Set([...before.rows.keys(), ...after.rows.keys()])) {
    if (JSON.stringify(before.rows.get(src)) !== JSON.stringify(after.rows.get(src))) changed.add(src)
  }
  if (changed.size !== expected.size || [...expected.keys()].some((src) => !changed.has(src))) return false
  for (const [src, event] of expected) {
    if (!changed.has(src)) return false
    const row = after.rows.get(src)
    if (
      !row ||
      row.s !== event.s ||
      row.t !== event.t ||
      row.engine !== event.engine ||
      row.event !== event.event ||
      row.origin?.id !== event.origin?.id ||
      row.origin?.revision !== event.origin?.revision ||
      row.origin?.database !== event.origin?.database
    )
      return false
  }
  const expectedEvents = new Set(events.map((event) => event.event))
  for (const event of after.seen) if (!before.seen.has(event) && !expectedEvents.has(event)) return false
  fileSnapshots.set(file, after)
  return true
}

/** Recover an incomplete append before writing the next complete event. */
export function appendCacheEvents(file: string, events: CacheRow[]): void {
  if (appendPublicCacheFile(file, events)) return
  appendCacheLines(fs, file, events)
}

export function createGameBackfill(client: DatabaseSync, index: MatchIndex, database: string) {
  const projections = createGameProjections(client, index, database)
  client.exec(`CREATE TABLE IF NOT EXISTS game_backfills (root TEXT NOT NULL,src TEXT NOT NULL,record_id INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(root,src));
    CREATE TABLE IF NOT EXISTS game_backfill_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,root TEXT NOT NULL,src TEXT NOT NULL,record_id INTEGER NOT NULL,revision INTEGER NOT NULL);`)
  function selected(src: string, recordId: number) {
    const pair = client.prepare('SELECT src_lang,tgt_lang FROM translation_records WHERE id=?').get(recordId) as { src_lang: string; tgt_lang: string } | undefined
    return index.record(src, pair ? ({ from: pair.src_lang, to: pair.tgt_lang } as import('@/lib/translate/cache-lang').CacheLangPair) : resolveCacheLangPair({ src, to: 'zh' }))
  }
  const staleLink = `NOT EXISTS (
    SELECT 1 FROM translation_records r JOIN selected_translations t ON t.id=r.translation_id
    WHERE r.id=b.record_id AND r.revision=b.revision
  )`
  function meta(record: IndexedRecord): Pick<CacheRow, 'alignments' | 'newlines' | 'structure'> {
    return { alignments: record.alignments, newlines: record.newlines, structure: record.structure }
  }
  return {
    roots() {
      return (client.prepare('SELECT root FROM game_projections UNION SELECT root FROM game_backfills').all() as Array<{ root: string }>).map((row) => row.root)
    },
    queueProjections: projections.queue,
    queue(root: string, records: IndexedRecord[]) {
      if (!records.length) return
      client.exec('BEGIN IMMEDIATE')
      try {
        for (const r of records) {
          // Skip origins already mirrored at the same revision, and revisions whose
          // outbox entry is already queued. This keeps replay idempotent without
          // minting a new task for a revision that was deleted and later recreated.
          client
            .prepare(
              `INSERT INTO game_backfill_tasks(root,src,record_id,revision)
               SELECT ?,?,?,? WHERE NOT EXISTS (
                 SELECT 1 FROM game_backfill_tasks WHERE root=? AND src=? AND record_id=? AND revision=?
               ) AND NOT EXISTS (
                 SELECT 1 FROM game_backfills WHERE root=? AND src=? AND record_id=? AND revision=?
               ) AND NOT EXISTS (
                 SELECT 1 FROM translation_outbox WHERE record_id=? AND revision=?
               )`
            )
            .run(root, r.src, r.id, r.revision, root, r.src, r.id, r.revision, root, r.src, r.id, r.revision, r.id, r.revision)
        }
        client.exec('COMMIT')
      } catch (e) {
        client.exec('ROLLBACK')
        throw e
      }
    },
    flush(root: string, opts?: { projectionBudgetMs?: number }): { sharedOnly: boolean; pending?: boolean } {
      // Most batch starts have no work. Do not read and parse the whole game file to discover that.
      const pending = client.prepare('SELECT 1 FROM game_backfill_tasks WHERE root=? LIMIT 1').get(root)
      const stale = client.prepare(`SELECT 1 FROM game_backfills b WHERE b.root=? AND ${staleLink} LIMIT 1`).get(root)
      if (!pending && !stale && !projections.pending(root)) return { sharedOnly: false }
      const file = ensureGameContentDir(root, 'cacheNdjson')
      const release = lockCacheFile(fs, file)
      try {
        const filesBefore = gameTranslationFiles(root)
        const previousStamp = filesBefore.stamp
        const snapshot = backfillSnapshot(file)
        const context = getGameCacheContext(root)
        const rows = new Map(snapshot.rows),
          seen = new Set(snapshot.seen)
        const events: CacheRow[] = []
        const acknowledgements: Array<() => void> = []
        const tasks = client.prepare('SELECT * FROM game_backfill_tasks WHERE root=? ORDER BY id').all(root) as Array<{
          id: number
          src: string
          record_id: number
          revision: number
        }>
        for (const task of tasks) {
          // Selection belongs to the backfill consumer, never the append transaction.
          const record = selected(task.src, task.record_id)
          const event = record ? `${database}:fill:${record.id}:${record.revision}` : ''
          if (record && !context.blocked(task.src) && context.lookup[task.src] == null && !seen.has(event)) {
            const value: CacheRow = {
              s: task.src,
              t: record.zh,
              engine: record.engine ?? undefined,
              origin: { id: record.id!, revision: record.revision!, database },
              event,
              ...meta(record),
            }
            const old = rows.get(task.src)
            if (!old || old.origin) {
              events.push(value)
              applyCacheRow(rows, value)
              seen.add(event)
            }
          }
          acknowledgements.push(() => {
            if (record) client.prepare('INSERT OR REPLACE INTO game_backfills VALUES(?,?,?,?)').run(root, task.src, record.id!, record.revision!)
            client.prepare('DELETE FROM game_backfill_tasks WHERE id=?').run(task.id)
          })
        }
        const links = client.prepare(`SELECT b.* FROM game_backfills b WHERE b.root=? AND ${staleLink}`).all(root) as Array<{ src: string; record_id: number; revision: number }>
        for (const link of links) {
          const old = rows.get(link.src)
          if (!old?.origin || old.origin.database !== database || old.origin.id !== String(link.record_id)) {
            acknowledgements.push(() => {
              client.prepare('DELETE FROM game_backfills WHERE root=? AND src=? AND record_id=?').run(root, link.src, link.record_id)
            })
            continue
          }
          const record = selected(link.src, link.record_id)
          if (record?.id === old.origin.id && record.revision === old.origin.revision) continue
          const revision = record?.revision || link.revision + 1
          const value: CacheRow = {
            s: link.src,
            t: record?.zh ?? null,
            engine: record?.engine ?? undefined,
            origin: { id: record?.id || String(link.record_id), revision, database },
            event: `${database}:refresh:${link.record_id}:${link.revision}:${record?.id || 'deleted'}:${revision}`,
            ...(record ? meta(record) : {}),
          }
          if (!seen.has(value.event!)) {
            events.push(value)
            applyCacheRow(rows, value)
            seen.add(value.event!)
          }
          acknowledgements.push(() => {
            if (record) client.prepare('INSERT OR REPLACE INTO game_backfills VALUES(?,?,?,?)').run(root, link.src, record.id!, record.revision!)
            else client.prepare('DELETE FROM game_backfills WHERE root=? AND src=? AND record_id=?').run(root, link.src, link.record_id)
          })
        }
        const projected = projections.collect(root, rows, opts?.projectionBudgetMs)
        events.push(...projected.events)
        acknowledgements.push(...projected.acknowledge)
        for (let offset = 0; offset < events.length; offset += 500) appendCacheEvents(file, events.slice(offset, offset + 500))
        client.exec('BEGIN IMMEDIATE')
        try {
          for (const acknowledge of acknowledgements) acknowledge()
          client.exec(
            'DELETE FROM translation_outbox WHERE NOT EXISTS (SELECT 1 FROM game_backfills l WHERE l.record_id=translation_outbox.record_id AND l.revision<translation_outbox.revision)'
          )
          client.exec('COMMIT')
        } catch (error) {
          client.exec('ROLLBACK')
          throw error
        }
        const filesAfter = gameTranslationFiles(root)
        const sameSeedAndFallback = JSON.stringify(filesBefore.seed) === JSON.stringify(filesAfter.seed) && (filesBefore.cache == null || filesBefore.cache === filesAfter.cache)
        const sharedOnly = sameSeedAndFallback && ownedSharedAppend(file, snapshot, events) && noteGameSharedBackfill(root, previousStamp)
        return { sharedOnly, pending: projected.pending }
      } finally {
        release()
      }
    },
  }
}
