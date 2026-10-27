import fs from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

import { ensureGameContentDir } from '@/lib/game/content-files'
import { appendCacheLines, lockCacheFile } from '@/lib/translate/cache-file-lock'
import { applyCacheRow, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'
import { appendPublicCacheFile } from '@/services/storage/game-files'

import { noteGameSharedBackfill } from '../game-cache-context'
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
  const joined =
    'SELECT r.src,t.zh,t.engine,r.revision FROM translation_records r JOIN translations t ON t.src=r.src AND t.src_lang=r.src_lang AND t.tgt_lang=r.tgt_lang WHERE r.id=?'
  function rowMeta(recordId: number, revision: number): Pick<CacheRow, 'alignments' | 'newlines' | 'structure'> {
    const alignment = client.prepare('SELECT groups_json FROM alignment_groups WHERE record_id=? AND revision=?').get(recordId, revision) as { groups_json: string } | undefined
    const newlines = client.prepare('SELECT annotations_json FROM newline_annotations WHERE record_id=? AND revision=?').get(recordId, revision) as
      { annotations_json: string } | undefined
    const structure = client.prepare('SELECT annotations_json FROM structure_annotations WHERE record_id=? AND revision=?').get(recordId, revision) as
      { annotations_json: string } | undefined
    return {
      ...(structure ? { structure: JSON.parse(structure.annotations_json) } : {}),
      ...(alignment ? { alignments: JSON.parse(alignment.groups_json) } : {}),
      ...(newlines ? { newlines: JSON.parse(newlines.annotations_json) } : {}),
    }
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
          if (!index.current([r])) continue
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
    flush(root: string): { sharedOnly: boolean } {
      // Most batch starts have no work. Do not read and parse the whole game file to discover that.
      const pending = client.prepare('SELECT 1 FROM game_backfill_tasks WHERE root=? LIMIT 1').get(root)
      const stale = client
        .prepare(
          `SELECT 1 FROM game_backfills b WHERE b.root=? AND NOT EXISTS (
             SELECT 1 FROM translation_records r WHERE r.id=b.record_id AND r.revision=b.revision
           ) LIMIT 1`
        )
        .get(root)
      if (!pending && !stale && !projections.pending(root)) return { sharedOnly: false }
      const file = ensureGameContentDir(root, 'cacheNdjson')
      const release = lockCacheFile(fs, file)
      try {
        const filesBefore = gameTranslationFiles(root)
        const previousStamp = filesBefore.stamp
        const snapshot = backfillSnapshot(file)
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
          // Event identity is the origin (database, recordId, revision), not the
          // auto-increment task id. Reusing the task id would mint a different event
          // for the same origin and defeat `seen` dedupe after a task row is removed.
          const event = `${database}:fill:${task.record_id}:${task.revision}`
          const record = client.prepare(joined).get(task.record_id) as { src: string; zh: string; engine: string; revision: number } | undefined
          if (!seen.has(event) && record?.revision === task.revision) {
            const meta = rowMeta(task.record_id, task.revision)
            const value: CacheRow = {
              s: task.src,
              t: record.zh,
              engine: record.engine,
              origin: { id: String(task.record_id), revision: task.revision, database },
              event,
              ...meta,
            }
            const old = rows.get(task.src)
            if (!old || old.origin) {
              events.push(value)
              applyCacheRow(rows, value)
              seen.add(event)
            }
          }
          acknowledgements.push(() => {
            client.prepare('INSERT OR REPLACE INTO game_backfills VALUES(?,?,?,?)').run(root, task.src, task.record_id, task.revision)
            client.prepare('DELETE FROM game_backfill_tasks WHERE id=?').run(task.id)
          })
        }
        const links = client
          .prepare(
            `SELECT b.* FROM game_backfills b WHERE b.root=? AND NOT EXISTS (
               SELECT 1 FROM translation_records r WHERE r.id=b.record_id AND r.revision=b.revision
             )`
          )
          .all(root) as Array<{ src: string; record_id: number; revision: number }>
        for (const link of links) {
          const old = rows.get(link.src)
          if (!old?.origin || old.origin.database !== database || old.origin.id !== String(link.record_id)) {
            acknowledgements.push(() => {
              client.prepare('DELETE FROM game_backfills WHERE root=? AND src=? AND record_id=?').run(root, link.src, link.record_id)
            })
            continue
          }
          const record = client.prepare(joined).get(link.record_id) as { zh: string; engine: string; revision: number } | undefined
          if (record?.revision === old.origin.revision) continue
          const revision = record?.revision || link.revision + 1
          const meta = record ? rowMeta(link.record_id, record.revision) : {}
          const value: CacheRow = {
            s: link.src,
            t: record?.zh ?? null,
            engine: record?.engine,
            origin: { id: String(link.record_id), revision, database },
            event: `${database}:refresh:${link.record_id}:${record?.revision || 'deleted'}`,
            ...meta,
          }
          if (!seen.has(value.event!)) {
            events.push(value)
            applyCacheRow(rows, value)
            seen.add(value.event!)
          }
          acknowledgements.push(() => {
            if (record) client.prepare('UPDATE game_backfills SET revision=? WHERE root=? AND src=? AND record_id=?').run(record.revision, root, link.src, link.record_id)
            else client.prepare('DELETE FROM game_backfills WHERE root=? AND src=? AND record_id=?').run(root, link.src, link.record_id)
          })
        }
        const projected = projections.collect(root, rows)
        events.push(...projected.events)
        acknowledgements.push(...projected.acknowledge)
        for (let offset = 0; offset < events.length; offset += 500) appendCacheEvents(file, events.slice(offset, offset + 500))
        for (const acknowledge of acknowledgements) acknowledge()
        client.exec(
          'DELETE FROM translation_outbox WHERE NOT EXISTS (SELECT 1 FROM game_backfills l WHERE l.record_id=translation_outbox.record_id AND l.revision<translation_outbox.revision)'
        )
        const filesAfter = gameTranslationFiles(root)
        const sameSeedAndFallback = JSON.stringify(filesBefore.seed) === JSON.stringify(filesAfter.seed) && (filesBefore.cache == null || filesBefore.cache === filesAfter.cache)
        const sharedOnly = sameSeedAndFallback && ownedSharedAppend(file, snapshot, events) && noteGameSharedBackfill(root, previousStamp)
        return { sharedOnly }
      } finally {
        release()
      }
    },
  }
}
